import { randomUUID } from 'node:crypto'
import { readJson, writeJsonAtomic } from '../storage/json-file.mjs'
import { sampleNotificationData } from './channels/notification-templates.mjs'

export class NotificationSettingsService {
  constructor({ path, browserEventsPath, channels }) {
    this.path = path
    this.browserEventsPath = browserEventsPath
    this.channels = channels
    this.eventWrite = Promise.resolve()
  }

  async getState() {
    const appConfig = await readJson(this.path, {})
    return {
      ...this.channels.getState(),
      browser: {
        enabled: appConfig.notifications?.browser?.enabled === true,
      },
    }
  }

  async updateBrowser(input) {
    const appConfig = await readJson(this.path, {})
    await writeJsonAtomic(this.path, {
      ...appConfig,
      notifications: {
        ...(appConfig.notifications || {}),
        browser: {
          ...(appConfig.notifications?.browser || {}),
          enabled: Boolean(input?.enabled),
        },
      },
    })
    return this.getState()
  }

  async updateTemplate(event, platform, input) {
    await this.channels.updateTemplate(event, platform, input)
    return this.getState()
  }

  testTemplate(event, platform) {
    if (platform === 'browser') return this.testBrowserTemplate(event)
    return this.channels.testNotification(event, platform)
  }

  async testBrowserTemplate(event) {
    const rendered = this.channels.renderNotification(event, 'browser', sampleNotificationData())
    const published = await this.publishBrowser(rendered.title, rendered.content, event)
    if (!published) throw new Error('请先启用浏览器通知。')
    return { sent: 1, preview: rendered.content }
  }

  async publishBrowser(title, body, event = '') {
    const appConfig = await readJson(this.path, {})
    if (appConfig.notifications?.browser?.enabled !== true || !this.browserEventsPath) return false
    const item = { id: randomUUID(), title: String(title || 'Vesper'), body: String(body || ''), event, createdAt: new Date().toISOString() }
    this.eventWrite = this.eventWrite.catch(() => {}).then(async () => {
      const ledger = await readJson(this.browserEventsPath, { events: [] })
      ledger.events = [...(Array.isArray(ledger.events) ? ledger.events : []), item].slice(-100)
      await writeJsonAtomic(this.browserEventsPath, ledger)
    })
    await this.eventWrite
    return true
  }

  async getBrowserEvents(after = '') {
    const ledger = await readJson(this.browserEventsPath, { events: [] })
    const events = Array.isArray(ledger.events) ? ledger.events : []
    const index = after ? events.findIndex((item) => item.id === after) : events.length - 1
    return { events: index >= 0 ? events.slice(index + 1) : events.slice(-20), latestId: events.at(-1)?.id || '' }
  }

  async notify(event, data, { platforms } = {}) {
    const selected = new Set(platforms || ['feishu', 'weixin', 'browser'])
    const template = this.channels.getState().templates.find((item) => item.id === event)
    if (!template?.enabled) return []
    const results = await this.channels.notify(event, data, { platforms: [...selected].filter((platform) => platform !== 'browser') })
    if (selected.has('browser')) {
      const rendered = this.channels.renderNotification(event, 'browser', data)
      await this.publishBrowser(rendered.title, rendered.content, event)
    }
    return results
  }
}
