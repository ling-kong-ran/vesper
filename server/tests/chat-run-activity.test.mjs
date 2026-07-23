import assert from 'node:assert/strict'
import test from 'node:test'
import { deriveRunActivity, formatRunDuration, groupToolCalls, latestUnrecoveredToolError, RUN_INACTIVITY_THRESHOLD_MS, settleToolCalls } from '../../src/features/chat/run-activity.js'

test('chat activity derives meaningful stages and inactivity states', () => {
  const now = Date.parse('2026-07-20T10:00:20.000Z')
  assert.equal(deriveRunActivity({ streaming: true, lastActivityAt: '2026-07-20T10:00:19.000Z', now }).stage, 'thinking')
  assert.equal(deriveRunActivity({ streaming: true, tools: [{ name: 'read', status: 'running' }], lastActivityAt: '2026-07-20T10:00:19.000Z', now }).stage, 'researching')
  assert.equal(deriveRunActivity({ streaming: true, tools: [{ name: 'bash', status: 'running' }], lastActivityAt: '2026-07-20T10:00:19.000Z', now }).stage, 'validating')
  assert.equal(deriveRunActivity({ streaming: true, compaction: { active: true }, lastActivityAt: '2026-07-20T10:00:00.000Z', now }).stage, 'compacting')
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

test('recoverable tool failures stop being prominent after later progress', () => {
  const failedAt = '2026-07-20T10:00:10.000Z'
  const failure = { id: 'bash-1', name: 'bash', status: 'error', message: 'failed', updatedAt: failedAt }
  assert.equal(latestUnrecoveredToolError([failure], { streaming: true, lastActivityAt: failedAt }), failure)
  assert.equal(latestUnrecoveredToolError([failure], { streaming: true, lastActivityAt: '2026-07-20T10:00:11.000Z' }), null)
  assert.equal(latestUnrecoveredToolError([
    failure,
    { id: 'bash-2', name: 'bash', status: 'running', startedAt: failedAt },
  ], { streaming: true, lastActivityAt: failedAt }), null)
  assert.equal(latestUnrecoveredToolError([failure], { streaming: false, lastActivityAt: failedAt }), null)
})

test('only the latest unresolved failure remains prominent while streaming', () => {
  const first = { id: 'read-1', name: 'read', status: 'error', updatedAt: '2026-07-20T10:00:09.000Z' }
  const latest = { id: 'read-2', name: 'read', status: 'error', updatedAt: '2026-07-20T10:00:10.000Z' }
  assert.equal(latestUnrecoveredToolError([first, latest], {
    streaming: true,
    lastActivityAt: '2026-07-20T10:00:10.000Z',
  }), latest)
})

test('chat activity formats short and long elapsed time', () => {
  assert.equal(formatRunDuration(9_900, 'zh-CN'), '9 秒')
  assert.equal(formatRunDuration(65_000, 'zh-CN'), '1:05')
  assert.equal(formatRunDuration(3_665_000, 'en-US'), '1:01:05')
})

test('terminal run state settles any tool missing its final event', () => {
  const finishedAt = '2026-07-20T10:00:30.000Z'
  const tools = settleToolCalls([
    { id: 'read-1', name: 'read', status: 'done', finishedAt: '2026-07-20T10:00:10.000Z' },
    { id: 'bash-1', name: 'bash', status: 'running' },
  ], { finishedAt })
  assert.equal(tools[0].finishedAt, '2026-07-20T10:00:10.000Z')
  assert.deepEqual(tools[1], { id: 'bash-1', name: 'bash', status: 'done', message: '', updatedAt: finishedAt, finishedAt })
})
