import assert from 'node:assert/strict'
import test from 'node:test'
import { applySessionUpdate, DEFAULT_SESSION_STATE, sessionStateChanged } from '../../src/lib/session-state.js'

test('session state update bails out when nothing changed', () => {
  const previous = { ...DEFAULT_SESSION_STATE, streaming: true, error: '' }
  const same = applySessionUpdate(previous, { streaming: true, error: '' })
  assert.equal(same, previous)
  assert.equal(sessionStateChanged(previous, same), false)
})

test('session state update returns a new object when fields change', () => {
  const previous = { ...DEFAULT_SESSION_STATE, streaming: true }
  const next = applySessionUpdate(previous, (current) => ({ ...current, streaming: false }))
  assert.notEqual(next, previous)
  assert.equal(next.streaming, false)
})
