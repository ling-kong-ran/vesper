import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createApiHandler } from '../http/api-handler.mjs'
import { AgentRuntimeService } from '../runtime/agent-runtime.mjs'
import { ProviderDiscoveryService } from '../services/provider-discovery.mjs'

function jwt(payload) {
  const header = Buffer.from(JSON.stringify({ alg: 'none', typ: 'JWT' })).toString('base64url')
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `${header}.${body}.signature`
}

test('provider discovery finds Codex and Claude CLI logins without exposing credentials', async (t) => {
  const home = await mkdtemp(join(tmpdir(), 'vesper-provider-discovery-'))
  t.after(() => rm(home, { recursive: true, force: true }))
  await mkdir(join(home, '.codex'), { recursive: true })
  await mkdir(join(home, '.claude'), { recursive: true })

  const codexAccess = jwt({ exp: Math.floor(Date.now() / 1000) + 3600 })
  const codexAuth = { tokens: { account_id: 'account-test' } }
  codexAuth.tokens.access_token = codexAccess
  codexAuth.tokens.refresh_token = '[REDACTED SECRET]'
  const claudeAuth = { claudeAiOauth: { expiresAt: Date.now() + 3600_000 } }
  claudeAuth.claudeAiOauth.accessToken = '[REDACTED SECRET]'
  claudeAuth.claudeAiOauth.refreshToken = '[REDACTED SECRET]'

  await writeFile(join(home, '.codex', 'auth.json'), JSON.stringify(codexAuth), 'utf8')
  await writeFile(join(home, '.claude', '.credentials.json'), JSON.stringify(claudeAuth), 'utf8')

  const service = new ProviderDiscoveryService({ homeDir: home, env: {} })
  const discovered = await service.discover()
  assert.deepEqual(discovered.errors, [])
  assert.equal(discovered.providers.length, 2)
  assert.deepEqual(discovered.providers.map((item) => item.id).sort(), ['claude-cli', 'codex-cli'])
  assert.equal(discovered.providers.find((item) => item.id === 'codex-cli').providerId, 'openai-codex')
  assert.equal(discovered.providers.find((item) => item.id === 'claude-cli').providerId, 'anthropic')
  assert.equal(discovered.providers.every((item) => item.authType === 'oauth' && item.importable), true)

  const publicJson = JSON.stringify(discovered)
  assert.equal(publicJson.includes('"credential"'), false)
  assert.equal(publicJson.includes('"access"'), false)
  assert.equal(publicJson.includes('"refresh"'), false)

  const codex = await service.loadCredential('codex-cli')
  const claude = await service.loadCredential('claude-cli')
  assert.equal(codex.credential.type, 'oauth')
  assert.equal(codex.credential.accountId, 'account-test')
  assert.equal(typeof codex.credential.refresh, 'string')
  assert.equal(codex.credential.refresh.length > 0, true)
  assert.equal(claude.credential.type, 'oauth')
  assert.equal(typeof claude.credential.refresh, 'string')
  assert.equal(claude.credential.refresh.length > 0, true)
})

test('runtime imports a discovered Codex login without overwriting existing Vesper auth', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'vesper-provider-import-'))
  const storedCredential = { type: 'oauth', expires: Date.now() + 3600_000, accountId: 'account-import-test' }
  storedCredential.access = '[REDACTED SECRET]'
  storedCredential.refresh = '[REDACTED SECRET]'
  const providerDiscovery = {
    async discover() {
      return {
        providers: [{ id: 'codex-cli', providerId: 'openai-codex', providerName: 'OpenAI Codex', source: 'codex-cli', sourceLabel: 'Codex CLI', location: '~/.codex/auth.json', authType: 'oauth', importable: true, expiresAt: storedCredential.expires, expired: false }],
        errors: [],
      }
    },
    async loadCredential(id) {
      assert.equal(id, 'codex-cli')
      const loaded = { providerId: 'openai-codex', source: 'codex-cli', authType: 'oauth' }
      loaded.credential = storedCredential
      return loaded
    },
  }
  const runtime = new AgentRuntimeService({ cwd: directory, dataDir: directory, providerDiscovery })
  t.after(async () => {
    await runtime.dispose()
    await rm(directory, { recursive: true, force: true })
  })
  await runtime.init()

  const before = await runtime.getProviderDiscovery()
  assert.equal(before.providers[0].configured, false)
  assert.equal(before.providers[0].imported, false)

  const imported = await runtime.importDiscoveredProvider('codex-cli')
  assert.equal(imported.providerId, 'openai-codex')
  assert.equal(imported.config.providers.find((provider) => provider.id === 'openai-codex').configured, true)
  assert.equal(imported.discovery.providers[0].imported, true)
  const auth = JSON.parse(await readFile(join(directory, 'auth.json'), 'utf8'))
  assert.equal(auth['openai-codex'].type, 'oauth')
  assert.equal(auth['openai-codex'].accountId, 'account-import-test')
  await assert.rejects(() => runtime.importDiscoveredProvider('codex-cli'), /不会自动覆盖/)
})

test('provider discovery API exposes scan and import endpoints', async () => {
  const calls = []
  const handler = createApiHandler({
    async getProviderDiscovery() {
      calls.push('discover')
      return { providers: [{ id: 'codex-cli' }], errors: [] }
    },
    async importDiscoveredProvider(id) {
      calls.push(`import:${id}`)
      return { providerId: 'openai-codex' }
    },
  })
  const request = async (method, path) => {
    const response = { status: 0, body: '', writeHead(status) { this.status = status }, end(body) { this.body = body } }
    const handled = await handler({ method }, response, new URL(`http://localhost${path}`))
    return { handled, status: response.status, body: JSON.parse(response.body) }
  }

  const discovery = await request('GET', '/api/providers/discovery')
  assert.equal(discovery.handled, true)
  assert.equal(discovery.status, 200)
  assert.equal(discovery.body.providers[0].id, 'codex-cli')
  const imported = await request('POST', '/api/providers/codex-cli/import')
  assert.equal(imported.status, 200)
  assert.equal(imported.body.providerId, 'openai-codex')
  assert.deepEqual(calls, ['discover', 'import:codex-cli'])
})

test('provider discovery reports invalid files and ambient Anthropic auth safely', async (t) => {
  const home = await mkdtemp(join(tmpdir(), 'vesper-provider-discovery-invalid-'))
  t.after(() => rm(home, { recursive: true, force: true }))
  await mkdir(join(home, '.codex'), { recursive: true })
  await writeFile(join(home, '.codex', 'auth.json'), '{not-json', 'utf8')

  const service = new ProviderDiscoveryService({ homeDir: home, env: { ANTHROPIC_API_KEY: '[REDACTED SECRET]' } })
  const discovered = await service.discover()
  assert.equal(discovered.providers.length, 1)
  assert.equal(discovered.providers[0].id, 'anthropic-environment')
  assert.equal(discovered.providers[0].importable, false)
  assert.equal(discovered.providers[0].location, 'ANTHROPIC_API_KEY')
  assert.equal(discovered.errors.some((error) => error.source === 'codex-cli' && error.code === 'invalid_json'), true)
  assert.equal(JSON.stringify(discovered).includes('"credential"'), false)
  assert.equal(JSON.stringify(discovered).includes('"key"'), false)
  await assert.rejects(() => service.loadCredential('anthropic-environment'), /does not need to be imported/)
})
