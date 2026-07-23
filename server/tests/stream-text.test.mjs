import assert from 'node:assert/strict'
import test from 'node:test'
import { splitAssistantStreamText } from '../../src/features/chat/stream-text.js'

test('without tools the full stream stays in one body block', () => {
  assert.deepEqual(
    splitAssistantStreamText('hello world', 'hello', { streaming: true, hasTools: false }),
    { lead: '', body: 'hello world' },
  )
})

test('with tools the preamble stays above and only new text streams below', () => {
  assert.deepEqual(
    splitAssistantStreamText('hello world and more', 'hello world', { streaming: true, hasTools: true }),
    { lead: 'hello world', body: 'and more' },
  )
})

test('repeated preamble after tools is stripped from the body', () => {
  assert.deepEqual(
    splitAssistantStreamText('hello world\nhello world\nfinal', 'hello world', { streaming: true, hasTools: true }),
    { lead: 'hello world', body: 'final' },
  )
})

test('finished messages render as a single full body', () => {
  assert.deepEqual(
    splitAssistantStreamText('hello world\nfinal', 'hello world', { streaming: false, hasTools: true }),
    { lead: '', body: 'hello world\nfinal' },
  )
})
