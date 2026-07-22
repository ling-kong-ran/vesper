import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createVesperServer } from './app-server.mjs'
import { openBrowser, shouldOpenBrowser } from './open-browser.mjs'

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
console.log('')
console.log(`Vesper 已启动：${vesper.url}`)
console.log(`数据目录：${vesper.dataDir}`)
if (shouldOpenBrowser({ host })) {
  const opening = openBrowser(vesper.url)
  console.log(opening ? '正在打开默认浏览器…' : '未能自动打开浏览器。')
}
console.log(`请在浏览器中访问：${vesper.url}`)
console.log('如需启动时自动打开浏览器，可设置 VESPER_OPEN_BROWSER=1。')
console.log('按 Ctrl+C 停止 Vesper。')
console.log('')

let shuttingDown = false
async function shutdown() {
  if (shuttingDown) return
  shuttingDown = true
  await vesper.close()
  process.exit(0)
}

process.on('SIGINT', shutdown)
process.on('SIGTERM', shutdown)
