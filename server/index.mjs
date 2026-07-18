import { createServer } from 'node:http'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { getAgentDir } from '@earendil-works/pi-coding-agent'
import { createServer as createViteServer } from 'vite'
import { createApiHandler } from './http/api-handler.mjs'
import { createStaticHandler } from './http/static-handler.mjs'
import { AgentRuntimeService } from './runtime/agent-runtime.mjs'

process.env.PI_SKIP_VERSION_CHECK ||= '1'
process.env.PI_TELEMETRY ||= '0'

const serverDir = dirname(fileURLToPath(import.meta.url))
const root = resolve(serverDir, '..')
const dataDir = process.env.PI_CODING_AGENT_DIR ? resolve(process.env.PI_CODING_AGENT_DIR) : getAgentDir()
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
  console.log(`Pi Coder running at http://${host}:${port}`)
  console.log(`Agent data: ${dataDir}`)
})

async function shutdown() {
  await runtime.dispose()
  await vite?.close()
  server.close(() => process.exit(0))
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
