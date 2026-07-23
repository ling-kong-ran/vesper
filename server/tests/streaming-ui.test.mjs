import assert from 'node:assert/strict'
import test from 'node:test'
import { createStreamingTextScheduler } from '../../src/lib/streaming-ui.js'

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
