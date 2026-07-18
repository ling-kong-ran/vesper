import { createHmac, randomUUID } from 'node:crypto'
import { readJson, writeJsonAtomic } from '../../storage/json-file.mjs'

const CHANNEL_TYPES = new Set(['feishu', 'wecom'])
const CHANNEL_EVENTS = new Set(['agent.completed', 'agent.failed'])
const OFFICIAL_DOCS = {
  feishu: 'https://open.feishu.cn/document/client-docs/bot-v3/add-custom-bot',
  wecom: 'https://developer.work.weixin.qq.com/document/path/91770',
}

function cleanName(value, fallback) {
  return String(value || fallback || '').trim().slice(0, 80)
}

function validateWebhook(type, input) {
  let url
  try {
    url = new URL(String(input || '').trim())
  } catch {
    throw new Error('Webhook URL 格式不正确。')
  }
  if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Webhook 必须使用无账号信息的 HTTPS 地址。')
  if (type === 'feishu') {
    const officialHost = url.hostname === 'open.feishu.cn' || url.hostname === 'open.larksuite.com'
    if (!officialHost || !url.pathname.startsWith('/open-apis/bot/v2/hook/')) throw new Error('请粘贴飞书官方自定义机器人的 Webhook 地址。')
  } else if (type === 'wecom') {
    if (url.hostname !== 'qyapi.weixin.qq.com' || url.pathname !== '/cgi-bin/webhook/send' || !url.searchParams.get('key')) {
      throw new Error('请粘贴企业微信官方消息推送 Webhook 地址。')
    }
  }
  return url.toString()
}

function webhookPreview(value) {
  if (!value) return ''
  const url = new URL(value)
  if (url.searchParams.has('key')) url.searchParams.set('key', '••••••••')
  else {
    const parts = url.pathname.split('/')
    parts[parts.length - 1] = '••••••••'
    url.pathname = parts.join('/')
  }
  return url.toString()
}

function publicChannel(channel) {
  return {
    id: channel.id,
    type: channel.type,
    name: channel.name,
    enabled: channel.enabled,
    mode: 'webhook',
    events: channel.events,
    webhookConfigured: Boolean(channel.webhookUrl),
    webhookPreview: webhookPreview(channel.webhookUrl),
    signingSecretConfigured: Boolean(channel.signingSecret),
    createdAt: channel.createdAt,
    updatedAt: channel.updatedAt,
    lastTest: channel.lastTest || null,
  }
}

function eventList(input, fallback = []) {
  if (!Array.isArray(input)) return fallback
  return [...new Set(input.filter((event) => CHANNEL_EVENTS.has(event)))]
}

function feishuPayload(text, secret) {
  const payload = { msg_type: 'text', content: { text } }
  if (!secret) return payload
  const timestamp = Math.floor(Date.now() / 1000).toString()
  return {
    timestamp,
    sign: createHmac('sha256', `${timestamp}\n${secret}`).update('').digest('base64'),
    ...payload,
  }
}

function responseError(type, data) {
  if (type === 'feishu') {
    const code = Number(data?.code ?? data?.StatusCode ?? 0)
    if (code !== 0) return data?.msg || data?.StatusMessage || `飞书返回错误码 ${code}`
  } else {
    const code = Number(data?.errcode ?? 0)
    if (code !== 0) return data?.errmsg || `企业微信返回错误码 ${code}`
  }
  return ''
}

export class ChannelService {
  constructor({ path, fetchImpl = globalThis.fetch }) {
    this.path = path
    this.fetchImpl = fetchImpl
    this.state = { version: 1, channels: [] }
    this.writeQueue = Promise.resolve()
  }

  async init() {
    const stored = await readJson(this.path, { version: 1, channels: [] })
    this.state = {
      version: 1,
      channels: Array.isArray(stored?.channels) ? stored.channels.filter((item) => CHANNEL_TYPES.has(item?.type)).map((item) => ({
        ...item,
        enabled: item.enabled !== false,
        events: eventList(item.events, []),
      })) : [],
    }
  }

  save() {
    const snapshot = JSON.parse(JSON.stringify(this.state))
    this.writeQueue = this.writeQueue.catch(() => {}).then(() => writeJsonAtomic(this.path, snapshot))
    return this.writeQueue
  }

