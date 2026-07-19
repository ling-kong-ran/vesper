import { createServer } from 'node:http'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createServer as createViteServer } from 'vite'
import { createApiHandler } from './http/api-handler.mjs'
import { createStaticHandler } from './http/static-handler.mjs'
import { AgentRuntimeService } from './runtime/agent-runtime.mjs'
import { VESPER_CONFIG_DIR, migrateLegacyAppDataEntries, migrateLegacyUserDirectory } from './storage/vesper-migration.mjs'

process.env.PI_SKIP_VERSION_CHECK ||= '1'
process.env.PI_TELEMETRY ||= '0'

const serverDir = dirname(fileURLToPath(import.meta.url))
const root = resolve(serverDir, '..')
const configuredDataDir = process.env.VESPER_AGENT_DIR
const defaultDataDir = join(homedir(), VESPER_CONFIG_DIR, 'agent')
if (!configuredDataDir) {
  const migration = await migrateLegacyUserDirectory()
  if (migration.copied) console.log(`Copied legacy user data to ${migration.target}`)
}
const dataDir = configuredDataDir ? resolve(configuredDataDir) : defaultDataDir
// The bundled Pi runtime reads this environment variable internally. Keep it
// scoped to this process while directing all of Vesper's data to .vesper.
process.env.PI_CODING_AGENT_DIR = dataDir
const migratedEntries = await migrateLegacyAppDataEntries(dataDir)
if (migratedEntries.length) console.log(`Renamed ${migratedEntries.length} legacy Vesper data entries`)
const production = process.argv.includes('--production')
const port = Number(process.env.PORT || 5173)
const host = process.env.HOST || '127.0.0.1'

const runtime = new AgentRuntimeService({ cwd: root, dataDir })
await runtime.init()

const vite = production ? null : await createViteServer({
  root,
  server: { middlewareMode: true, hmr: { port: port + 1 } },
  appType: 'spa',
})
const handleApi = createApiHandler(runtime)
const serveProduction = createStaticHandler(root)

const server = createServer(async (req, res) => {
  const url = new URL(req.url || '/', `http://${req.headers.host || `${host}:${port}`}`)
  if (await handleApi(req, res, url)) return
  if (vite) vite.middlewares(req, res)
  else await serveProduction(req, res, url)
})

server.listen(port, host, () => {
  console.log(`Vesper running at http://${host}:${port}`)
  console.log(`Agent data: ${dataDir}`)
})

async function shutdown() {
  await runtime.dispose()
  await vite?.close()
  server.close(() => process.exit(0))
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
