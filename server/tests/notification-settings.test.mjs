import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { NotificationSettingsService } from '../services/notification-settings-service.mjs'

test('browser notification setting persists without overwriting other app configuration', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'pi-coder-notifications-'))
  const path = join(directory, 'pi-coder.json')
  t.after(() => rm(directory, { recursive: true, force: true }))
  await writeFile(path, JSON.stringify({ toolMode: 'workspace', disabledProviders: ['example'] }))
  const channels = {
    getState: () => ({ templates: [{ id: 'schedule.completed' }], connections: {}, scopes: [] }),
  }
  const service = new NotificationSettingsService({ path, channels })
  assert.equal((await service.getState()).browser.enabled, false)
  const updated = await service.updateBrowser({ enabled: true })
  assert.equal(updated.browser.enabled, true)
  const stored = JSON.parse(await readFile(path, 'utf8'))
  assert.equal(stored.toolMode, 'workspace')
  assert.deepEqual(stored.disabledProviders, ['example'])
  assert.equal(stored.notifications.browser.enabled, true)
})

test('notification templates remain delegated to the channel notification service', async () => {
  const calls = []
  const channels = {
    getState: () => ({ templates: [], connections: {}, scopes: [] }),
    updateTemplate: async (...args) => { calls.push(['update', ...args]) },
    testNotification: async (...args) => { calls.push(['test', ...args]); return { sent: 1 } },
    notify: async (...args) => { calls.push(['notify', ...args]); return [] },
  }
  const service = new NotificationSettingsService({ path: 'unused.json', channels })
  await service.updateTemplate('workflow.completed', 'feishu', { content: 'done' })
  assert.deepEqual(await service.testTemplate('workflow.completed', 'feishu'), { sent: 1 })
  await service.notify('workflow.completed', { workflow: { name: 'release' } })
  assert.deepEqual(calls, [
    ['update', 'workflow.completed', 'feishu', { content: 'done' }],
    ['test', 'workflow.completed', 'feishu'],
    ['notify', 'workflow.completed', { workflow: { name: 'release' } }],
  ])
})
