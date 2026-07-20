import assert from 'node:assert/strict'
import test from 'node:test'
import { deriveRunActivity, formatRunDuration, groupToolCalls, RUN_INACTIVITY_THRESHOLD_MS } from '../../src/features/chat/run-activity.js'

test('chat activity derives meaningful stages and inactivity states', () => {
  const now = Date.parse('2026-07-20T10:00:20.000Z')
  assert.equal(deriveRunActivity({ streaming: true, lastActivityAt: '2026-07-20T10:00:19.000Z', now }).stage, 'thinking')
  assert.equal(deriveRunActivity({ streaming: true, tools: [{ name: 'read', status: 'running' }], lastActivityAt: '2026-07-20T10:00:19.000Z', now }).stage, 'researching')
  assert.equal(deriveRunActivity({ streaming: true, tools: [{ name: 'bash', status: 'running' }], lastActivityAt: '2026-07-20T10:00:19.000Z', now }).stage, 'validating')
  const waiting = deriveRunActivity({ streaming: true, tools: [{ name: 'bash', status: 'running' }], lastActivityAt: new Date(now - RUN_INACTIVITY_THRESHOLD_MS).toISOString(), now })
  assert.equal(waiting.stage, 'waiting_tool')
  assert.equal(waiting.inactiveMs, RUN_INACTIVITY_THRESHOLD_MS)
  assert.equal(deriveRunActivity({ streaming: false, stopped: true }).stage, 'stopped')
})

test('chat activity groups completed tools while preserving running and failed calls', () => {
  const grouped = groupToolCalls([
    { id: 'read-1', name: 'read', status: 'done' },
    { id: 'read-2', name: 'read', status: 'done', message: 'done' },
    { id: 'bash-1', name: 'bash', status: 'running' },
    { id: 'edit-1', name: 'edit', status: 'error', message: 'failed' },
  ])
  assert.equal(grouped.completed.length, 1)
  assert.equal(grouped.completed[0].count, 2)
  assert.equal(grouped.completed[0].message, 'done')
  assert.deepEqual(grouped.running.map((tool) => tool.id), ['bash-1'])
  assert.deepEqual(grouped.errors.map((tool) => tool.id), ['edit-1'])
})

test('chat activity formats short and long elapsed time', () => {
  assert.equal(formatRunDuration(9_900, 'zh-CN'), '9 秒')
  assert.equal(formatRunDuration(65_000, 'zh-CN'), '1:05')
  assert.equal(formatRunDuration(3_665_000, 'en-US'), '1:01:05')
})
