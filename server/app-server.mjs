import { createServer } from 'node:http'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { createApiHandler } from './http/api-handler.mjs'
import { createStaticHandler } from './http/static-handler.mjs'
import { AgentRuntimeService } from './runtime/agent-runtime.mjs'
import { UpdateCheckService } from './services/update-check-service.mjs'

export async function createVesperServer({
  root,
  runtimeCwd = root,
  dataDir = join(homedir(), '.vesper', 'agent'),
  production = false,
  port = 5173,
  host = '127.0.0.1',
  browserAutomationDriver = null,
} = {}) {
  const appRoot = resolve(root || process.cwd())
  const cwd = resolve(runtimeCwd || appRoot)
  const agentDir = resolve(dataDir)
  process.env.PI_CODING_AGENT_DIR = agentDir

  const runtime = new AgentRuntimeService({ cwd, dataDir: agentDir, browserAutomationDriver })
  await runtime.init()
  const packageJson = JSON.parse(await readFile(join(appRoot, 'package.json'), 'utf8'))
  const updates = new UpdateCheckService({ currentVersion: packageJson.version })

  let vite = null
  if (!production) {
    const { createServer: createViteServer } = await import('vite')
    vite = await createViteServer({
      root: appRoot,
      server: { middlewareMode: true, hmr: { port: Number(port) + 1 } },
      appType: 'spa',
    })
  }
  const handleApi = createApiHandler(runtime, { updates })
  const serveProduction = createStaticHandler(appRoot)
  const server = createServer(async (req, res) => {
    const address = server.address()
    const activePort = typeof address === 'object' && address ? address.port : port
    const url = new URL(req.url || '/', `http://${req.headers.host || `${host}:${activePort}`}`)
    if (await handleApi(req, res, url)) return
    if (vite) vite.middlewares(req, res)
    else await serveProduction(req, res, url)
  })

  await new Promise((resolveListen, rejectListen) => {
    const fail = (error) => rejectListen(error)
    server.once('error', fail)
    server.listen(port, host, () => {
      server.off('error', fail)
      resolveListen()
    })
  })
  const address = server.address()
  const activePort = typeof address === 'object' && address ? address.port : port
  let closing = null
  return {
    host,
    port: activePort,
    url: `http://${host}:${activePort}`,
    dataDir: agentDir,
    runtime,
    async close() {
      if (closing) return closing
      closing = (async () => {
        await runtime.dispose()
        await vite?.close()
        await new Promise((resolveClose) => server.close(() => resolveClose()))
      })()
      return closing
    },
  }
}
