import { readFile, readdir, rename, unlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'

export const REDACTED_SECRET = '[REDACTED SECRET]'

const SENSITIVE_KEYS = new Set([
  'apikey',
  'appsecret',
  'authorization',
  'authtoken',
  'clientsecret',
  'cookie',
  'credential',
  'credentials',
  'password',
  'passwd',
  'refreshtoken',
  'secret',
  'setcookie',
  'token',
  'accesstoken',
])

const SENSITIVE_KEY_PATTERN = '(?:api[_ -]?key|access[_ -]?token|refresh[_ -]?token|auth[_ -]?token|token|client[_ -]?secret|app[_ -]?secret|password|passwd|authorization|cookie|credential)'
const QUOTED_SECRET = new RegExp(`((?:["'])?${SENSITIVE_KEY_PATTERN}(?:["'])?\\s*[:=]\\s*)(["'])([^\\r\\n]*?)\\2`, 'gi')
const PLAIN_SECRET = new RegExp(`((?:^|[\\s,{;])(?:${SENSITIVE_KEY_PATTERN})\\s*[:=]\\s*)(?!["']|\\[REDACTED SECRET\\])[^\\s,;}\\]]+`, 'gim')
const CLI_SECRET = new RegExp(`(--?(?:${SENSITIVE_KEY_PATTERN})(?:=|\\s+))(?!\\[REDACTED SECRET\\])([^\\s"']+)`, 'gi')

function normalizedKey(value) {
  return String(value || '').toLowerCase().replace(/[^a-z0-9]/g, '')
}

export function redactSecretText(value) {
  return String(value ?? '')
    .replace(/-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/g, REDACTED_SECRET)
    .replace(/\b(Bearer\s+)[a-z0-9._~+/-]{8,}/gi, `$1${REDACTED_SECRET}`)
    .replace(QUOTED_SECRET, (_match, prefix, quote) => `${prefix}${quote}${REDACTED_SECRET}${quote}`)
    .replace(PLAIN_SECRET, (_match, prefix) => `${prefix}${REDACTED_SECRET}`)
    .replace(CLI_SECRET, (_match, prefix) => `${prefix}${REDACTED_SECRET}`)
    .replace(/([?&](?:(?:access|refresh|auth)[_-]?)?(?:token|key|secret|password|auth|credential)[^=&#\s]*=)(?!\[REDACTED SECRET\])[^&#\s]*/gi, `$1${REDACTED_SECRET}`)
    .replace(/\beyJ[a-z0-9_-]{8,}\.[a-z0-9_-]{8,}\.[a-z0-9_-]{8,}\b/gi, REDACTED_SECRET)
    .replace(/\b(?:sk|rk|pk|pcl|ghp|github_pat|xox[baprs])[-_][a-z0-9_-]{12,}\b/gi, REDACTED_SECRET)
}

export function redactSecretValue(value, key = '', seen = new WeakSet()) {
  if (SENSITIVE_KEYS.has(normalizedKey(key))) return value == null ? value : REDACTED_SECRET
  if (typeof value === 'string') return redactSecretText(value)
  if (!value || typeof value !== 'object') return value
  if (seen.has(value)) return '[CIRCULAR]'
  seen.add(value)
  if (Array.isArray(value)) return value.map((item) => redactSecretValue(item, key, seen))
  return Object.fromEntries(Object.entries(value).map(([childKey, child]) => [childKey, redactSecretValue(child, childKey, seen)]))
}

function redactMessage(message) {
  return redactSecretValue(message)
}

export function credentialRedactionExtension(pi) {
  pi.on('tool_result', (event) => ({
    content: redactSecretValue(event.content),
    details: redactSecretValue(event.details),
    isError: event.isError,
  }))
  pi.on('message_end', (event) => ({ message: redactMessage(event.message) }))
}

function redactJsonLine(line) {
  if (!line.trim()) return line
  try {
    return JSON.stringify(redactSecretValue(JSON.parse(line)))
  } catch {
    return redactSecretText(line)
  }
}

export async function redactPersistedSessionFiles(sessionDir) {
  let changedFiles = 0
  let entries
  try {
    entries = await readdir(sessionDir, { withFileTypes: true })
  } catch (error) {
    if (error?.code === 'ENOENT') return 0
    throw error
  }
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.toLowerCase().endsWith('.jsonl')) continue
    const path = join(sessionDir, entry.name)
    const source = await readFile(path, 'utf8')
    const trailingNewline = /\r?\n$/.test(source)
    const redacted = source.split(/\r?\n/).map(redactJsonLine).join('\n')
    const output = trailingNewline && !redacted.endsWith('\n') ? `${redacted}\n` : redacted
    if (output === source) continue
    const temporary = `${path}.redacting-${process.pid}`
    try {
      await writeFile(temporary, output, 'utf8')
      await rename(temporary, path)
      changedFiles += 1
    } finally {
      await unlink(temporary).catch(() => {})
    }
  }
  return changedFiles
}
