import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { NotificationSettingsService } from '../services/notification-settings-service.mjs'

test('browser notification setting persists without overwriting other app configuration', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'vesper-notifications-'))
  const path = join(directory, 'vesper.json')
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
    getState: () => ({ templates: [{ id: 'workflow.completed', enabled: true }], connections: {}, scopes: [] }),
    updateTemplate: async (...args) => { calls.push(['update', ...args]) },
    testNotification: async (...args) => { calls.push(['test', ...args]); return { sent: 1 } },
    notify: async (...args) => { calls.push(['notify', ...args]); return [] },
  }
  const service = new NotificationSettingsService({ path: 'unused.json', channels })
  await service.updateTemplate('workflow.completed', 'feishu', { content: 'done' })
  assert.deepEqual(await service.testTemplate('workflow.completed', 'feishu'), { sent: 1 })
  await service.notify('workflow.completed', { workflow: { name: 'release' } }, { platforms: ['feishu'] })
  assert.deepEqual(calls, [
    ['update', 'workflow.completed', 'feishu', { content: 'done' }],
    ['test', 'workflow.completed', 'feishu'],
    ['notify', 'workflow.completed', { workflow: { name: 'release' } }, { platforms: ['feishu'] }],
  ])
})

test('browser notification events use the configured template queue', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'vesper-browser-events-'))
  const path = join(directory, 'vesper.json')
  const browserEventsPath = join(directory, 'browser-events.json')
  t.after(() => rm(directory, { recursive: true, force: true }))
  await writeFile(path, JSON.stringify({ notifications: { browser: { enabled: true } } }))
  const channels = {
    getState: () => ({ templates: [{ id: 'schedule.completed', enabled: true }], connections: {}, scopes: [] }),
    notify: async () => [],
    renderNotification: () => ({ title: '定时任务完成', content: '日报已完成' }),
  }
  const service = new NotificationSettingsService({ path, browserEventsPath, channels })
  await service.notify('schedule.completed', { task: { name: '日报' } }, { platforms: ['browser'] })
  const first = await service.getBrowserEvents('missing')
  assert.equal(first.events.length, 1)
  assert.equal(first.events[0].body, '日报已完成')
  assert.equal((await service.getBrowserEvents(first.latestId)).events.length, 0)
})

test('channel notification failures are reported after other targets are attempted', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'vesper-notification-failure-'))
  const path = join(directory, 'vesper.json')
  const browserEventsPath = join(directory, 'browser-events.json')
  t.after(() => rm(directory, { recursive: true, force: true }))
  await writeFile(path, JSON.stringify({ notifications: { browser: { enabled: true } } }))
  const channels = {
    getState: () => ({ templates: [{ id: 'schedule.completed', enabled: true }], connections: {}, scopes: [] }),
    notify: async () => [{ platform: 'weixin', status: 'rejected', error: 'prepare failed' }],
    renderNotification: () => ({ title: 'Schedule completed', content: 'Daily task completed' }),
  }
  const service = new NotificationSettingsService({ path, browserEventsPath, channels })
  await assert.rejects(
    service.notify('schedule.completed', { task: { name: 'daily' } }, { platforms: ['weixin', 'browser'] }),
    /weixin: prepare failed/,
  )
  assert.equal((await service.getBrowserEvents('missing')).events.length, 1)
})
