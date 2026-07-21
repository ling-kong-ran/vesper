import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createVesperServer } from './app-server.mjs'

process.env.PI_SKIP_VERSION_CHECK ||= '1'
process.env.PI_TELEMETRY ||= '0'

const serverDir = dirname(fileURLToPath(import.meta.url))
const root = resolve(serverDir, '..')
const configuredDataDir = process.env.VESPER_AGENT_DIR
const dataDir = configuredDataDir ? resolve(configuredDataDir) : join(homedir(), '.vesper', 'agent')
const production = process.argv.includes('--production')
const port = Number(process.env.PORT || 5173)
const host = process.env.HOST || '127.0.0.1'

const vesper = await createVesperServer({
  root,
  runtimeCwd: process.env.VESPER_WORKSPACE_DIR || root,
  dataDir,
  production,
  port,
  host,
})
console.log(`Vesper running at ${vesper.url}`)
console.log(`Agent data: ${vesper.dataDir}`)

let shuttingDown = false
async function shutdown() {
  if (shuttingDown) return
  shuttingDown = true
  await vesper.close()
  process.exit(0)
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
