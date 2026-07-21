import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

const OPENAI_AUTH_CLAIM = 'https://api.openai.com/auth'

function nonEmptyString(...values) {
  return values.find((value) => typeof value === 'string' && value.trim())?.trim() || ''
}

function decodeJwtPayload(token) {
  try {
    const parts = String(token || '').split('.')
    if (parts.length !== 3) return null
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString('utf8'))
  } catch {
    return null
  }
}

function normalizeExpiry(value, accessToken) {
  const numeric = Number(value)
  if (Number.isFinite(numeric) && numeric > 0) return numeric < 1_000_000_000_000 ? numeric * 1000 : numeric
  const expiry = Number(decodeJwtPayload(accessToken)?.exp)
  return Number.isFinite(expiry) && expiry > 0 ? expiry * 1000 : 0
}

function oauthCredential(accessToken, refreshToken, expiresAt, extra = {}) {
  const value = { type: 'oauth', expires: expiresAt, ...extra }
  value.access = accessToken
  value.refresh = refreshToken
  return value
}

function apiKeyCredential(apiKey) {
  const value = { type: 'api_key' }
  value.key = apiKey
  return value
}

function codexAccountId(tokens, accessToken) {
  const payload = decodeJwtPayload(accessToken)
  return nonEmptyString(
    tokens.account_id,
    tokens.accountId,
    payload?.[OPENAI_AUTH_CLAIM]?.chatgpt_account_id,
    payload?.account_id,
  )
}

export function normalizeCodexCredential(data) {
  const tokens = data?.tokens || data?.oauth || data || {}
  const access = nonEmptyString(tokens.access_token, tokens.accessToken, tokens.access)
  const refresh = nonEmptyString(tokens.refresh_token, tokens.refreshToken, tokens.refresh)
  const accountId = codexAccountId(tokens, access)
  if (access && refresh && accountId) {
    const result = { providerId: 'openai-codex', authType: 'oauth' }
    result.credential = oauthCredential(access, refresh, normalizeExpiry(tokens.expires_at ?? tokens.expiresAt ?? tokens.expires, access), { accountId })
    return result
  }
  const key = nonEmptyString(data?.OPENAI_API_KEY, data?.openaiApiKey, data?.apiKey)
  if (key) {
    const result = { providerId: 'openai', authType: 'api_key' }
    result.credential = apiKeyCredential(key)
    return result
  }
  return null
}

export function normalizeClaudeCredential(data) {
  const oauth = data?.claudeAiOauth || data?.oauth || data || {}
  const access = nonEmptyString(oauth.accessToken, oauth.access_token, oauth.access)
  const refresh = nonEmptyString(oauth.refreshToken, oauth.refresh_token, oauth.refresh)
  if (access && refresh) {
    const result = { providerId: 'anthropic', authType: 'oauth' }
    result.credential = oauthCredential(access, refresh, normalizeExpiry(oauth.expiresAt ?? oauth.expires_at ?? oauth.expires, access))
    return result
  }
  const key = nonEmptyString(data?.ANTHROPIC_API_KEY, data?.anthropicApiKey, data?.apiKey)
  if (key) {
    const result = { providerId: 'anthropic', authType: 'api_key' }
    result.credential = apiKeyCredential(key)
    return result
  }
  return null
}

function publicDiscovery(item) {
  const expiresAt = item.credential.type === 'oauth' ? item.credential.expires || null : null
  return {
    id: item.id,
    providerId: item.providerId,
    providerName: item.providerName,
    source: item.source,
    sourceLabel: item.sourceLabel,
    location: item.location,
    authType: item.authType,
    importable: item.importable,
    expiresAt,
    expired: expiresAt != null ? expiresAt <= Date.now() : false,
  }
}

function uniqueCandidates(candidates) {
  const seen = new Set()
  return candidates.filter((candidate) => {
    const path = resolve(candidate.path)
    if (seen.has(path)) return false
    seen.add(path)
    return true
  })
}

export class ProviderDiscoveryService {
  constructor({ homeDir = homedir(), env = process.env, readFileImpl = readFile } = {}) {
    this.homeDir = homeDir
    this.env = env
    this.readFile = readFileImpl
  }

