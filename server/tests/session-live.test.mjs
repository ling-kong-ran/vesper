import assert from 'node:assert/strict'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { AgentRuntimeService } from '../runtime/agent-runtime.mjs'

test('live session snapshot restores partial assistant output and tool state', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'vesper-live-session-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const runtime = new AgentRuntimeService({ cwd: directory, dataDir: directory })
  runtime.sessions.set('session-live', {
    cwd: directory,
    session: {
      isStreaming: true,
      model: { provider: 'openai', id: 'gpt-5.4' },
      messages: [{ role: 'user', content: '继续处理', timestamp: 1 }],
    },
  })
  runtime.liveSessions.set('session-live', {
    streaming: true,
    text: '正在处理剩余测试…',
    tools: [{ id: 'tool-1', name: 'bash', status: 'running' }],
    assets: [],
    error: '',
    startedAt: '2026-07-20T10:00:00.000Z',
    lastActivityAt: '2026-07-20T10:00:05.000Z',
  })
  const live = await runtime.getSessionLive('session-live')
  assert.equal(live.streaming, true)
  assert.equal(live.messages.at(-1).role, 'agent')
  assert.equal(live.messages.at(-1).text, '正在处理剩余测试…')
  assert.deepEqual(live.tools, [{ id: 'tool-1', name: 'bash', status: 'running' }])
  assert.equal(live.startedAt, '2026-07-20T10:00:00.000Z')
  assert.equal(live.lastActivityAt, '2026-07-20T10:00:05.000Z')
  assert.equal(live.model, 'openai/gpt-5.4')
})

test('stream completion publishes an authoritative terminal snapshot', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'vesper-live-terminal-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const runtime = new AgentRuntimeService({ cwd: directory, dataDir: directory })
  runtime.archiveAttachments = async () => []
  runtime.captureConversationMemory = async () => []
  runtime.memory = { relevantContext: async () => ({ text: '' }) }

  const listeners = new Set()
  const session = {
    sessionId: 'session-terminal',
    isStreaming: false,
    model: { provider: 'openai', id: 'gpt-5.4' },
    thinkingLevel: 'medium',
    messages: [{ role: 'user', content: 'Earlier context', timestamp: 1 }],
    agent: { state: { systemPrompt: '' } },
    getActiveToolNames: () => [],
    setActiveToolsByName: () => {},
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    async prompt() {
      session.isStreaming = true
      for (const listener of listeners) listener({ type: 'compaction_start', reason: 'threshold' })
      for (const listener of listeners) listener({
        type: 'compaction_end',
        reason: 'threshold',
        result: { summary: 'redacted from the public event', firstKeptEntryId: 'message-1', tokensBefore: 92_000, estimatedTokensAfter: 18_500 },
        aborted: false,
        willRetry: false,
      })
      for (const listener of listeners) listener({ type: 'tool_execution_start', toolCallId: 'tool-1', toolName: 'read', args: {} })
      const assistant = { role: 'assistant', content: [{ type: 'text', text: 'Final answer' }], timestamp: 2 }
      session.messages.push(assistant)
      for (const listener of listeners) listener({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'Final answer' } })
      session.isStreaming = false
    },
  }
  const value = { session, cwd: directory, name: 'Terminal snapshot', baseToolNames: [] }
  runtime.sessions.set(session.sessionId, value)
  runtime.getOrCreateSession = async () => value

  const events = []
  await runtime.streamPrompt({
    sessionId: session.sessionId,
    message: 'Finish the answer.',
    send: (event, data) => events.push({ event, data }),
  })

  const compactionStart = events.find((item) => item.event === 'compaction_start')?.data
  const compactionEnd = events.find((item) => item.event === 'compaction_end')?.data
  assert.equal(compactionStart.status, 'running')
  assert.equal(compactionStart.reason, 'threshold')
  assert.equal(compactionEnd.status, 'completed')
  assert.equal(compactionEnd.tokensBefore, 92_000)
  assert.equal(compactionEnd.estimatedTokensAfter, 18_500)
  assert.equal(compactionEnd.tokensSaved, 73_500)
  assert.equal(Object.hasOwn(compactionEnd, 'summary'), false)
  const done = events.find((item) => item.event === 'done')?.data
  assert.equal(done.text, 'Final answer')
  assert.equal(done.tools[0].status, 'done')
  assert.deepEqual(done.compaction, compactionEnd)
  assert.ok(done.finishedAt)
  const live = await runtime.getSessionLive(session.sessionId)
  assert.equal(live.streaming, false)
  assert.equal(live.finishedAt, done.finishedAt)
  assert.equal(live.tools[0].status, 'done')
  assert.deepEqual(live.compaction, compactionEnd)
})

