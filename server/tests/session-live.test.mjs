import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { AgentRuntimeService } from '../runtime/agent-runtime.mjs'

test('live session snapshot restores partial assistant output and tool state', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'pi-coder-live-session-'))
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
  })
  const live = await runtime.getSessionLive('session-live')
  assert.equal(live.streaming, true)
  assert.equal(live.messages.at(-1).role, 'agent')
  assert.equal(live.messages.at(-1).text, '正在处理剩余测试…')
  assert.deepEqual(live.tools, [{ id: 'tool-1', name: 'bash', status: 'running' }])
  assert.equal(live.model, 'openai/gpt-5.4')
})
