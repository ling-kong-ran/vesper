import assert from 'node:assert/strict'
import test from 'node:test'
import { createStreamingTextScheduler, createToolUpdateScheduler } from '../../src/lib/streaming-ui.js'

test('streaming text scheduler coalesces rapid updates into one flush', async () => {
  const frames = []
  const scheduler = createStreamingTextScheduler((text, activityAt) => frames.push({ text, activityAt }), { intervalMs: 20 })
  scheduler.push('a', 't1')
  scheduler.push('ab', 't2')
  scheduler.push('abc', 't3')
  assert.deepEqual(frames, [])
  await new Promise((resolve) => setTimeout(resolve, 35))
  assert.deepEqual(frames, [{ text: 'abc', activityAt: 't3' }])
  scheduler.push('abcd', 't4')
  scheduler.flush()
  assert.deepEqual(frames.at(-1), { text: 'abcd', activityAt: 't4' })
  scheduler.cancel()
})

test('tool update scheduler merges patches by tool id', async () => {
  const frames = []
  const scheduler = createToolUpdateScheduler((batch, activityAt) => frames.push({ batch: Object.fromEntries(batch), activityAt }), { intervalMs: 20 })
  scheduler.push('tool-1', { message: 'a' }, 't1')
  scheduler.push('tool-1', { message: 'ab', agent: { status: 'running' } }, 't2')
  scheduler.push('tool-2', { message: 'x' }, 't3')
  await new Promise((resolve) => setTimeout(resolve, 35))
  assert.equal(frames.length, 1)
  assert.deepEqual(frames[0].batch['tool-1'], { message: 'ab', agent: { status: 'running' } })
  assert.deepEqual(frames[0].batch['tool-2'], { message: 'x' })
  assert.equal(frames[0].activityAt, 't3')
  scheduler.cancel()
})
