import assert from 'node:assert/strict'
import test from 'node:test'
import { legacyHashPath, pageFromPath, pagePath } from '../../src/app/routes.js'

test('page ids map to stable application paths', () => {
  assert.equal(pagePath('chat'), '/chat')
  assert.equal(pagePath('chatHistory'), '/chat/history')
  assert.equal(pagePath('workflowCreate'), '/workflows/new')
  assert.equal(pagePath('unknown'), '/chat')
})

test('router paths resolve to page ids and tolerate trailing slashes', () => {
  assert.equal(pageFromPath('/config'), 'config')
  assert.equal(pageFromPath('/chat/history/'), 'chatHistory')
  assert.equal(pageFromPath('/unknown'), null)
})

test('legacy hash urls migrate without changing modern router urls', () => {
  assert.equal(legacyHashPath('#chat'), '/chat')
  assert.equal(legacyHashPath('#workflowCreate'), '/workflows/new')
  assert.equal(legacyHashPath('#/chat'), null)
})