  codexCandidates() {
    return uniqueCandidates([
      ...(this.env.CODEX_HOME ? [{ path: join(this.env.CODEX_HOME, 'auth.json'), location: '$CODEX_HOME/auth.json' }] : []),
      { path: join(this.homeDir, '.codex', 'auth.json'), location: '~/.codex/auth.json' },
    ])
  }

  claudeCandidates() {
    const roots = [
      ...(this.env.CLAUDE_CONFIG_DIR ? [{ path: this.env.CLAUDE_CONFIG_DIR, label: '$CLAUDE_CONFIG_DIR' }] : []),
      { path: join(this.homeDir, '.claude'), label: '~/.claude' },
    ]
    return uniqueCandidates(roots.flatMap((root) => [
      { path: join(root.path, '.credentials.json'), location: `${root.label}/.credentials.json` },
      { path: join(root.path, 'credentials.json'), location: `${root.label}/credentials.json` },
    ]))
  }

  async readCandidate(candidate, source) {
    try {
      return { data: JSON.parse(await this.readFile(candidate.path, 'utf8')) }
    } catch (error) {
      if (error?.code === 'ENOENT') return { missing: true }
      return {
        error: {
          source,
          code: error instanceof SyntaxError ? 'invalid_json' : 'unreadable',
          message: error instanceof SyntaxError ? 'Credential file contains invalid JSON' : 'Credential file could not be read',
        },
      }
    }
  }

  async discoverFileSource({ id, providerName, source, sourceLabel, candidates, normalize }) {
    const errors = []
    for (const candidate of candidates) {
      const result = await this.readCandidate(candidate, source)
      if (result.missing) continue
      if (result.error) {
        errors.push(result.error)
        continue
      }
      const normalized = normalize(result.data)
      if (!normalized) {
        errors.push({ source, code: 'unsupported_format', message: 'Credential file does not contain a supported login' })
        continue
      }
      return {
        item: {
          id,
          providerName,
          source,
          sourceLabel,
          location: candidate.location,
          importable: true,
          ...normalized,
        },
        errors,
      }
    }
    return { item: null, errors }
  }

  async discoverCodex() {
    return this.discoverFileSource({
      id: 'codex-cli',
      providerName: 'OpenAI Codex',
      source: 'codex-cli',
      sourceLabel: 'Codex CLI',
      candidates: this.codexCandidates(),
      normalize: normalizeCodexCredential,
    })
  }

  async discoverClaude() {
    return this.discoverFileSource({
      id: 'claude-cli',
      providerName: 'Anthropic',
      source: 'claude-cli',
      sourceLabel: 'Claude Code',
      candidates: this.claudeCandidates(),
      normalize: normalizeClaudeCredential,
    })
  }

  discoverAnthropicEnvironment() {
    let variable = ''
    if (this.env.ANTHROPIC_OAUTH_TOKEN) variable = 'ANTHROPIC_OAUTH_TOKEN'
    else if (this.env.ANTHROPIC_API_KEY) variable = 'ANTHROPIC_API_KEY'
    if (!variable) return null
    const item = {
      id: 'anthropic-environment',
      providerId: 'anthropic',
      providerName: 'Anthropic',
      source: 'environment',
      sourceLabel: 'Environment variable',
      location: variable,
      authType: 'api_key',
      importable: false,
    }
    item.credential = apiKeyCredential(this.env[variable])
    return item
  }

  async discoverInternal() {
    const [codex, claude] = await Promise.all([this.discoverCodex(), this.discoverClaude()])
    const items = [codex.item, claude.item].filter(Boolean)
    if (!claude.item) {
      const environment = this.discoverAnthropicEnvironment()
      if (environment) items.push(environment)
    }
    return { items, errors: [...codex.errors, ...claude.errors] }
  }

  async discover() {
    const result = await this.discoverInternal()
    return { providers: result.items.map(publicDiscovery), errors: result.errors }
  }

  async loadCredential(discoveryId) {
    const result = await this.discoverInternal()
    const item = result.items.find((candidate) => candidate.id === discoveryId)
    if (!item) throw new Error('Discovered provider is no longer available')
    if (!item.importable) throw new Error('This provider already uses ambient authentication and does not need to be imported')
    const loaded = { providerId: item.providerId, source: item.source, authType: item.authType }
    loaded.credential = item.credential
    return loaded
  }
}