  getState() {
    return {
      channels: this.state.channels.map(publicChannel),
      capabilities: {
        feishu: {
          quickConnect: false,
          reason: '飞书官方自定义机器人需在目标群内添加；扫码登录不能直接创建可用的群机器人。',
          docsUrl: OFFICIAL_DOCS.feishu,
        },
        wecom: {
          quickConnect: false,
          reason: '企业微信官方消息推送需由群成员在目标群内创建。',
          docsUrl: OFFICIAL_DOCS.wecom,
        },
      },
    }
  }

  async create(input) {
    const type = String(input?.type || '')
    if (!CHANNEL_TYPES.has(type)) throw new Error('暂不支持这个渠道类型。')
    const webhookUrl = validateWebhook(type, input?.webhookUrl)
    const now = new Date().toISOString()
    const channel = {
      id: randomUUID(),
      type,
      name: cleanName(input?.name, type === 'feishu' ? '飞书通知群' : '企业微信群通知'),
      enabled: input?.enabled !== false,
      events: eventList(input?.events, ['agent.completed', 'agent.failed']),
      webhookUrl,
      signingSecret: type === 'feishu' ? String(input?.signingSecret || '').trim() : '',
      createdAt: now,
      updatedAt: now,
      lastTest: null,
    }
    this.state.channels.unshift(channel)
    await this.save()
    return publicChannel(channel)
  }

  async update(id, input) {
    const channel = this.state.channels.find((item) => item.id === id)
    if (!channel) return null
    if (Object.hasOwn(input || {}, 'name')) channel.name = cleanName(input.name, channel.name)
    if (Object.hasOwn(input || {}, 'enabled')) channel.enabled = Boolean(input.enabled)
    if (Object.hasOwn(input || {}, 'events')) channel.events = eventList(input.events, channel.events)
    if (String(input?.webhookUrl || '').trim()) {
      channel.webhookUrl = validateWebhook(channel.type, input.webhookUrl)
      channel.lastTest = null
    }
    if (channel.type === 'feishu') {
      if (input?.clearSigningSecret) channel.signingSecret = ''
      else if (String(input?.signingSecret || '').trim()) channel.signingSecret = String(input.signingSecret).trim()
    }
    channel.updatedAt = new Date().toISOString()
    await this.save()
    return publicChannel(channel)
  }

  async delete(id) {
    const index = this.state.channels.findIndex((item) => item.id === id)
    if (index < 0) return false
    this.state.channels.splice(index, 1)
    await this.save()
    return true
  }

  async send(channel, text) {
    const payload = channel.type === 'feishu'
      ? feishuPayload(text, channel.signingSecret)
      : { msgtype: 'text', text: { content: text } }
    let response
    try {
      response = await this.fetchImpl(channel.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json; charset=utf-8' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(12_000),
      })
    } catch (error) {
      throw new Error(`无法连接渠道：${error instanceof Error ? error.message : String(error)}`)
    }
    const raw = await response.text()
    let data = {}
    try { data = raw ? JSON.parse(raw) : {} } catch { data = {} }
    if (!response.ok) throw new Error(`渠道请求失败（HTTP ${response.status}）`)
    const platformError = responseError(channel.type, data)
    if (platformError) throw new Error(platformError)
    return data
  }

  async test(id, input = {}) {
    const channel = this.state.channels.find((item) => item.id === id)
    if (!channel) return null
    const text = String(input.message || '✅ Pi Coder 渠道连接成功，这是一条测试消息。').trim().slice(0, 1000)
    try {
      await this.send(channel, text)
      channel.lastTest = { ok: true, at: new Date().toISOString(), message: '连接正常' }
      await this.save()
      return publicChannel(channel)
    } catch (error) {
      channel.lastTest = { ok: false, at: new Date().toISOString(), message: error instanceof Error ? error.message : String(error) }
      await this.save()
      throw error
    }
  }

  async notify(event, details = {}) {
    if (!CHANNEL_EVENTS.has(event)) return []
    const title = cleanName(details.name, '未命名会话')
    const text = event === 'agent.completed'
      ? `✅ Pi Coder 会话已完成\n${title}`
      : `❌ Pi Coder 会话执行失败\n${title}${details.error ? `\n${String(details.error).slice(0, 500)}` : ''}`
    const targets = this.state.channels.filter((channel) => channel.enabled && channel.events.includes(event))
    return Promise.allSettled(targets.map((channel) => this.send(channel, text)))
  }
}
