import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import test from 'node:test'
import { permissionRequirement, SessionPermissionService } from '../services/session-permission-service.mjs'

test('permission modes progress from ask to automatic to ignored checks', () => {
  const cwd = resolve('workspace')
  const outside = resolve(cwd, '..', 'outside.txt')
  assert.equal(permissionRequirement({ mode: 'ask', cwd, toolName: 'read', args: { path: 'README.md' } }), null)
  assert.match(permissionRequirement({ mode: 'ask', cwd, toolName: 'read', args: { path: outside } }).reason, /工作目录之外/)
  assert.match(permissionRequirement({ mode: 'ask', cwd, toolName: 'write', args: { path: 'README.md' } }).reason, /需要确认/)
  assert.match(permissionRequirement({ mode: 'ask', cwd, toolName: 'delegate_task', args: { task: 'inspect the repository' } }).reason, /需要确认/)
  assert.equal(permissionRequirement({ mode: 'ask', cwd, toolName: 'mcp_read_123', toolRisk: '低风险', args: {} }), null)
  assert.match(permissionRequirement({ mode: 'ask', cwd, toolName: 'mcp_write_456', toolRisk: '高风险', args: {} }).reason, /需要确认/)
  assert.equal(permissionRequirement({ mode: 'ask', cwd, toolName: 'update_goal', args: { status: 'complete' } }), null)
  assert.equal(permissionRequirement({ mode: 'auto', cwd, toolName: 'write', args: { path: 'README.md' } }), null)
  assert.match(permissionRequirement({ mode: 'auto', cwd, toolName: 'write', args: { path: outside } }).reason, /工作目录之外/)
  assert.match(permissionRequirement({ mode: 'auto', cwd, toolName: 'bash', args: { command: 'git reset --hard' } }).reason, /Shell/)
  assert.equal(permissionRequirement({ mode: 'ignore', cwd, toolName: 'bash', args: { command: 'rm -rf /' } }), null)
})

test('pending tool approval can be accepted or denied', async () => {
  let mode = 'ask'
  const events = []
  const service = new SessionPermissionService({ getMode: () => mode, timeoutMs: 5000 })
  service.attachEmitter('session-1', (event, data) => events.push({ event, data }))

  const allowed = service.authorize({ sessionId: 'session-1', cwd: process.cwd(), toolName: 'write', toolCallId: 'tool-1', args: { path: 'file.txt', content: 'ok' } })
  const first = service.getPending('session-1')[0]
  assert.equal(first.toolName, 'write')
  assert.equal(service.resolve('session-1', first.id, true), true)
  assert.equal(await allowed, undefined)

  const denied = service.authorize({ sessionId: 'session-1', cwd: process.cwd(), toolName: 'bash', toolCallId: 'tool-2', args: { command: 'npm test' } })
  const second = service.getPending('session-1')[0]
  service.resolve('session-1', second.id, false)
  assert.deepEqual(await denied, { block: true, reason: '用户拒绝执行该工具。' })
  assert.ok(events.some((item) => item.event === 'permission_request'))
  assert.ok(events.some((item) => item.event === 'permission_resolved'))

  mode = 'ignore'
  assert.equal(await service.authorize({ sessionId: 'session-1', cwd: process.cwd(), toolName: 'bash', args: { command: 'rm -rf /' } }), undefined)
  service.dispose()
})

test('session hook preserves upstream tool blockers before permission checks', async () => {
  const session = { agent: { beforeToolCall: async () => ({ block: true, reason: 'extension blocked' }) } }
  const service = new SessionPermissionService({ getMode: () => 'ask' })
  service.install(session, { sessionId: 'session-hook', cwd: process.cwd() })
  const result = await session.agent.beforeToolCall({
    toolCall: { id: 'tool-hook', name: 'write' },
    args: { path: 'file.txt', content: 'content' },
  })
  assert.deepEqual(result, { block: true, reason: 'extension blocked' })
  assert.deepEqual(service.getPending('session-hook'), [])
  service.dispose()
})
