import { extname } from 'node:path'
import { readJson, writeJsonAtomic } from '../../storage/json-file.mjs'
import { FeishuGateway } from './feishu-gateway.mjs'
import { FeishuOnboardingService } from './feishu-onboarding.mjs'

const TEXT_EXTENSIONS = new Set(['.txt', '.md', '.json', '.js', '.jsx', '.ts', '.tsx', '.css', '.html', '.xml', '.yaml', '.yml', '.csv', '.log', '.py', '.java', '.go', '.rs', '.sh', '.ps1', '.toml', '.sql'])
const DOCUMENT_EXTENSIONS = new Set(['.pdf', '.docx', '.pptx', '.xlsx', '.odt', '.odp', '.ods', '.rtf', '.epub'])
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'])

function defaultState() {
  return { version: 2, connection: null, scopes: {} }
}

function maskAppId(value) {
  const id = String(value || '')
  return id.length > 10 ? `${id.slice(0, 7)}••••${id.slice(-4)}` : id
}

function publicScope(chatId, scope) {
  return {
    chatId,
    chatType: scope.chatType || 'group',
    sessionId: scope.sessionId || '',
    title: scope.title || chatId,
    senderName: scope.senderName || '',
    cwd: scope.cwd || '',
    lastMessage: scope.lastMessage || '',
    updatedAt: scope.updatedAt || null,
  }
}

function attachmentFromResource(resource) {
  const extension = extname(resource.name || '').toLowerCase()
  if (resource.type === 'image' || IMAGE_EXTENSIONS.has(extension)) {
    const mimeType = extension === '.jpg' || extension === '.jpeg' ? 'image/jpeg' : extension === '.webp' ? 'image/webp' : extension === '.gif' ? 'image/gif' : 'image/png'
    return { kind: 'image', name: resource.name, mimeType, size: resource.buffer.length, data: resource.buffer.toString('base64') }
  }
  if (TEXT_EXTENSIONS.has(extension)) return { kind: 'text', name: resource.name, size: resource.buffer.length, text: resource.buffer.toString('utf8') }
  if (DOCUMENT_EXTENSIONS.has(extension)) return { kind: 'document', name: resource.name, size: resource.buffer.length, extension, data: resource.buffer.toString('base64') }
  return null
}

export class ChannelService {
  constructor({ path, cwd, agent, gatewayFactory, onboardingFactory }) {
    this.path = path
    this.cwd = cwd
    this.agent = agent
    this.state = defaultState()
    this.writeQueue = Promise.resolve()
    this.chatQueues = new Map()
    this.gateway = gatewayFactory
      ? gatewayFactory({ onMessage: (message) => this.enqueue(message) })
      : new FeishuGateway({ onMessage: (message) => this.enqueue(message) })
    this.onboarding = onboardingFactory
      ? onboardingFactory({ onCompleted: (credentials) => this.completeOnboarding(credentials) })
      : new FeishuOnboardingService({ onCompleted: (credentials) => this.completeOnboarding(credentials) })
  }

  async init() {
    const stored = await readJson(this.path, defaultState())
    if (stored?.version === 2) {
      this.state = { version: 2, connection: stored.connection || null, scopes: stored.scopes && typeof stored.scopes === 'object' ? stored.scopes : {} }
    } else {
      this.state = defaultState()
      await this.save()
    }
    if (this.state.connection?.enabled) void this.connect().catch(() => {})
  }

  save() {
    const snapshot = JSON.parse(JSON.stringify(this.state))
    this.writeQueue = this.writeQueue.catch(() => {}).then(() => writeJsonAtomic(this.path, snapshot))
    return this.writeQueue
  }

  getState() {
    const connection = this.state.connection
    const live = this.gateway.getStatus()
    return {
      providers: [{
        type: 'feishu',
        name: '飞书应用机器人',
        description: '扫码创建应用，通过 WebSocket 长连接双向收发消息',
        connected: live.state === 'connected',
        status: live.state,
      }],
      connection: connection ? {
        id: 'feishu',
        type: 'feishu',
        name: connection.name || live.bot?.name || 'Pi Coder Agent',
        enabled: connection.enabled !== false,
        appId: maskAppId(connection.appId),
        domain: connection.domain || 'feishu',
        accessMode: connection.accessMode || 'owner',
        defaultCwd: connection.defaultCwd || this.cwd,
        ownerConfigured: Boolean(connection.ownerOpenId),
        bot: live.bot,
        status: live.state,
        lastError: live.lastError || '',
        connectedAt: live.connectedAt,
        reconnectAttempts: live.reconnectAttempts || 0,
      } : null,
      scopes: Object.entries(this.state.scopes).map(([chatId, scope]) => publicScope(chatId, scope)).sort((a, b) => new Date(b.updatedAt || 0) - new Date(a.updatedAt || 0)),
    }
  }

  startOnboarding() {
    return this.onboarding.start()
  }

  getOnboarding(id) {
    return this.onboarding.get(id)
  }

  cancelOnboarding(id) {
    return this.onboarding.cancel(id)
  }

