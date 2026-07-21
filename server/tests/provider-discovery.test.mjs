import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
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