test('generated session title is emitted before the terminal done event', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'vesper-live-title-order-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const runtime = new AgentRuntimeService({ cwd: directory, dataDir: directory })
  runtime.archiveAttachments = async () => []
  runtime.captureConversationMemory = async () => []
  runtime.memory = { relevantContext: async () => ({ text: '' }) }
  runtime.generateSessionTitle = async () => 'Generated Title'
  runtime.markSessionTitle = async () => {}

  const listeners = new Set()
  const session = {
    sessionId: 'session-title-order',
    isStreaming: false,
    model: { provider: 'openai', id: 'gpt-5.4' },
    thinkingLevel: 'medium',
    messages: [],
    agent: { state: { systemPrompt: '' } },
    getActiveToolNames: () => [],
    setActiveToolsByName: () => {},
    setSessionName(name) { this.name = name },
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    async prompt() {
      session.isStreaming = true
      session.messages.push({ role: 'user', content: 'Name this chat.', timestamp: 1 })
      session.messages.push({ role: 'assistant', content: [{ type: 'text', text: 'Hello' }], timestamp: 2 })
      for (const listener of listeners) listener({ type: 'message_update', assistantMessageEvent: { type: 'text_delta', delta: 'Hello' } })
      session.isStreaming = false
    },
  }
  const value = { session, cwd: directory, name: 'Temporary title', baseToolNames: [] }
  runtime.sessions.set(session.sessionId, value)
  runtime.getOrCreateSession = async () => value

  const events = []
  await runtime.streamPrompt({
    sessionId: session.sessionId,
    message: 'Name this chat.',
    send: (event, data) => events.push({ event, data }),
  })

  const titleIndex = events.findIndex((item) => item.event === 'session_title' && item.data?.source === 'generated')
  const doneIndex = events.findIndex((item) => item.event === 'done')
  assert.ok(titleIndex >= 0)
  assert.ok(doneIndex > titleIndex)
  assert.equal(events[titleIndex].data.name, 'Generated Title')
})

test('stream failures emit a single terminal error snapshot without throwing', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'vesper-live-error-once-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const runtime = new AgentRuntimeService({ cwd: directory, dataDir: directory })
  runtime.archiveAttachments = async () => []
  runtime.captureConversationMemory = async () => []
  runtime.memory = { relevantContext: async () => ({ text: '' }) }

  const session = {
    sessionId: 'session-error-once',
    isStreaming: false,
    model: { provider: 'openai', id: 'gpt-5.4' },
    thinkingLevel: 'medium',
    messages: [{ role: 'user', content: 'Earlier', timestamp: 1 }],
    agent: { state: { systemPrompt: '' } },
    getActiveToolNames: () => [],
    setActiveToolsByName: () => {},
    subscribe() { return () => {} },
    async prompt() {
      session.isStreaming = true
      try {
        throw new Error('model failed')
      } finally {
        session.isStreaming = false
      }
    },
  }
  const value = { session, cwd: directory, name: 'Error once', baseToolNames: [] }
  runtime.sessions.set(session.sessionId, value)
  runtime.getOrCreateSession = async () => value

  const events = []
  await runtime.streamPrompt({
    sessionId: session.sessionId,
    message: 'Trigger failure.',
    send: (event, data) => events.push({ event, data }),
  })

  const errors = events.filter((item) => item.event === 'error')
  assert.equal(errors.length, 1)
  assert.equal(errors[0].data.message, 'model failed')
  assert.equal(errors[0].data.tools.length, 0)
  const live = await runtime.getSessionLive(session.sessionId)
  assert.equal(live.streaming, false)
  assert.equal(live.error, 'model failed')
})

test('context usage reports the current window share and automatic compaction threshold', () => {
  const runtime = new AgentRuntimeService({ cwd: process.cwd(), dataDir: process.cwd() })
  runtime.settingsManager = { getCompactionSettings: () => ({ enabled: true, reserveTokens: 16_384 }) }
  const session = {
    model: { provider: 'openai', id: 'gpt-5.4', contextWindow: 200_000 },
    getContextUsage: () => ({ tokens: 120_000, contextWindow: 200_000, percent: 60 }),
  }
  assert.deepEqual(runtime.compactionAwareContextUsage(session), {
    tokens: 120_000,
    contextWindow: 200_000,
    percent: 60,
    estimated: false,
    autoCompactEnabled: true,
    compactAtTokens: 183_616,
    compactAtPercent: 91.808,
  })
  assert.deepEqual(runtime.decorateContextUsage({ tokens: null, contextWindow: 200_000, percent: null }, { status: 'completed', estimatedTokensAfter: 18_500 }), {
    tokens: 18_500,
    contextWindow: 200_000,
    percent: 9.25,
    estimated: true,
    autoCompactEnabled: true,
    compactAtTokens: 183_616,
    compactAtPercent: 91.808,
  })
})