  async completeOnboarding(credentials) {
    this.state.connection = {
      name: 'Pi Coder Agent',
      appId: credentials.appId,
      appSecret: credentials.appSecret,
      ownerOpenId: credentials.ownerOpenId || '',
      domain: credentials.domain || 'feishu',
      accessMode: 'owner',
      defaultCwd: this.cwd,
      enabled: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    this.state.scopes = {}
    await this.save()
    const status = await this.connect()
    if (status.bot?.name) {
      this.state.connection.name = status.bot.name
      await this.save()
    }
    return this.getState()
  }

  async connect() {
    const connection = this.state.connection
    if (!connection?.appId || !connection?.appSecret) throw new Error('请先扫码创建飞书机器人。')
    if (connection.enabled === false) return this.gateway.getStatus()
    return this.gateway.connect(connection)
  }

  async update(input) {
    if (!this.state.connection) throw new Error('飞书机器人尚未创建。')
    if (Object.hasOwn(input || {}, 'enabled')) this.state.connection.enabled = Boolean(input.enabled)
    if (Object.hasOwn(input || {}, 'accessMode')) this.state.connection.accessMode = input.accessMode === 'tenant' ? 'tenant' : 'owner'
    if (Object.hasOwn(input || {}, 'defaultCwd')) this.state.connection.defaultCwd = await this.agent.validateDirectory(input.defaultCwd)
    this.state.connection.updatedAt = new Date().toISOString()
    await this.save()
    if (this.state.connection.enabled) await this.connect()
    else await this.gateway.disconnect()
    return this.getState()
  }

  async remove() {
    await this.gateway.disconnect()
    this.state = defaultState()
    await this.save()
    return true
  }

  async resetScope(chatId) {
    if (!this.state.scopes[chatId]) return false
    delete this.state.scopes[chatId]
    await this.save()
    return true
  }

  enqueue(message) {
    const previous = this.chatQueues.get(message.chatId) || Promise.resolve()
    const next = previous.catch(() => {}).then(() => this.handleMessage(message))
    this.chatQueues.set(message.chatId, next)
    next.finally(() => { if (this.chatQueues.get(message.chatId) === next) this.chatQueues.delete(message.chatId) }).catch(() => {})
  }

  async handleMessage(message) {
    const connection = this.state.connection
    if (!connection?.enabled) return
    if (connection.accessMode !== 'tenant' && (!connection.ownerOpenId || message.senderId !== connection.ownerOpenId)) {
      await this.gateway.send(message, { text: connection.ownerOpenId ? '当前机器人仅允许扫码创建者使用。' : '未获取到创建者身份，请在渠道页重新扫码绑定或切换访问范围。' })
      return
    }
    const command = message.content.trim().toLowerCase()
    if (command === '/new' || command === '/reset') {
      await this.resetScope(message.chatId)
      await this.gateway.send(message, { text: '已开始新的 Pi Coder 会话。' })
      return
    }
    const scope = this.state.scopes[message.chatId] || {}
    if (command === '/status') {
      await this.gateway.send(message, { text: scope.sessionId ? `会话：${scope.sessionId}\n工作目录：${scope.cwd || connection.defaultCwd}` : '当前聊天还没有绑定 Pi Coder 会话。' })
      return
    }
    if (command === '/stop') {
      const stopped = scope.sessionId ? await this.agent.abort(scope.sessionId) : false
      await this.gateway.send(message, { text: stopped ? '已停止当前任务。' : '当前没有运行中的任务。' })
      return
    }

    try {
      const resources = await this.gateway.downloadResources(message.resources)
      const attachments = resources.map(attachmentFromResource).filter(Boolean)
      const prompt = message.content.trim() || (attachments.length ? '请分析这些附件。' : '')
      if (!prompt) return
      const result = await this.agent.prompt({
        sessionId: scope.sessionId || '',
        message: prompt,
        attachments,
        cwd: scope.cwd || connection.defaultCwd || this.cwd,
        title: `飞书 · ${message.senderName || (message.chatType === 'p2p' ? '私聊' : '群聊')}`,
      })
      this.state.scopes[message.chatId] = {
        ...scope,
        sessionId: result.sessionId,
        chatType: message.chatType,
        senderName: message.senderName || '',
        title: message.senderName || (message.chatType === 'p2p' ? '飞书私聊' : '飞书群聊'),
        cwd: result.cwd || scope.cwd || connection.defaultCwd || this.cwd,
        lastMessage: prompt.slice(0, 120),
        updatedAt: new Date().toISOString(),
      }
      await this.save()
      await this.gateway.send(message, { markdown: result.text || '任务已完成。' })
      for (const asset of result.assets || []) {
        const input = asset.mimeType?.startsWith('image/')
          ? { image: { source: asset.path } }
          : asset.mimeType?.startsWith('video/')
            ? { video: { source: asset.path } }
            : { file: { source: asset.path, fileName: asset.name } }
        await this.gateway.sendToChat(message.chatId, input)
      }
    } catch (error) {
      await this.gateway.send(message, { text: `执行失败：${error instanceof Error ? error.message : String(error)}` }).catch(() => {})
    }
  }

  async dispose() {
    this.onboarding.dispose()
    await this.gateway.disconnect()
  }
}
