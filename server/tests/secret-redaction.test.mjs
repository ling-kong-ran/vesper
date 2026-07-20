import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  credentialRedactionExtension,
  REDACTED_SECRET,
  redactPersistedSessionFiles,
  redactSecretText,
  redactSecretValue,
} from '../security/secret-redaction.mjs'

test('credential redaction removes common secrets without hiding token usage fields', () => {
  const text = redactSecretText([
    'apiKey: sk-example-secret-token-1234567890',
    'Authorization: Bearer abcdefghijklmnopqrstuvwxyz',
    'https://example.test/mcp?access_token=private-token-value',
  ].join('\n'))
  assert.doesNotMatch(text, /sk-example|abcdefghijklmnopqrstuvwxyz|private-token-value/)
  assert.match(text, new RegExp(REDACTED_SECRET.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')))

  const value = redactSecretValue({
    maxTokens: 128_000,
    totalTokens: 42,
    accessToken: 'pencil-private-token',
    nested: { client_secret: 'client-private-secret' },
  })
  assert.equal(value.maxTokens, 128_000)
  assert.equal(value.totalTokens, 42)
  assert.equal(value.accessToken, REDACTED_SECRET)
  assert.equal(value.nested.client_secret, REDACTED_SECRET)
  assert.equal(redactSecretText(text), text)
})

test('Pi extension redacts tool results and finalized messages before persistence', async () => {
  const handlers = new Map()
  credentialRedactionExtension({ on: (name, handler) => handlers.set(name, handler) })

  const toolResult = await handlers.get('tool_result')({
    content: [{ type: 'text', text: '{"accessToken":"pencil-private-token"}' }],
    details: { Authorization: 'Bearer another-private-token' },
    isError: false,
  })
  assert.doesNotMatch(JSON.stringify(toolResult), /pencil-private|another-private/)

  const messageResult = await handlers.get('message_end')({
    message: {
      role: 'assistant',
      content: [{ type: 'toolCall', name: 'bash', arguments: { command: '--token raw-private-token' } }],
    },
  })
  assert.doesNotMatch(JSON.stringify(messageResult), /raw-private-token/)
})

test('existing JSONL sessions are scrubbed while preserving ordinary usage data', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'vesper-redaction-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const path = join(directory, 'session.jsonl')
  await writeFile(path, `${JSON.stringify({
    type: 'message',
    message: {
      role: 'toolResult',
      content: [{ type: 'text', text: '{"accessToken":"persisted-private-token"}' }],
      usage: { maxTokens: 128_000, totalTokens: 123 },
    },
  })}\n`, 'utf8')

  assert.equal(await redactPersistedSessionFiles(directory), 1)
  const entry = JSON.parse((await readFile(path, 'utf8')).trim())
  assert.doesNotMatch(JSON.stringify(entry), /persisted-private-token/)
  assert.equal(entry.message.usage.maxTokens, 128_000)
  assert.equal(entry.message.usage.totalTokens, 123)
  assert.equal(await redactPersistedSessionFiles(directory), 0)
})