test('session messages are returned newest-first by bounded cursor pages', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'vesper-message-pages-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const runtime = new AgentRuntimeService({ cwd: directory, dataDir: directory })
  runtime.sessions.set('session-pages', {
    cwd: directory,
    session: {
      isStreaming: false,
      model: { provider: 'openai', id: 'gpt-5.4', contextWindow: 128_000 },
      getContextUsage: () => ({ tokens: 64_000, contextWindow: 128_000, percent: 50 }),
      messages: Array.from({ length: 95 }, (_, index) => ({
        role: index % 2 ? 'assistant' : 'user',
        content: `message-${index}`,
        timestamp: index + 1,
      })),
    },
  })

  const latest = await runtime.getSessionMessagePage('session-pages', { limit: 20 })
  assert.equal(latest.messages.length, 20)
  assert.equal(latest.messages[0].text, 'message-75')
  assert.equal(latest.messages.at(-1).text, 'message-94')
  assert.deepEqual(latest.pageInfo, { start: 75, end: 95, total: 95, hasMore: true, nextCursor: '75' })
  assert.equal(latest.contextUsage.percent, 50)
  assert.equal(latest.contextUsage.contextWindow, 128_000)

  const older = await runtime.getSessionMessagePage('session-pages', { limit: 20, before: latest.pageInfo.nextCursor })
  assert.equal(older.messages[0].text, 'message-55')
  assert.equal(older.messages.at(-1).text, 'message-74')
  assert.equal(older.pageInfo.nextCursor, '55')

  const oldest = await runtime.getSessionMessagePage('session-pages', { limit: 20, before: 15 })
  assert.equal(oldest.messages.length, 15)
  assert.equal(oldest.messages[0].text, 'message-0')
  assert.equal(oldest.pageInfo.hasMore, false)
  assert.equal(oldest.pageInfo.nextCursor, null)
})

test('session history pagination follows the persisted branch across compaction', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'vesper-persisted-history-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const path = join(directory, 'session.jsonl')
  const entries = [
    { type: 'session', version: 3, id: 'session-history', timestamp: '2026-01-01T00:00:00.000Z', cwd: directory },
    { type: 'message', id: 'message-1', parentId: 'session-history', message: { role: 'user', content: 'old-user', timestamp: 1 } },
    { type: 'message', id: 'message-2', parentId: 'message-1', message: { role: 'assistant', content: 'old-agent', timestamp: 2 } },
    { type: 'compaction', id: 'compact-1', parentId: 'message-2', summary: 'compressed context' },
    { type: 'message', id: 'message-3', parentId: 'compact-1', message: { role: 'user', content: 'new-user', timestamp: 3 } },
    { type: 'message', id: 'message-4', parentId: 'message-3', message: { role: 'assistant', content: 'new-agent', timestamp: 4 } },
  ]
  await writeFile(path, `${entries.map((entry) => JSON.stringify(entry)).join('\n')}\n`, 'utf8')
  const runtime = new AgentRuntimeService({ cwd: directory, dataDir: directory })
  runtime.findSessionInfo = async () => ({ path })

  const latest = await runtime.getSessionMessagePage('session-history', { limit: 2 })
  assert.deepEqual(latest.messages.map((message) => message.text), ['new-user', 'new-agent'])
  assert.equal(latest.pageInfo.total, 4)
  assert.equal(latest.pageInfo.nextCursor, '2')

  const older = await runtime.getSessionMessagePage('session-history', { limit: 2, before: latest.pageInfo.nextCursor })
  assert.deepEqual(older.messages.map((message) => message.text), ['old-user', 'old-agent'])
  assert.equal(older.pageInfo.hasMore, false)
})

test('empty active sessions tolerate a JSONL file that has not been created yet', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'vesper-empty-session-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const runtime = new AgentRuntimeService({ cwd: directory, dataDir: directory })
  runtime.sessions.set('session-empty', {
    cwd: directory,
    session: {
      sessionFile: join(directory, 'sessions', 'not-created-yet.jsonl'),
      isStreaming: false,
      model: { provider: 'openai', id: 'gpt-5.4' },
      messages: [],
    },
  })

  const page = await runtime.getSessionMessagePage('session-empty', { limit: 40 })
  assert.deepEqual(page.messages, [])
  assert.deepEqual(page.pageInfo, { start: 0, end: 0, total: 0, hasMore: false, nextCursor: null })
})
