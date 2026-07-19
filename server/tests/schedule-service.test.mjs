import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { calculateNextRun, ScheduleService } from '../services/schedule-service.mjs'

async function waitFor(predicate, timeoutMs = 1500) {
  const started = Date.now()
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error('Timed out waiting for scheduled task execution.')
    await new Promise((resolve) => setTimeout(resolve, 10))
  }
}

test('next run calculation supports daily, weekly and monthly schedules', () => {
  const from = new Date('2026-07-18T10:00:00.000Z')
  assert.equal(calculateNextRun({ frequency: 'interval', intervalValue: 30, intervalUnit: 'minutes' }, from), '2026-07-18T10:30:00.000Z')
  assert.equal(calculateNextRun({ frequency: 'interval', intervalValue: 6, intervalUnit: 'hours' }, from), '2026-07-18T16:00:00.000Z')
  assert.equal(calculateNextRun({ frequency: 'daily', time: '09:00', timezone: 'UTC' }, from), '2026-07-19T09:00:00.000Z')
  assert.equal(calculateNextRun({ frequency: 'weekly', dayOfWeek: 0, time: '09:00', timezone: 'UTC' }, from), '2026-07-19T09:00:00.000Z')
  assert.equal(calculateNextRun({ frequency: 'monthly', dayOfMonth: 1, time: '09:00', timezone: 'UTC' }, from), '2026-08-01T09:00:00.000Z')
})

test('scheduled tasks persist, execute with the selected model and notify multiple targets', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'vesper-schedules-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const prompts = []
  const notifications = []
  const service = new ScheduleService({
    path: join(directory, 'schedules.json'),
    cwd: directory,
    tickMs: 60_000,
    agent: {
      validateDirectory: async (cwd) => cwd || directory,
      prompt: async (input) => { prompts.push(input); return { sessionId: 'session-1', text: '检查完成，没有发现失败测试。' } },
    },
    notifications: { notify: async (...args) => { notifications.push(args) } },
  })
  await service.init()
  t.after(() => service.dispose())
  const task = await service.create({
    name: '每日检查', prompt: '运行测试', frequency: 'daily', time: '09:00', timezone: 'UTC', cwd: directory,
    model: { provider: 'openai', model: 'gpt-5.4' }, notifications: ['browser', 'feishu', 'weixin'], notifyOn: 'always',
  })
  await service.runNow(task.id)
  await waitFor(() => notifications.length === 1)
  const state = service.getState()
  assert.equal(state.tasks[0].lastStatus, 'completed')
  assert.equal(state.runs[0].status, 'completed')
  assert.deepEqual(prompts[0].model, { provider: 'openai', model: 'gpt-5.4' })
  assert.deepEqual(notifications[0][2], { platforms: ['browser', 'feishu', 'weixin'] })
  assert.equal(notifications[0][0], 'schedule.completed')
  assert.match(notifications[0][1].task.summary, /检查完成/)
})

test('failure-only tasks suppress success notifications and send failure templates', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'vesper-schedules-failure-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const notifications = []
  let shouldFail = false
  const service = new ScheduleService({
    path: join(directory, 'schedules.json'), cwd: directory, tickMs: 60_000,
    agent: { validateDirectory: async () => directory, prompt: async () => { if (shouldFail) throw new Error('测试超时'); return { text: 'ok' } } },
    notifications: { notify: async (...args) => { notifications.push(args) } },
  })
  await service.init()
  t.after(() => service.dispose())
  const task = await service.create({ name: '失败通知', prompt: 'test', frequency: 'daily', time: '09:00', timezone: 'UTC', notifications: ['browser'], notifyOn: 'failure' })
  await service.runNow(task.id)
  await waitFor(() => service.getState().tasks[0].lastStatus === 'completed')
  assert.equal(notifications.length, 0)
  shouldFail = true
  await service.runNow(task.id)
  await waitFor(() => notifications.length === 1)
  assert.equal(notifications[0][0], 'schedule.failed')
  assert.equal(notifications[0][1].task.error, '测试超时')
})
