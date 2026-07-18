import { readJson, writeJsonAtomic } from '../storage/json-file.mjs'

export class NotificationSettingsService {
  constructor({ path, channels }) {
    this.path = path
    this.channels = channels
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
    return this.channels.testNotification(event, platform)
  }

  notify(event, data) {
    return this.channels.notify(event, data)
  }
}
