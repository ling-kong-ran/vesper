import { mkdir, open, readFile, readdir, stat, unlink, writeFile } from 'node:fs/promises'
import { createHash, randomUUID } from 'node:crypto'
import { basename, dirname, extname, join, resolve, sep } from 'node:path'
import { OfficeParser } from 'officeparser'
import {
  createAgentSession,
  ModelRuntime,
  SessionManager,
  SettingsManager,
} from '@earendil-works/pi-coding-agent'
import { readJson, writeJsonAtomic } from '../storage/json-file.mjs'
import { ChannelService } from '../services/channels/channel-service.mjs'
import { NotificationSettingsService } from '../services/notification-settings-service.mjs'
import { McpService } from '../services/mcp-service.mjs'
import { migrateKimiCodeProvider } from '../services/provider-migrations.mjs'
import { ScheduleService } from '../services/schedule-service.mjs'
import { SkillsService } from '../services/skills-service.mjs'
import { DEFAULT_PERMISSION_MODE, PERMISSION_MODES, SessionPermissionService } from '../services/session-permission-service.mjs'
import { ToolPluginService } from '../services/tool-plugin-service.mjs'
import { extractConversationMemories } from '../services/memory/conversation-memory.mjs'
import { LocalMemoryRuntime } from '../services/memory/local-memory-runtime.mjs'
import { inferModelKind, VisualGenerationService } from '../services/visual-generation/index.mjs'
import { SubagentService } from '../services/subagent-service.mjs'
import { GoalService, goalBudgetPrompt, goalContinuationPrompt, isGoalContinuationMessage } from '../services/goal-service.mjs'
import { assetMessageAttachment, attachGeneratedAssets } from '../services/session-assets.mjs'
import { forceNextToolCall, isVisualGenerationRequest } from '../services/visual-tool-routing.mjs'
import { createAppTools, TOOL_PRESETS, toolsFromConfig } from '../tools/registry.mjs'
import { createGoalTools, GOAL_TOOL_NAMES } from '../tools/app/goal.mjs'
import { createWindowsUtf8BashTool } from '../tools/windows-utf8-bash.mjs'

const KNOWN_PROVIDERS = ['openai', 'anthropic', 'google', 'deepseek', 'xai', 'openrouter', 'kimi-coding', 'zai-coding-cn']
const PROVIDER_LABELS = {
  openai: 'OpenAI',
  anthropic: 'Anthropic',
  google: 'Google',
  deepseek: 'DeepSeek',
  xai: 'xAI',
  openrouter: 'OpenRouter',
  'kimi-coding': 'Kimi Code',
  'zai-coding-cn': 'GLM',
}
const PROVIDER_DEFAULT_BASE_URLS = {
  'kimi-coding': 'https://api.kimi.com/coding/',
  'zai-coding-cn': 'https://open.bigmodel.cn/api/paas/v4',
}
const ATTACHMENT_MARKER = '\n\n---\n附件上下文（由 Vesper 注入）：\n'
const MAX_EXTRACTED_CHARS = 400_000
const MAX_ASSET_BYTES = 24 * 1024 * 1024
const MAX_CHAT_ASSET_BYTES = 10 * 1024 * 1024
const DEFAULT_SESSION_NAME = '新会话'
const MAX_SESSION_TITLE_CHARS = 20
const DEFAULT_MESSAGE_PAGE_SIZE = 40
const MAX_MESSAGE_PAGE_SIZE = 100
const LIVE_MESSAGE_PAGE_SIZE = 60
const ASSET_TEXT_EXTENSIONS = new Set(['.txt', '.md', '.json', '.js', '.jsx', '.ts', '.tsx', '.css', '.html', '.xml', '.yaml', '.yml', '.csv', '.log', '.py', '.java', '.go', '.rs', '.sh', '.ps1', '.toml', '.sql'])
const ASSET_DOCUMENT_EXTENSIONS = new Set(['.pdf', '.docx', '.pptx', '.xlsx', '.odt', '.odp', '.ods', '.rtf', '.epub'])
const IMAGE_EXTENSIONS = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp', '.svg'])
function textFromContent(content) {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content
    .filter((part) => part?.type === 'text')
    .map((part) => part.text || '')
    .join('')
}

function serializeMessage(message, index) {
  if (!message || !['user', 'assistant'].includes(message.role)) return null
  const rawText = textFromContent(message.content)
  if (message.role === 'user' && isGoalContinuationMessage(rawText)) return null
  const text = message.role === 'user' ? rawText.split(ATTACHMENT_MARKER)[0] : rawText
  if (!text) return null
  const attachments = Array.isArray(message.content)
    ? message.content.filter((part) => part?.type === 'image').map((part, attachmentIndex) => ({
        id: `image-${index}-${attachmentIndex}`,
        kind: 'image',
        name: `图片附件 ${attachmentIndex + 1}`,
        mimeType: part.mimeType,
        data: part.data,
      }))
    : []
  return {
    id: `${message.role}-${message.timestamp || index}-${index}`,
    role: message.role === 'assistant' ? 'agent' : 'user',
    text,
    timestamp: message.timestamp || null,
    error: message.role === 'assistant' ? message.errorMessage || null : null,
    attachments,
  }
}

function safeAttachmentName(name) {
  return String(name || '附件').replace(/[\r\n<>]/g, '_').slice(0, 180)
}

function mimeFromName(name) {
  const extension = extname(String(name || '')).toLowerCase()
  return ({
    '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
    '.txt': 'text/plain', '.md': 'text/markdown', '.json': 'application/json', '.js': 'text/javascript', '.ts': 'text/typescript', '.css': 'text/css', '.html': 'text/html',
    '.pdf': 'application/pdf', '.docx': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', '.pptx': 'application/vnd.openxmlformats-officedocument.presentationml.presentation', '.xlsx': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    '.mp4': 'video/mp4', '.webm': 'video/webm', '.mov': 'video/quicktime',
  })[extension] || 'application/octet-stream'
}

function truncateTitle(value) {
  const characters = Array.from(String(value || '').trim())
  return characters.length > MAX_SESSION_TITLE_CHARS
    ? `${characters.slice(0, MAX_SESSION_TITLE_CHARS).join('')}…`
    : characters.join('')
}

function cleanSessionTitle(value) {
  const title = String(value || '')
    .split(/\r?\n/)[0]
    .replace(/^\s*(?:[-*#>]+\s*)?/, '')
    .replace(/^\s*(?:会话)?标题\s*[:：]\s*/i, '')
    .replace(/^[“”"'`]+|[“”"'`。.!！?？]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return truncateTitle(title)
}

function localDayKey(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (part) => String(part).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`
}

function normalizedUsage(usage) {
  const number = (value) => Number.isFinite(Number(value)) ? Math.max(0, Number(value)) : 0
  return {
    input: number(usage?.input),
    output: number(usage?.output),
    cacheRead: number(usage?.cacheRead),
    cacheWrite: number(usage?.cacheWrite),
    reasoning: number(usage?.reasoning),
    totalTokens: number(usage?.totalTokens ?? usage?.total),
  }
}

function addUsage(target, usage) {
  const value = normalizedUsage(usage)
  for (const key of Object.keys(value)) target[key] = (target[key] || 0) + value[key]
  return target
}

async function resolveDirectory(input, fallback) {
  const directory = resolve(String(input || fallback || '').trim())
  const info = await stat(directory).catch(() => null)
  if (!info?.isDirectory()) throw new Error('工作目录不存在或不是文件夹。')
  return directory
}

function temporarySessionTitle(message, attachments = []) {
  const attachmentNames = attachments
    .map((attachment) => safeAttachmentName(attachment?.name))
    .filter(Boolean)
  let title = String(message || '')
    .replace(/```[\s\S]*?```/g, '代码内容')
    .replace(/https?:\/\/\S+/g, '链接')
    .replace(/^[\s，,。.!！?？]*(?:请|麻烦)?(?:你)?(?:帮我|帮忙|协助|请问|能否|可以)?[\s，,。.!！?？]*/i, '')
    .replace(/^(?:分析|查看|检查)(?:一下)?(?:这些|这个)?附件[\s，,。.!！?？]*/i, '')
    .replace(/\s+/g, ' ')
    .trim()
  if ((!title || /^(?:分析|查看|检查)?(?:这些|这个)?附件$/i.test(title)) && attachmentNames.length) {
    title = `分析 ${attachmentNames[0]}`
  }
  return cleanSessionTitle(title) || DEFAULT_SESSION_NAME
}

async function extractDocumentText(attachment) {
  const buffer = Buffer.from(String(attachment.data || ''), 'base64')
  if (!buffer.length) throw new Error(`${safeAttachmentName(attachment.name)} 内容为空`)
  const ast = await OfficeParser.parseOffice(buffer, {
    fileType: String(attachment.extension || '').toLowerCase() || undefined,
    ocr: false,
  })
  const extracted = typeof ast.toText === 'function' ? await ast.toText() : await ast.to('text')
  const text = typeof extracted === 'string' ? extracted : extracted?.value
  if (!text?.trim()) throw new Error(`${safeAttachmentName(attachment.name)} 未提取到可分析文本`)
  return text.slice(0, MAX_EXTRACTED_CHARS)
}

function modelRank(provider, model) {
  const id = model.id.toLowerCase()
  if (provider === 'openai' && id.startsWith('gpt-5')) return 100
  if (provider === 'anthropic' && /claude-(opus|sonnet)-4/.test(id)) return 100
  if (provider === 'google' && /gemini-(3|2\.5)/.test(id)) return 100
  if (provider === 'deepseek' && /reasoner|chat/.test(id)) return 90
  if (provider === 'kimi-coding') {
    if (id === 'k3') return 120
    if (id === 'kimi-for-coding-highspeed') return 115
    if (id === 'kimi-for-coding' || id === 'k2p7') return 110
    if (id.includes('k2-thinking')) return 100
  }
  if (provider === 'zai-coding-cn') {
    if (id === 'glm-5.2') return 120
    if (id === 'glm-5.1') return 110
    if (id.includes('glm-5-turbo')) return 105
    if (id === 'glm-4.7') return 100
    if (id.includes('glm-4.7-flash')) return 90
  }
  return model.reasoning ? 50 : 10
}

function providerProfileId(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
}

export class AgentRuntimeService {
  constructor({ cwd, dataDir }) {
    this.cwd = cwd
    this.dataDir = dataDir
    this.sessionDir = join(dataDir, 'sessions')
    this.authPath = join(dataDir, 'auth.json')
    this.modelsPath = join(dataDir, 'models.json')
    this.settingsPath = join(dataDir, 'settings.json')
    this.appConfigPath = join(dataDir, 'vesper.json')
    this.toolPlugins = new ToolPluginService(this.appConfigPath)
    this.visualGeneration = new VisualGenerationService({
      modelsPath: this.modelsPath,
      authPath: this.authPath,
      appConfigPath: this.appConfigPath,
      getModelRuntime: () => this.modelRuntime,
    })
    this.sessionMetaPath = join(dataDir, 'vesper-sessions.json')
    this.usagePath = join(dataDir, 'vesper-usage.json')
    this.assetsDir = join(dataDir, 'vesper-assets')
    this.assetIndexPath = join(dataDir, 'vesper-assets.json')
    this.memory = new LocalMemoryRuntime({ path: join(dataDir, 'vesper-memory.sqlite'), cwd })
    this.goals = new GoalService({ path: join(dataDir, 'vesper-goals.json') })
    this.goalEmitters = new Map()
    this.mcp = new McpService({ path: join(dataDir, 'vesper-mcp.json'), cwd })
    this.skills = new SkillsService({
      path: join(dataDir, 'vesper-skills.json'),
      agentDir: dataDir,
      cwd,
      getSettingsManager: () => this.settingsManager,
    })
    this.channels = new ChannelService({
      path: join(dataDir, 'vesper-channels.json'),
      cwd,
      agent: {
        prompt: (input) => this.promptFromChannel(input),
        abort: (sessionId) => this.abortSession(sessionId),
        validateDirectory: (input) => resolveDirectory(input, this.cwd),
      },
    })
    this.notificationSettings = new NotificationSettingsService({ path: this.appConfigPath, browserEventsPath: join(dataDir, 'vesper-browser-notifications.json'), channels: this.channels })
    this.schedules = new ScheduleService({
      path: join(dataDir, 'vesper-schedules.json'),
      cwd,
      agent: {
        prompt: (input) => this.promptFromChannel({ sessionId: '', ...input }),
        validateDirectory: (input) => resolveDirectory(input, this.cwd),
      },
      notifications: this.notificationSettings,
    })
    this.sessions = new Map()
    this.liveSessions = new Map()
    this.sessionHistoryCache = new Map()
    this.sessionHistoryPaths = new Map()
    this.modelRuntime = null
    this.settingsManager = null
    this.sessionMeta = {}
    this.permissions = new SessionPermissionService({
      getMode: (sessionId) => this.sessionMeta[sessionId]?.permissionMode || DEFAULT_PERMISSION_MODE,
      getToolRisk: (toolName) => this.mcp.getToolRisk(toolName),
    })
    this.subagents = new SubagentService({
      agentDir: this.dataDir,
      getModelRuntime: () => this.modelRuntime,
      getSettingsManager: () => this.settingsManager,
      createResourceLoader: ({ cwd: childCwd, rolePrompt }) => this.skills.createResourceLoader(childCwd, { appendSystemPrompt: rolePrompt }),
    })
    this.sessionMetaWrite = Promise.resolve()
    this.usageLedger = { days: {} }
    this.usageWrite = Promise.resolve()
    this.assetIndex = { assets: [] }
    this.assetWrite = Promise.resolve()
  }

  async init() {
    await mkdir(this.sessionDir, { recursive: true })
    await mkdir(this.assetsDir, { recursive: true })
    this.sessionMeta = await readJson(this.sessionMetaPath, {})
    this.usageLedger = await readJson(this.usagePath, { days: {} })
    this.usageLedger.days ||= {}
    this.assetIndex = await readJson(this.assetIndexPath, { assets: [] })
    this.assetIndex.assets = Array.isArray(this.assetIndex.assets) ? this.assetIndex.assets : []
    await migrateKimiCodeProvider({
      authPath: this.authPath,
      modelsPath: this.modelsPath,
      settingsPath: this.settingsPath,
      appConfigPath: this.appConfigPath,
    })
    this.settingsManager = SettingsManager.create(this.cwd, this.dataDir)
    await this.skills.init()
    await this.mcp.init()
    await this.toolPlugins.ensureDefaultTools(['memory_search', 'memory_remember'], 'memoryToolsV1')
    await this.toolPlugins.ensureDefaultTools(['delegate_task'], 'subagentToolsV1')
    await this.reloadModelRuntime()
    await this.memory.init()
    await this.goals.init({ pauseActive: true })
    await this.channels.init()
    await this.schedules.init()
  }

  async reloadModelRuntime() {
    this.modelRuntime = await ModelRuntime.create({
      authPath: this.authPath,
      modelsPath: this.modelsPath,
      allowModelNetwork: false,
    })
  }

  emitGoalUpdate(sessionId, goal, send = this.goalEmitters.get(sessionId)) {
    const live = this.liveSessions.get(sessionId)
    if (live) live.goal = goal || null
    try { send?.('goal_update', { sessionId, goal: goal || null }) } catch {}
  }

  syncGoalTools(value, goal) {
    if (!value?.session) return
    const names = [...new Set([
      ...(value.baseToolNames || []),
      ...(goal?.status === 'active' ? GOAL_TOOL_NAMES : []),
    ])]
    value.session.setActiveToolsByName(names)
  }

  async pauseSessionGoal(id) {
    const goal = await this.goals.pause(id)
    const value = this.sessions.get(id)
    if (value) this.syncGoalTools(value, goal)
    this.emitGoalUpdate(id, goal)
    return goal
  }

  getSessionGoal(id) {
    return this.goals.get(id)
  }

  async disposeSessions() {
    for (const [id, value] of this.sessions) {
      await this.pauseSessionGoal(id)
      this.subagents.abortParent(id)
      this.permissions.resolveSession(id, false, 'Agent Runtime 正在重新加载，工具未执行。')
      value.session.dispose()
    }
    this.sessions.clear()
  }

  saveSessionMeta() {
    const snapshot = JSON.parse(JSON.stringify(this.sessionMeta))
    this.sessionMetaWrite = this.sessionMetaWrite
      .catch(() => {})
      .then(() => writeJsonAtomic(this.sessionMetaPath, snapshot))
    return this.sessionMetaWrite
  }

  async markSessionTitle(id, name, manual) {
    this.sessionMeta[id] = { ...(this.sessionMeta[id] || {}), name, manual: Boolean(manual) }
    await this.saveSessionMeta()
  }

  saveUsageLedger() {
    const snapshot = JSON.parse(JSON.stringify(this.usageLedger))
    this.usageWrite = this.usageWrite
      .catch(() => {})
      .then(() => writeJsonAtomic(this.usagePath, snapshot))
    return this.usageWrite
  }

  async recordUsage(day, key, usage) {
    if (!day || !key) return false
    const normalized = normalizedUsage(usage)
    if (!normalized.totalTokens && !normalized.input && !normalized.output) return false
    const days = this.usageLedger.days
    days[day] ||= { records: {} }
    days[day].records ||= {}
    if (days[day].records[key]) return false
    days[day].records[key] = normalized
    const retainedDays = Object.keys(days).sort().slice(-45)
    for (const existingDay of Object.keys(days)) {
      if (!retainedDays.includes(existingDay)) delete days[existingDay]
    }
    await this.saveUsageLedger()
    return true
  }

  async getTodayUsage() {
    const day = localDayKey()
    const sessions = await SessionManager.list(this.cwd, this.sessionDir)
    let changed = false
    for (const info of sessions) {
      if (localDayKey(info.modified) !== day) continue
      const manager = SessionManager.open(info.path, this.sessionDir, this.cwd)
      for (const entry of manager.getEntries()) {
        if (entry.type !== 'message' || entry.message?.role !== 'assistant' || !entry.message.usage) continue
        const timestamp = entry.message.timestamp || entry.timestamp
        if (localDayKey(timestamp) !== day) continue
        const key = `session:${info.id}:${entry.id}`
        this.usageLedger.days[day] ||= { records: {} }
        this.usageLedger.days[day].records ||= {}
        if (this.usageLedger.days[day].records[key]) continue
        this.usageLedger.days[day].records[key] = normalizedUsage(entry.message.usage)
        changed = true
      }
    }
    if (changed) await this.saveUsageLedger()
    const totals = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, totalTokens: 0 }
    for (const usage of Object.values(this.usageLedger.days[day]?.records || {})) addUsage(totals, usage)
    return { day, ...totals }
  }

  saveAssetIndex() {
    const snapshot = JSON.parse(JSON.stringify(this.assetIndex))
    this.assetWrite = this.assetWrite
      .catch(() => {})
      .then(() => writeJsonAtomic(this.assetIndexPath, snapshot))
    return this.assetWrite
  }

  publicAsset(asset) {
    if (!asset) return null
    const publicValue = { ...asset }
    delete publicValue.storagePath
    return publicValue
  }

  async createAsset(input) {
    const now = new Date().toISOString()
    const source = String(input.source || 'upload')
    if (input.kind === 'link' || input.url) {
      const url = new URL(String(input.url || ''))
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error('链接只支持 http 或 https。')
      const existing = this.assetIndex.assets.find((asset) => asset.kind === 'link' && asset.url === url.href)
      if (existing) return this.publicAsset(existing)
      const asset = {
        id: randomUUID(), kind: 'link', name: safeAttachmentName(input.name || url.hostname), url: url.href,
        mimeType: 'text/uri-list', size: 0, source, sessionId: input.sessionId || '', sessionName: input.sessionName || '', created: now, modified: now,
      }
      this.assetIndex.assets.unshift(asset)
      await this.saveAssetIndex()
      return this.publicAsset(asset)
    }

    const name = safeAttachmentName(input.name)
    const buffer = input.text !== undefined
      ? Buffer.from(String(input.text), 'utf8')
      : Buffer.from(String(input.data || ''), 'base64')
    if (!buffer.length) throw new Error(`${name} 内容为空。`)
    if (buffer.length > MAX_ASSET_BYTES) throw new Error(`${name} 超过 24 MB 资产限制。`)
    const hash = createHash('sha256').update(buffer).digest('hex')
    const duplicate = this.assetIndex.assets.find((asset) => asset.hash === hash && asset.name === name)
    if (duplicate) {
      duplicate.modified = now
      if (input.sessionId && !duplicate.sessionId) duplicate.sessionId = input.sessionId
      if (input.sessionName && !duplicate.sessionName) duplicate.sessionName = input.sessionName
      await this.saveAssetIndex()
      return this.publicAsset(duplicate)
    }
    const id = randomUUID()
    const extension = extname(name).slice(0, 12)
    const storagePath = join(this.assetsDir, `${id}${extension}`)
    await writeFile(storagePath, buffer)
    const mimeType = String(input.mimeType || mimeFromName(name))
    const asset = {
      id, kind: mimeType.startsWith('image/') || IMAGE_EXTENSIONS.has(extname(name).toLowerCase()) ? 'image' : 'file',
      name, mimeType, size: buffer.length, hash, storagePath, source,
      sessionId: input.sessionId || '', sessionName: input.sessionName || '', created: now, modified: now,
    }
    this.assetIndex.assets.unshift(asset)
    await this.saveAssetIndex()
    return this.publicAsset(asset)
  }

  async archiveAttachments(sessionId, sessionName, attachments = []) {
    for (const attachment of attachments) {
      try {
        await this.createAsset({
          name: attachment.name,
          mimeType: attachment.mimeType,
          data: attachment.data,
          text: attachment.kind === 'text' ? attachment.text : undefined,
          source: 'attachment',
          sessionId,
          sessionName,
        })
      } catch {
        // Asset archival must not block the chat request.
      }
    }
  }

  async recordGeneratedAsset(sessionId, value, toolName, args) {
    if (!['write', 'edit'].includes(toolName) || !args?.path) return
    const filePath = resolve(value.cwd, String(args.path))
    await this.recordGeneratedFile(sessionId, value, filePath)
  }

  async recordGeneratedFile(sessionId, value, filePath) {
    const fileInfo = await stat(filePath).catch(() => null)
    if (!fileInfo?.isFile()) return
    const now = new Date().toISOString()
    const existing = this.assetIndex.assets.find((asset) => asset.filePath === filePath)
    if (existing) {
      existing.size = fileInfo.size
      existing.modified = now
      existing.sessionId = sessionId
      existing.sessionName = value.name
      await this.saveAssetIndex()
      return
    }
    this.assetIndex.assets.unshift({
      id: randomUUID(),
      kind: IMAGE_EXTENSIONS.has(extname(filePath).toLowerCase()) ? 'image' : 'file',
      name: basename(filePath),
      mimeType: mimeFromName(filePath),
      size: fileInfo.size,
      filePath,
      source: 'agent',
      sessionId,
      sessionName: value.name,
      created: now,
      modified: now,
    })
    await this.saveAssetIndex()
  }

  async listAssets({ query = '', kind = '', sessionId = '' } = {}) {
    const needle = String(query || '').trim().toLowerCase()
    const assets = this.assetIndex.assets.filter((asset) => {
      if (kind && asset.kind !== kind) return false
      if (sessionId && asset.sessionId !== sessionId) return false
      return !needle || `${asset.name} ${asset.sessionName} ${asset.url || ''}`.toLowerCase().includes(needle)
    })
    return assets.map((asset) => this.publicAsset(asset))
  }

  findAsset(id) {
    return this.assetIndex.assets.find((asset) => asset.id === id)
  }

  async getAssetContent(id) {
    const asset = this.findAsset(id)
    if (!asset) return null
    if (asset.kind === 'link') {
      return { id: asset.id, kind: 'text', name: `${asset.name}.url.txt`, mimeType: 'text/plain', size: asset.url.length, text: `链接：${asset.url}` }
    }
    const path = asset.storagePath || asset.filePath
    const buffer = await readFile(path)
    if (buffer.length > MAX_CHAT_ASSET_BYTES) throw new Error('资产超过 10 MB，无法直接加入对话；仍可下载或在工作目录中读取。')
    const extension = extname(asset.name).toLowerCase()
    if (asset.kind === 'image') return { id: asset.id, kind: 'image', name: asset.name, mimeType: asset.mimeType, size: buffer.length, data: buffer.toString('base64') }
    if (ASSET_TEXT_EXTENSIONS.has(extension) || asset.mimeType.startsWith('text/')) {
      const text = buffer.toString('utf8')
      return { id: asset.id, kind: 'text', name: asset.name, mimeType: asset.mimeType, size: buffer.length, text: text.slice(0, MAX_EXTRACTED_CHARS), truncated: text.length > MAX_EXTRACTED_CHARS }
    }
    if (ASSET_DOCUMENT_EXTENSIONS.has(extension)) return { id: asset.id, kind: 'document', name: asset.name, mimeType: asset.mimeType, extension: extension.slice(1), size: buffer.length, data: buffer.toString('base64') }
    return { id: asset.id, kind: 'text', name: `${asset.name}.path.txt`, mimeType: 'text/plain', size: path.length, text: asset.filePath ? `本地文件路径：${asset.filePath}` : `资产 ${asset.name} 是二进制文件，请结合文件名称和元数据分析。` }
  }

  async getAssetDownload(id) {
    const asset = this.findAsset(id)
    if (!asset || asset.kind === 'link') return null
    return { asset: this.publicAsset(asset), buffer: await readFile(asset.storagePath || asset.filePath) }
  }

  async deleteAsset(id) {
    const index = this.assetIndex.assets.findIndex((asset) => asset.id === id)
    if (index < 0) return false
    const [asset] = this.assetIndex.assets.splice(index, 1)
    if (asset.storagePath) {
      const root = resolve(this.assetsDir)
      const target = resolve(asset.storagePath)
      if (target !== root && target.startsWith(`${root}${sep}`)) await unlink(target).catch(() => {})
    }
    await this.saveAssetIndex()
    return true
  }

  async listSessions() {
    const sessions = await SessionManager.list(this.cwd, this.sessionDir)
    const settings = this.settingsManager.getGlobalSettings()
    const defaultModel = settings.defaultProvider && settings.defaultModel
      ? `${settings.defaultProvider}/${settings.defaultModel}`
      : ''
    const result = sessions.map((session) => {
      const active = this.sessions.get(session.id)
      const contextModel = active?.session.model
        ? { provider: active.session.model.provider, modelId: active.session.model.id }
        : SessionManager.open(session.path, this.sessionDir, this.cwd).buildSessionContext().model
      return {
        id: session.id,
        name: session.name || session.firstMessage || DEFAULT_SESSION_NAME,
        firstMessage: session.firstMessage || '',
        messageCount: session.messageCount,
        model: contextModel ? `${contextModel.provider}/${contextModel.modelId}` : defaultModel,
        cwd: active?.cwd || this.sessionMeta[session.id]?.cwd || session.cwd || this.cwd,
        created: session.created.toISOString(),
        modified: session.modified.toISOString(),
        streaming: Boolean(active?.session.isStreaming),
        permissionMode: this.sessionMeta[session.id]?.permissionMode || DEFAULT_PERMISSION_MODE,
        goal: this.goals.get(session.id),
      }
    })
    const persistedIds = new Set(result.map((session) => session.id))
    for (const [id, value] of this.sessions) {
      if (persistedIds.has(id)) continue
      result.unshift({
        id,
        name: value.name || DEFAULT_SESSION_NAME,
        firstMessage: '',
        messageCount: value.session.messages.filter((message) => ['user', 'assistant'].includes(message.role)).length,
        model: value.session.model ? `${value.session.model.provider}/${value.session.model.id}` : defaultModel,
        cwd: value.cwd || this.cwd,
        created: value.created,
        modified: value.modified,
        streaming: Boolean(value.session.isStreaming),
        permissionMode: this.sessionMeta[id]?.permissionMode || DEFAULT_PERMISSION_MODE,
        goal: this.goals.get(id),
      })
    }
    return result
  }

  async createSession(name) {
    const resolvedName = cleanSessionTitle(name) || DEFAULT_SESSION_NAME
    const manager = SessionManager.create(this.cwd, this.sessionDir)
    const value = await this.createSessionRuntime(manager, resolvedName)
    value.session.setSessionName(resolvedName)
    await this.markSessionTitle(value.session.sessionId, resolvedName, resolvedName !== DEFAULT_SESSION_NAME)
    return {
      id: value.session.sessionId,
      name: resolvedName,
      messageCount: 0,
      model: value.session.model ? `${value.session.model.provider}/${value.session.model.id}` : '',
      cwd: value.cwd || this.cwd,
      created: new Date().toISOString(),
      modified: new Date().toISOString(),
      permissionMode: this.sessionMeta[value.session.sessionId]?.permissionMode || DEFAULT_PERMISSION_MODE,
      goal: null,
    }
  }

  async findSessionInfo(id) {
    const sessions = await SessionManager.list(this.cwd, this.sessionDir)
    return sessions.find((session) => session.id === id)
  }

  async getSessionMessages(id) {
    const active = this.sessions.get(id)
    let messages
    if (active) {
      messages = active.session.messages.map(serializeMessage).filter(Boolean)
    } else {
      const info = await this.findSessionInfo(id)
      if (!info) return []
      const manager = SessionManager.open(info.path, this.sessionDir, this.cwd)
      messages = manager.buildSessionContext().messages.map(serializeMessage).filter(Boolean)
    }
    const assets = this.assetIndex.assets
      .filter((asset) => asset.sessionId === id && asset.source === 'agent' && /^(?:image|video)\//.test(asset.mimeType || ''))
      .sort((left, right) => new Date(left.created).getTime() - new Date(right.created).getTime())
    return attachGeneratedAssets(messages, assets)
  }

  async readSessionHistoryEntries(path) {
    const file = await stat(path)
    let cached = this.sessionHistoryCache.get(path)
    if (!cached || file.size < cached.size || (file.size === cached.size && file.mtimeMs !== cached.mtimeMs)) {
      cached = { size: 0, mtimeMs: 0, remainder: Buffer.alloc(0), entries: [], byId: new Map(), touchedAt: Date.now() }
    }
    if (file.size > cached.size) {
      const handle = await open(path, 'r')
      try {
        const chunk = Buffer.allocUnsafe(file.size - cached.size)
        await handle.read(chunk, 0, chunk.length, cached.size)
        const combined = cached.remainder.length ? Buffer.concat([cached.remainder, chunk]) : chunk
        const newline = combined.lastIndexOf(0x0a)
        const complete = newline >= 0 ? combined.subarray(0, newline).toString('utf8') : ''
        cached.remainder = newline >= 0 ? combined.subarray(newline + 1) : combined
        for (const line of complete.split('\n')) {
          if (!line.trim()) continue
          try {
            const entry = JSON.parse(line.trimEnd())
            cached.entries.push(entry)
            if (entry?.id) cached.byId.set(entry.id, entry)
          } catch {
            // Ignore a malformed history line without making the rest of the session unreadable.
          }
        }
      } finally {
        await handle.close()
      }
    }
    cached.size = file.size
    cached.mtimeMs = file.mtimeMs
    cached.touchedAt = Date.now()
    this.sessionHistoryCache.set(path, cached)
    if (this.sessionHistoryCache.size > 20) {
      const oldest = [...this.sessionHistoryCache.entries()].sort((left, right) => left[1].touchedAt - right[1].touchedAt)[0]?.[0]
      if (oldest && oldest !== path) this.sessionHistoryCache.delete(oldest)
    }
    return cached
  }

  async getSessionHistoryMessages(id) {
    const active = this.sessions.get(id)
    const activePath = active?.session.sessionFile
    let path = activePath || this.sessionHistoryPaths.get(id)
    if (!path) {
      path = (await this.findSessionInfo(id))?.path
      if (path) this.sessionHistoryPaths.set(id, path)
    }
    if (!path) return this.getSessionMessages(id)
    let history
    try {
      history = await this.readSessionHistoryEntries(path)
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
      this.sessionHistoryPaths.delete(id)
      this.sessionHistoryCache.delete(path)
      return active ? this.getSessionMessages(id) : []
    }
    let cursor = [...history.entries].reverse().find((entry) => entry?.id)
    const branch = []
    const visited = new Set()
    while (cursor?.id && !visited.has(cursor.id)) {
      visited.add(cursor.id)
      branch.push(cursor)
      cursor = cursor.parentId ? history.byId.get(cursor.parentId) : null
    }
    branch.reverse()
    const messages = branch
      .filter((entry) => entry?.type === 'message')
      .map((entry, index) => serializeMessage(entry.message, index))
      .filter(Boolean)
    const assets = this.assetIndex.assets
      .filter((asset) => asset.sessionId === id && asset.source === 'agent' && /^(?:image|video)\//.test(asset.mimeType || ''))
      .sort((left, right) => new Date(left.created).getTime() - new Date(right.created).getTime())
    return attachGeneratedAssets(messages, assets)
  }

  async getSessionMessagePage(id, { before, limit = DEFAULT_MESSAGE_PAGE_SIZE } = {}) {
    const messages = await this.getSessionHistoryMessages(id)
    const pageSize = Math.min(MAX_MESSAGE_PAGE_SIZE, Math.max(1, Number.parseInt(limit, 10) || DEFAULT_MESSAGE_PAGE_SIZE))
    const requestedEnd = before == null || before === '' ? messages.length : Number.parseInt(before, 10)
    const end = Number.isFinite(requestedEnd) ? Math.min(messages.length, Math.max(0, requestedEnd)) : messages.length
    const start = Math.max(0, end - pageSize)
    return {
      messages: messages.slice(start, end),
      pageInfo: {
        start,
        end,
        total: messages.length,
        hasMore: start > 0,
        nextCursor: start > 0 ? String(start) : null,
      },
    }
  }

  async getSessionLive(id) {
    const active = this.sessions.get(id)
    const live = this.liveSessions.get(id)
    const page = await this.getSessionMessagePage(id, { limit: LIVE_MESSAGE_PAGE_SIZE })
    const messages = page.messages
    const streaming = Boolean(active?.session.isStreaming || live?.streaming)
    if (streaming && live) {
      const lastUserIndex = messages.findLastIndex((message) => message.role === 'user')
      const assistantIndex = messages.findIndex((message, index) => index > lastUserIndex && message.role === 'agent')
      const liveMessage = {
        id: `live-${id}`,
        role: 'agent',
        text: live.text,
        streaming: true,
        attachments: live.assets,
      }
      if (assistantIndex >= 0) messages[assistantIndex] = { ...messages[assistantIndex], ...liveMessage, text: live.text || messages[assistantIndex].text, attachments: live.assets.length ? live.assets : messages[assistantIndex].attachments }
      else messages.push(liveMessage)
    }
    return {
      id,
      streaming,
      messages,
      tools: live?.tools || [],
      error: live?.error || '',
      startedAt: live?.startedAt || null,
      lastActivityAt: live?.lastActivityAt || null,
      model: active?.session.model ? `${active.session.model.provider}/${active.session.model.id}` : '',
      cwd: active?.cwd || this.sessionMeta[id]?.cwd || this.cwd,
      permissionMode: this.sessionMeta[id]?.permissionMode || DEFAULT_PERMISSION_MODE,
      goal: live?.goal ?? this.goals.get(id),
      approvals: this.permissions.getPending(id),
      pageInfo: page.pageInfo,
    }
  }

  async renameSession(id, name, { manual = true } = {}) {
    const title = cleanSessionTitle(name)
    if (!title) throw new Error('会话标题不能为空。')
    const active = this.sessions.get(id)
    if (active) {
      active.session.setSessionName(title)
      active.name = title
      active.modified = new Date().toISOString()
    } else {
      const info = await this.findSessionInfo(id)
      if (!info) return null
      const manager = SessionManager.open(info.path, this.sessionDir, this.cwd)
      manager.appendSessionInfo(title)
    }
    await this.markSessionTitle(id, title, manual)
    return { id, name: title, manual: Boolean(manual) }
  }

  async setSessionModel(id, provider, modelId) {
    const appConfig = await readJson(this.appConfigPath, { toolMode: 'read-only', disabledProviders: [] })
    if ((appConfig.disabledProviders || []).includes(String(provider || ''))) throw new Error('该 Provider 当前未启用。')
    const model = this.modelRuntime.getModel(String(provider || ''), String(modelId || ''))
    if (!model) throw new Error('指定的模型不存在。')
    const value = await this.getOrCreateSession(id)
    if (value.session.isStreaming) throw new Error('当前会话正在运行，请完成或停止后再切换模型。')
    const settings = this.settingsManager.getGlobalSettings()
    const defaultProvider = settings.defaultProvider
    const defaultModel = settings.defaultModel
    const defaultThinkingLevel = settings.defaultThinkingLevel
    try {
      await value.session.setModel(model)
    } finally {
      if (defaultProvider && defaultModel) {
        this.settingsManager.setDefaultModelAndProvider(defaultProvider, defaultModel)
      }
      if (defaultThinkingLevel) this.settingsManager.setDefaultThinkingLevel(defaultThinkingLevel)
    }
    value.modified = new Date().toISOString()
    return {
      id: value.session.sessionId,
      model: `${model.provider}/${model.id}`,
      provider: model.provider,
      modelId: model.id,
    }
  }

  async setSessionPermission(id, mode) {
    const permissionMode = String(mode || '')
    if (!PERMISSION_MODES.has(permissionMode)) throw new Error('权限模式无效。')
    if (!this.sessions.has(id) && !(await this.findSessionInfo(id))) return null
    this.sessionMeta[id] = { ...(this.sessionMeta[id] || {}), permissionMode }
    await this.saveSessionMeta()
    if (permissionMode !== 'ask') this.permissions.resolveSession(id, true, `权限模式已切换为${permissionMode === 'ignore' ? '忽略' : '自动'}。`)
    return { id, permissionMode }
  }

  resolveToolApproval(sessionId, approvalId, approved) {
    return this.permissions.resolve(sessionId, approvalId, approved)
  }

  async setSessionCwd(id, input) {
    const cwd = await resolveDirectory(input, this.cwd)
    const active = this.sessions.get(id)
    if (active?.session.isStreaming) throw new Error('当前会话正在运行，请完成或停止后再切换工作目录。')
    const activeSessionFile = active?.session.sessionFile
    const activeSessionFileInfo = activeSessionFile ? await stat(activeSessionFile).catch(() => null) : null
    const info = activeSessionFileInfo?.isFile()
      ? { path: activeSessionFile, name: active.name }
      : await this.findSessionInfo(id)
    if (!active && !info) return null

    const name = active?.name || info?.name || this.sessionMeta[id]?.name || DEFAULT_SESSION_NAME
    const previousModel = active?.session.model
    if (active) {
      active.session.dispose()
      this.sessions.delete(id)
    }
    this.sessionMeta[id] = { ...(this.sessionMeta[id] || {}), cwd }
    await this.saveSessionMeta()

    const manager = info?.path
      ? SessionManager.open(info.path, this.sessionDir, this.cwd)
      : SessionManager.create(this.cwd, this.sessionDir, { id })
    const next = await this.createSessionRuntime(manager, name)
    if (!info?.path) next.session.setSessionName(name)
    if (previousModel && (!next.session.model || previousModel.provider !== next.session.model.provider || previousModel.id !== next.session.model.id)) {
      await this.setSessionModel(id, previousModel.provider, previousModel.id)
    }
    return { id, cwd: next.cwd }
  }

  async listDirectories(input) {
    const path = await resolveDirectory(input, this.cwd)
    const entries = await readdir(path, { withFileTypes: true })
    const directories = entries
      .filter((entry) => entry.isDirectory())
      .map((entry) => ({ name: entry.name, path: join(path, entry.name) }))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' }))
      .slice(0, 300)
    const parent = dirname(path)
    return { path, parent: parent === path ? null : parent, directories }
  }

  async getOrCreateSession(id) {
    if (id && this.sessions.has(id)) return this.sessions.get(id)
    if (id) {
      const info = await this.findSessionInfo(id)
      if (info) return this.createSessionRuntime(SessionManager.open(info.path, this.sessionDir, this.cwd))
    }
    return this.createSessionRuntime(SessionManager.create(this.cwd, this.sessionDir))
  }

  async createSessionRuntime(sessionManager, name) {
    const appConfig = await readJson(this.appConfigPath, { toolMode: 'read-only' })
    const effectiveCwd = await resolveDirectory(this.sessionMeta[sessionManager.getSessionId()]?.cwd, sessionManager.getCwd() || this.cwd)
    const enabledTools = toolsFromConfig(appConfig)
    const runtimeSessionId = sessionManager.getSessionId()
    const [resourceLoader, mcpTools] = await Promise.all([
      this.skills.createResourceLoader(effectiveCwd),
      this.mcp.createToolDefinitions(),
    ])
    const baseToolNames = [...new Set([...enabledTools, ...mcpTools.map((tool) => tool.name)])]
    let runtimeValue = null
    let runtimeSession = null
    const goalTools = createGoalTools({
      getGoal: () => this.goals.get(runtimeSessionId),
      completeGoal: async () => {
        const goal = await this.goals.complete(runtimeSessionId)
        if (runtimeValue) this.syncGoalTools(runtimeValue, goal)
        this.emitGoalUpdate(runtimeSessionId, goal)
        return goal
      },
    })
    const installSubagentPermissions = (subagentSession) => this.permissions.install(subagentSession, {
      sessionId: runtimeSession.sessionId,
      cwd: effectiveCwd,
    })
    const accountSubagentUsage = async ({ id, usage, completedAt }) => {
      await this.recordUsage(localDayKey(completedAt), `subagent:${runtimeSession.sessionId}:${id}`, usage)
      const goal = this.goals.get(runtimeSession.sessionId)
      if (goal?.status !== 'active') return
      const accounting = this.goals.account(runtimeSession.sessionId, { goalId: goal.id, usage })
      const updatedGoal = this.goals.get(runtimeSession.sessionId)
      if (runtimeValue) this.syncGoalTools(runtimeValue, updatedGoal)
      this.emitGoalUpdate(runtimeSession.sessionId, updatedGoal)
      await accounting
    }
    const parentActiveToolNames = () => [...baseToolNames]
    const runSubagent = (input, execution) => {
      if (!runtimeSession?.model) throw new Error('当前会话没有可用模型，无法启动子 Agent。')
      return this.subagents.run({
        ...input,
        ...execution,
        parentSessionId: runtimeSession.sessionId,
        cwd: effectiveCwd,
        model: runtimeSession.model,
        allowedTools: parentActiveToolNames(),
        customTools: createInheritedCustomTools(),
        onSession: installSubagentPermissions,
        onCompleted: accountSubagentUsage,
      })
    }
    const createInheritedCustomTools = () => [
      ...createAppTools({
        cwd: effectiveCwd,
        enabledTools,
        memoryRuntime: this.memory,
        visualGenerationService: this.visualGeneration,
        onGeneratedFile: ({ path }) => runtimeValue && runtimeSession
          ? this.recordGeneratedFile(runtimeSession.sessionId, runtimeValue, path)
          : undefined,
        runSubagent,
      }),
      ...mcpTools,
      ...(enabledTools.includes('bash') ? [createWindowsUtf8BashTool(effectiveCwd)].filter(Boolean) : []),
    ]
    const { session, modelFallbackMessage } = await createAgentSession({
      cwd: effectiveCwd,
      agentDir: this.dataDir,
      modelRuntime: this.modelRuntime,
      settingsManager: this.settingsManager,
      resourceLoader,
      sessionManager,
      tools: [...baseToolNames, ...GOAL_TOOL_NAMES],
      customTools: [...createInheritedCustomTools(), ...goalTools],
    })
    const now = new Date().toISOString()
    const value = {
      session,
      modelFallbackMessage,
      name: name || sessionManager.getSessionName() || DEFAULT_SESSION_NAME,
      created: now,
      modified: now,
      cwd: effectiveCwd,
      baseToolNames,
    }
    runtimeValue = value
    runtimeSession = session
    this.syncGoalTools(value, this.goals.get(session.sessionId))
    this.permissions.install(session, { sessionId: session.sessionId, cwd: effectiveCwd })
    this.sessions.set(session.sessionId, value)
    return value
  }

  async streamPrompt({ sessionId, message, attachments = [], goalMode = false, send }) {
    const value = await this.getOrCreateSession(sessionId)
    const { session } = value
    const appConfig = await readJson(this.appConfigPath, { toolMode: 'read-only', disabledProviders: [] })
    if ((appConfig.disabledProviders || []).includes(session.model?.provider)) {
      throw new Error('当前会话使用的 Provider 已停用，请先启用或切换模型。')
    }
    if (!session.model || session.model.provider === 'unknown' || session.model.id === 'unknown') {
      throw new Error('没有可用模型，请先在配置页设置 Provider、模型和 API Key。')
    }
    if (session.isStreaming) throw new Error('当前会话仍在运行，请等待完成或先停止。')
    let goal = this.goals.get(session.sessionId)
    if (goalMode) {
      goal = goal?.status === 'paused'
        ? await this.goals.resume(session.sessionId)
        : await this.goals.start(session.sessionId, { objective: message })
    }
    this.syncGoalTools(value, goal)
    const startedAt = new Date().toISOString()
    const live = { streaming: true, text: '', tools: [], assets: [], error: '', goal, startedAt, lastActivityAt: startedAt }
    this.liveSessions.set(session.sessionId, live)
    this.goalEmitters.set(session.sessionId, send)

    const firstTurn = !session.messages.some((item) => item.role === 'user')
    const sessionMeta = this.sessionMeta[session.sessionId]
    const mayAutoTitle = firstTurn && !sessionMeta?.manual
    const temporaryTitle = mayAutoTitle ? temporarySessionTitle(message, attachments) : ''
    if (temporaryTitle && temporaryTitle !== value.name) {
      session.setSessionName(temporaryTitle)
      value.name = temporaryTitle
      await this.markSessionTitle(session.sessionId, temporaryTitle, false)
      send('session_title', { sessionId: session.sessionId, name: temporaryTitle, source: 'temporary' })
    }

    send('meta', {
      sessionId: session.sessionId,
      model: `${session.model.provider}/${session.model.id}`,
      thinkingLevel: session.thinkingLevel,
      cwd: value.cwd,
      permissionMode: this.sessionMeta[session.sessionId]?.permissionMode || DEFAULT_PERMISSION_MODE,
      goal,
      startedAt: live.startedAt,
      lastActivityAt: live.lastActivityAt,
    })

    const toolArgs = new Map()
    let goalTurnId = ''
    let goalTurnStartedAt = 0
    let continuationQueued = false
    let budgetSummaryQueued = false
    const unsubscribe = session.subscribe((event) => {
      live.lastActivityAt = new Date().toISOString()
      if (event.type === 'message_update') {
        const update = event.assistantMessageEvent
        if (update.type === 'text_delta') { live.text += update.delta || ''; send('text_delta', { delta: update.delta }) }
        if (update.type === 'thinking_delta') send('thinking_delta', { delta: update.delta })
      } else if (event.type === 'tool_execution_start') {
        toolArgs.set(event.toolCallId, event.args)
        const toolStartedAt = live.lastActivityAt
        live.tools.push({ id: event.toolCallId, name: event.toolName, status: 'running', startedAt: toolStartedAt, updatedAt: toolStartedAt })
        send('tool_start', { id: event.toolCallId, name: event.toolName, args: event.args, startedAt: toolStartedAt })
      } else if (event.type === 'tool_execution_update') {
        const message = textFromContent(event.partialResult?.content).replace(/\s+/g, ' ').trim().slice(0, 180)
        const subagent = event.toolName === 'delegate_task' ? event.partialResult?.details : undefined
        live.tools = live.tools.map((item) => item.id === event.toolCallId
          ? { ...item, message: message || item.message || '', updatedAt: live.lastActivityAt, ...(subagent ? { subagent } : {}) }
          : item)
        send('tool_update', { id: event.toolCallId, name: event.toolName, message, updatedAt: live.lastActivityAt, ...(subagent ? { subagent } : {}) })
      } else if (event.type === 'tool_execution_end') {
        if (!event.isError) void this.recordGeneratedAsset(session.sessionId, value, event.toolName, toolArgs.get(event.toolCallId))
        toolArgs.delete(event.toolCallId)
        if (!event.isError && event.toolName === 'generate_visual' && event.result?.details?.path) {
          const generatedPath = resolve(event.result.details.path)
          const asset = this.assetIndex.assets.find((item) => item.filePath && resolve(item.filePath) === generatedPath)
          if (asset) {
            const attachment = assetMessageAttachment(asset)
            live.assets = [...live.assets.filter((item) => item.id !== attachment.id), attachment]
            send('generated_asset', attachment)
          }
        }
        const resultMessage = event.isError ? textFromContent(event.result?.content) || '工具执行失败。' : ''
        const completedTool = live.tools.find((item) => item.id === event.toolCallId)
        const toolFinishedAt = live.lastActivityAt
        live.tools = live.tools.map((item) => item.id === event.toolCallId ? { ...item, status: event.isError ? 'error' : 'done', message: resultMessage || item.message || '', updatedAt: toolFinishedAt, finishedAt: toolFinishedAt } : item)
        send('tool_end', {
          id: event.toolCallId,
          name: event.toolName,
          error: event.isError,
          message: resultMessage || completedTool?.message || '',
          finishedAt: toolFinishedAt,
        })
      } else if (event.type === 'turn_start') {
        const activeGoal = this.goals.get(session.sessionId)
        goalTurnId = activeGoal?.status === 'active' ? activeGoal.id : ''
        goalTurnStartedAt = Date.now()
      } else if (event.type === 'turn_end') {
        if (!goalTurnId) return
        const accounting = this.goals.account(session.sessionId, {
          goalId: goalTurnId,
          usage: event.message?.usage,
          elapsedSeconds: goalTurnStartedAt ? (Date.now() - goalTurnStartedAt) / 1000 : 0,
        })
        goalTurnId = ''
        goalTurnStartedAt = 0
        const updatedGoal = this.goals.get(session.sessionId)
        this.syncGoalTools(value, updatedGoal)
        this.emitGoalUpdate(session.sessionId, updatedGoal)
        if (updatedGoal?.status === 'budget_limited' && !budgetSummaryQueued) {
          budgetSummaryQueued = true
          void session.followUp(goalBudgetPrompt(updatedGoal)).catch(() => {})
        }
        void accounting.catch(() => {})
      } else if (event.type === 'agent_end') {
        if (event.willRetry) return
        const finalAssistant = [...(event.messages || [])].reverse().find((item) => item?.role === 'assistant')
        if (finalAssistant?.stopReason === 'error' || finalAssistant?.stopReason === 'aborted' || finalAssistant?.errorMessage) return
        const activeGoal = this.goals.get(session.sessionId)
        if (activeGoal?.status !== 'active' || continuationQueued) return
        continuationQueued = true
        void session.followUp(goalContinuationPrompt(activeGoal)).catch(() => {}).finally(() => { continuationQueued = false })
      } else if (event.type === 'auto_retry_start') {
        send('retry', { attempt: event.attempt, maxAttempts: event.maxAttempts, message: event.errorMessage })
      }
    })

    this.permissions.attachEmitter(session.sessionId, send)
    try {
      const safeAttachments = Array.isArray(attachments) ? attachments.slice(0, 8) : []
      await this.archiveAttachments(session.sessionId, value.name, safeAttachments)
      const images = []
      const contexts = []
      const memoryContext = await this.memory.relevantContext(message, value.cwd)
      const activeGoal = this.goals.get(session.sessionId)
      if (activeGoal?.status === 'active') contexts.push(goalContinuationPrompt(activeGoal))
      for (const attachment of safeAttachments) {
        const name = safeAttachmentName(attachment.name)
        if (attachment.kind === 'image') {
          const data = String(attachment.data || '')
          const mimeType = String(attachment.mimeType || '')
          if (!mimeType.startsWith('image/') || !data) throw new Error(`${name} 不是有效图片`)
          if (data.length > 15_000_000) throw new Error(`${name} 图片数据过大`)
          images.push({ type: 'image', data, mimeType })
          contexts.push(`[图片附件] ${name}`)
        } else if (attachment.kind === 'text') {
          const text = String(attachment.text || '').slice(0, MAX_EXTRACTED_CHARS)
          contexts.push(`[文本附件: ${name}]\n${text}${attachment.truncated ? '\n（内容已截断）' : ''}`)
        } else if (attachment.kind === 'document') {
          const text = await extractDocumentText(attachment)
          contexts.push(`[文档附件: ${name}]\n${text}`)
        }
      }
      const prompt = contexts.length ? `${message}${ATTACHMENT_MARKER}${contexts.join('\n\n')}` : message
      const titlePromise = mayAutoTitle
        ? this.generateSessionTitle(session.model, message, safeAttachments, temporaryTitle, session.sessionId).catch(() => '')
        : null
      const shouldForceVisualTool = isVisualGenerationRequest(message) && session.getActiveToolNames().includes('generate_visual')
      const restorePayloadHandler = shouldForceVisualTool ? forceNextToolCall(session.agent, 'generate_visual') : () => {}
      const originalSystemPrompt = session.agent.state.systemPrompt
      if (memoryContext.text) session.agent.state.systemPrompt = `${originalSystemPrompt}\n\n${memoryContext.text}`
      try {
        await session.prompt(prompt, { images })
      } finally {
        session.agent.state.systemPrompt = originalSystemPrompt
        restorePayloadHandler()
      }
      const last = [...session.messages].reverse().find((item) => item.role === 'assistant')
      if (last?.errorMessage) throw new Error(last.errorMessage)
      const assistantText = textFromContent(last?.content)
      if (titlePromise) {
        const generatedTitle = await titlePromise
        if (generatedTitle && !this.sessionMeta[session.sessionId]?.manual && generatedTitle !== value.name) {
          session.setSessionName(generatedTitle)
          value.name = generatedTitle
          await this.markSessionTitle(session.sessionId, generatedTitle, false)
          send('session_title', { sessionId: session.sessionId, name: generatedTitle, source: 'generated' })
        }
      }
      send('done', { sessionId: session.sessionId, goal: this.goals.get(session.sessionId) })
      void this.captureConversationMemory({
        sessionId: session.sessionId,
        cwd: value.cwd,
        model: session.model,
        user: message,
        assistant: assistantText,
      }).catch(() => {})
    } catch (error) {
      live.error = error instanceof Error ? error.message : String(error)
      if (this.goals.get(session.sessionId)?.status === 'active') await this.pauseSessionGoal(session.sessionId)
      throw error
    } finally {
      unsubscribe()
      this.permissions.detachEmitter(session.sessionId, send)
      if (this.goalEmitters.get(session.sessionId) === send) this.goalEmitters.delete(session.sessionId)
      live.streaming = false
      const timer = setTimeout(() => { if (this.liveSessions.get(session.sessionId) === live) this.liveSessions.delete(session.sessionId) }, 60_000)
      timer.unref?.()
    }
  }

  async generateSessionTitle(model, message, attachments, fallback, sessionId) {
    const attachmentText = attachments.length
      ? `\n附件：${attachments.map((item) => safeAttachmentName(item.name)).join('、')}`
      : ''
    const result = await this.modelRuntime.completeSimple(model, {
      systemPrompt: '你是会话标题生成器。根据用户任务生成一个清晰、具体的中文标题。只输出标题，不加引号、句号、解释或“标题”前缀。标题最多20个汉字；保留必要的文件名、技术名词和错误名称。',
      messages: [{
        role: 'user',
        content: `${String(message || '').slice(0, 1200)}${attachmentText}`,
        timestamp: Date.now(),
      }],
    }, {
      ...(model.reasoning ? { reasoning: 'low' } : { temperature: 0.2 }),
      maxTokens: 128,
    })
    if (sessionId) await this.recordUsage(localDayKey(result.timestamp || Date.now()), `title:${sessionId}`, result.usage)
    if (result.errorMessage) return fallback
    return cleanSessionTitle(textFromContent(result.content)) || fallback
  }

  async captureConversationMemory({ sessionId, cwd, model, user, assistant }) {
    const result = await extractConversationMemories({ modelRuntime: this.modelRuntime, model, user, assistant })
    if (result.usage) await this.recordUsage(localDayKey(result.timestamp || Date.now()), `memory:${sessionId}:${result.timestamp || Date.now()}`, result.usage)
    if (!result.memories.length) return []
    const projectSpaceId = await this.memory.ensureWorkspaceSpace(cwd)
    return result.memories.map((item) => this.memory.remember({
      ...item,
      spaceId: item.scope === 'global' ? 'global' : projectSpaceId,
      cwd,
      sessionId,
      sourceType: 'conversation',
      sourceId: sessionId,
    }))
  }

  getMemoryDashboard(input) {
    return this.memory.getDashboard(input)
  }

  createMemorySpace(input) {
    return this.memory.createSpace(input)
  }

  updateMemorySpace(id, input) {
    return this.memory.updateSpace(id, input)
  }

  deleteMemorySpace(id) {
    return this.memory.deleteSpace(id)
  }

  createMemory(input) {
    return this.memory.remember({ ...input, sourceType: input.sourceType || 'manual' })
  }

  updateMemory(id, input) {
    return this.memory.updateMemory(id, input)
  }

  deleteMemory(id) {
    return this.memory.forget(id)
  }

  async abortSession(id) {
    const value = this.sessions.get(id)
    if (!value) return false
    await this.pauseSessionGoal(id)
    this.subagents.abortParent(id)
    this.permissions.resolveSession(id, false, '会话已停止，工具未执行。')
    await value.session.abort()
    return true
  }

  async deleteSession(id) {
    await this.goals.remove(id)
    this.subagents.abortParent(id)
    this.permissions.resolveSession(id, false, '会话已删除，工具未执行。')
    const active = this.sessions.get(id)
    let sessionFile = active?.session.sessionFile
    if (active) {
      if (active.session.isStreaming) await active.session.abort()
      active.session.dispose()
      this.sessions.delete(id)
    }
    if (!sessionFile) sessionFile = (await this.findSessionInfo(id))?.path
    this.sessionHistoryPaths.delete(id)
    if (sessionFile) this.sessionHistoryCache.delete(sessionFile)
    if (!sessionFile) {
      if (this.sessionMeta[id]) {
        delete this.sessionMeta[id]
        await this.saveSessionMeta()
      }
      return Boolean(active)
    }
    const root = resolve(this.sessionDir)
    const target = resolve(sessionFile)
    if (target !== root && !target.startsWith(`${root}${sep}`)) throw new Error('拒绝删除会话目录之外的文件。')
    try {
      await unlink(target)
    } catch (error) {
      if (error?.code !== 'ENOENT') throw error
    }
    if (this.sessionMeta[id]) {
      delete this.sessionMeta[id]
      await this.saveSessionMeta()
    }
    return true
  }

  async getPlugins() {
    return this.toolPlugins.getState()
  }

  async promptFromChannel({ sessionId, message, attachments = [], cwd, title, model }) {
    let id = String(sessionId || '')
    if (id && !this.sessions.has(id) && !(await this.findSessionInfo(id))) id = ''
    if (!id) {
      const created = await this.createSession(title || '飞书会话')
      id = created.id
      if (cwd) await this.setSessionCwd(id, cwd)
    }
    if (model?.provider && model?.model) {
      const active = await this.getOrCreateSession(id)
      if (active.session.model?.provider !== model.provider || active.session.model?.id !== model.model) await this.setSessionModel(id, model.provider, model.model)
    }
    let actualId = id
    let text = ''
    const assetIds = new Set()
    await this.streamPrompt({
      sessionId: id,
      message,
      attachments,
      send: (event, data) => {
        if ((event === 'meta' || event === 'done') && data?.sessionId) actualId = data.sessionId
        if (event === 'text_delta') text += data?.delta || ''
        if (event === 'generated_asset' && data?.id) assetIds.add(data.id)
      },
    })
    if (!text.trim()) {
      const messages = await this.getSessionMessages(actualId)
      text = [...messages].reverse().find((item) => item.role === 'agent')?.text || ''
    }
    const runtime = this.sessions.get(actualId)
    const assets = [...assetIds].map((assetId) => this.assetIndex.assets.find((asset) => asset.id === assetId)).filter(Boolean).map((asset) => ({
      id: asset.id,
      name: asset.name,
      path: asset.filePath,
      mimeType: asset.mimeType,
    })).filter((asset) => asset.path)
    return { sessionId: actualId, text: text.trim(), cwd: runtime?.cwd || this.sessionMeta[actualId]?.cwd || this.cwd, model: runtime?.session.model ? `${runtime.session.model.provider}/${runtime.session.model.id}` : '', assets }
  }

  async getChannels() {
    const state = this.channels.getState()
    const config = await this.getConfig()
    return {
      providers: state.providers,
      connections: state.connections,
      scopes: state.scopes,
      models: config.providers.filter((provider) => provider.enabled && provider.configured).flatMap((provider) => provider.models.filter((model) => model.kind === 'chat').map((model) => ({ provider: provider.id, model: model.id, label: `${provider.name} / ${model.name}` }))),
    }
  }

  startChannelOnboarding(platform) {
    return this.channels.startOnboarding(platform)
  }

  getChannelOnboarding(platform, id) {
    return this.channels.getOnboarding(platform, id)
  }

  cancelChannelOnboarding(platform, id) {
    return this.channels.cancelOnboarding(platform, id)
  }

  verifyChannelOnboarding(platform, id, code) {
    return this.channels.verifyOnboarding(platform, id, code)
  }

  async updateChannel(platform, input) {
    await this.channels.update(platform, input)
    return this.getChannels()
  }

  async reconnectChannel(platform) {
    await this.channels.connect(platform)
    return this.getChannels()
  }

  deleteChannel(platform) {
    return this.channels.remove(platform)
  }

  resetChannelScope(key) {
    return this.channels.resetScope(key)
  }

  getNotificationSettings() {
    return this.notificationSettings.getState()
  }

  updateBrowserNotifications(input) {
    return this.notificationSettings.updateBrowser(input)
  }

  saveNotificationTemplate(event, platform, input) {
    return this.notificationSettings.updateTemplate(event, platform, input)
  }

  testNotificationTemplate(event, platform) {
    return this.notificationSettings.testTemplate(event, platform)
  }

  getBrowserNotificationEvents(after) {
    return this.notificationSettings.getBrowserEvents(after)
  }

  async getSchedules() {
    const config = await this.getConfig()
    const notificationSettings = await this.notificationSettings.getState()
    return {
      ...this.schedules.getState(),
      models: config.providers.filter((provider) => provider.enabled && provider.configured).flatMap((provider) => provider.models.filter((model) => model.kind === 'chat').map((model) => ({ provider: provider.id, model: model.id, label: `${provider.name} / ${model.name}` }))),
      notificationTargets: {
        browser: { enabled: notificationSettings.browser.enabled },
        feishu: { enabled: Boolean(notificationSettings.connections.feishu?.enabled) },
        weixin: { enabled: Boolean(notificationSettings.connections.weixin?.enabled) },
      },
    }
  }

  async createSchedule(input) {
    const task = await this.schedules.create(input)
    return { task, state: await this.getSchedules() }
  }

  async updateSchedule(id, input) {
    const task = await this.schedules.update(id, input)
    return task ? { task, state: await this.getSchedules() } : null
  }

  deleteSchedule(id) {
    return this.schedules.remove(id)
  }

  async runSchedule(id) {
    const task = await this.schedules.runNow(id)
    return task ? { started: true, task } : null
  }

  notifyChannels(event, data) {
    return this.notificationSettings.notify(event, data)
  }

  async dispose() {
    await this.schedules.dispose()
    await this.channels.dispose()
    await this.goals.pauseAllActive()
    await this.subagents.dispose()
    this.permissions.dispose()
    await this.disposeSessions()
    await this.mcp.dispose()
    this.memory.dispose()
  }

  async savePlugins(input) {
    const result = await this.toolPlugins.saveState(input)
    await this.disposeSessions()
    return result
  }

  getMcpDashboard({ refresh = true } = {}) {
    return this.mcp.getDashboard({ refresh })
  }

  async createMcpServer(input) {
    const result = await this.mcp.add(input)
    await this.disposeSessions()
    return result
  }

  async updateMcpServer(id, input) {
    const result = await this.mcp.update(id, input)
    if (result) await this.disposeSessions()
    return result
  }

  async deleteMcpServer(id) {
    const deleted = await this.mcp.remove(id)
    if (deleted) await this.disposeSessions()
    return deleted
  }

  async testMcpServer(id) {
    const result = await this.mcp.test(id)
    await this.disposeSessions()
    return result
  }

  async setMcpToolEnabled(id, toolName, enabled) {
    const result = await this.mcp.setToolEnabled(id, toolName, enabled)
    if (result) await this.disposeSessions()
    return result
  }

  getSkillsDashboard() {
    return this.skills.dashboard({ cwd: this.cwd })
  }

  async installSkill(input) {
    const result = await this.skills.install(input, { cwd: this.cwd })
    await this.disposeSessions()
    return result
  }

  async updateSkill(id, input) {
    const result = await this.skills.update(id, input, { cwd: this.cwd })
    if (result) await this.disposeSessions()
    return result
  }

  async deleteSkill(id) {
    const deleted = await this.skills.remove(id, { cwd: this.cwd })
    if (deleted) await this.disposeSessions()
    return deleted
  }

  async reloadSkills() {
    await this.disposeSessions()
    return this.skills.dashboard({ cwd: this.cwd })
  }

  async getConfig() {
    const settings = this.settingsManager.getGlobalSettings()
    const appConfig = await readJson(this.appConfigPath, { toolMode: 'read-only' })
    const modelsJson = await readJson(this.modelsPath, { providers: {} })
    const credentials = await readJson(this.authPath, {})
    const runtimeProviders = this.modelRuntime.getProviders()
    const providerIds = [...new Set([...KNOWN_PROVIDERS, ...Object.keys(modelsJson.providers || {})])]
    const disabledProviders = new Set(appConfig.disabledProviders || [])
    const providers = providerIds.map((id) => {
      const runtimeProvider = runtimeProviders.find((item) => item.id === id)
      const overlay = modelsJson.providers?.[id] || {}
      const overlayModels = Array.isArray(overlay.models) ? overlay.models : []
      return {
        id,
        name: PROVIDER_LABELS[id] || runtimeProvider?.name || id,
        configured: Boolean(credentials[id]) || this.modelRuntime.hasConfiguredAuth(id),
        enabled: !disabledProviders.has(id),
        custom: !KNOWN_PROVIDERS.includes(id),
        api: overlay.api || this.modelRuntime.getModels(id)[0]?.api || 'openai-responses',
        baseUrl: overlay.baseUrl || PROVIDER_DEFAULT_BASE_URLS[id] || '',
        organization: overlay.headers?.['OpenAI-Organization'] || '',
        models: this.modelRuntime.getModels(id).map((model) => {
          const definition = overlayModels.find((item) => item.id === model.id)
          return {
            id: model.id,
            name: model.name || model.id,
            kind: inferModelKind(model.id, definition?.kind),
            reasoning: Boolean(model.reasoning),
            contextWindow: model.contextWindow || null,
            baseUrl: model.baseUrl || '',
            baseUrlOverride: definition?.baseUrl || '',
          }
        }).sort((a, b) => modelRank(id, b) - modelRank(id, a) || a.name.localeCompare(b.name)),
      }
    }).filter((provider) => provider.models.length > 0 || KNOWN_PROVIDERS.includes(provider.id))

    const hasChatModel = (provider) => provider.models.some((model) => model.kind === 'chat')
    const selectedProviderEntry = providers.find((item) => item.id === settings.defaultProvider && item.enabled && item.configured && hasChatModel(item))
      || providers.find((item) => item.enabled && item.configured && hasChatModel(item))
      || providers.find((item) => item.enabled && hasChatModel(item))
      || providers[0]
    const selectedProvider = selectedProviderEntry?.id || 'openai'
    const selectedModels = (providers.find((item) => item.id === selectedProvider)?.models || []).filter((model) => model.kind === 'chat')
    const selectedModel = selectedModels.some((item) => item.id === settings.defaultModel) ? settings.defaultModel : (selectedModels[0]?.id || '')
    return {
      provider: selectedProvider,
      model: selectedModel,
      thinkingLevel: settings.defaultThinkingLevel || 'medium',
      toolMode: appConfig.toolMode || 'read-only',
      providers,
      apiKeyConfigured: Boolean(credentials[selectedProvider]),
    }
  }

  async saveConfig(input) {
    const provider = String(input.provider || '').trim()
    const model = String(input.model || '').trim()
    if (!provider || !model) throw new Error('Provider 和模型不能为空。')
    const currentAppConfig = await readJson(this.appConfigPath, { toolMode: 'read-only', disabledProviders: [] })
    if ((currentAppConfig.disabledProviders || []).includes(provider)) throw new Error('请先启用该 Provider，再将其设为默认配置。')

    const credentials = await readJson(this.authPath, {})
    if (input.clearApiKey) delete credentials[provider]
    if (typeof input.apiKey === 'string' && input.apiKey.trim()) {
      credentials[provider] = { type: 'api_key', key: input.apiKey.trim() }
    }
    await writeJsonAtomic(this.authPath, credentials)

    const modelsJson = await readJson(this.modelsPath, { providers: {} })
    modelsJson.providers ||= {}
    const providerOverlay = { ...(modelsJson.providers[provider] || {}) }
    const baseUrl = String(input.baseUrl || '').trim()
    const modelBaseUrl = String(input.modelBaseUrl || '').trim()
    const organization = String(input.organization || '').trim()
    const runtimeModel = this.modelRuntime.getModel(provider, model)
    if (!runtimeModel) {
      providerOverlay.name ||= String(input.providerName || provider)
      providerOverlay.api ||= String(input.api || 'openai-responses')
      providerOverlay.models = Array.isArray(providerOverlay.models) ? [...providerOverlay.models] : []
      if (!providerOverlay.models.some((item) => item.id === model)) {
        providerOverlay.models.push({
          id: model,
          name: String(input.modelName || model),
          api: String(input.api || 'openai-responses'),
          kind: inferModelKind(model, input.modelKind),
          reasoning: input.reasoning !== false,
          input: ['text', 'image'],
          contextWindow: Number(input.contextWindow) || 200_000,
          maxTokens: Number(input.maxTokens) || 128_000,
        })
      }
    }
    const modelDefinitions = Array.isArray(providerOverlay.models) ? [...providerOverlay.models] : []
    const definitionIndex = modelDefinitions.findIndex((item) => item.id === model)
    if (modelBaseUrl || definitionIndex >= 0) {
      const definition = definitionIndex >= 0 ? { ...modelDefinitions[definitionIndex] } : {
        id: model,
        name: runtimeModel?.name || String(input.modelName || model),
        api: runtimeModel?.api || String(input.api || providerOverlay.api || 'openai-responses'),
        kind: inferModelKind(model, input.modelKind),
        reasoning: runtimeModel?.reasoning ?? input.reasoning !== false,
        input: runtimeModel?.input || ['text', 'image'],
        contextWindow: runtimeModel?.contextWindow || Number(input.contextWindow) || 200_000,
        maxTokens: runtimeModel?.maxTokens || Number(input.maxTokens) || 128_000,
      }
      if (modelBaseUrl) definition.baseUrl = modelBaseUrl
      else delete definition.baseUrl
      definition.kind = inferModelKind(model, input.modelKind || definition.kind)
      if (definitionIndex >= 0) modelDefinitions[definitionIndex] = definition
      else modelDefinitions.push(definition)
      providerOverlay.models = modelDefinitions
    }
    if (baseUrl) providerOverlay.baseUrl = baseUrl
    else delete providerOverlay.baseUrl
    if (organization) providerOverlay.headers = { ...(providerOverlay.headers || {}), 'OpenAI-Organization': organization }
    else if (providerOverlay.headers) {
      delete providerOverlay.headers['OpenAI-Organization']
      if (Object.keys(providerOverlay.headers).length === 0) delete providerOverlay.headers
    }
    if (Object.keys(providerOverlay).length) modelsJson.providers[provider] = providerOverlay
    else delete modelsJson.providers[provider]
    await writeJsonAtomic(this.modelsPath, modelsJson)

    this.settingsManager.setDefaultModelAndProvider(provider, model)
    this.settingsManager.setDefaultThinkingLevel(input.thinkingLevel || 'medium')
    await this.settingsManager.flush()
    const errors = this.settingsManager.drainErrors()
    if (errors.length) throw errors[0].error

    const requestedToolMode = ['read-only', 'workspace', 'full', 'custom'].includes(input.toolMode) ? input.toolMode : 'read-only'
    await writeJsonAtomic(this.appConfigPath, {
      ...currentAppConfig,
      toolMode: requestedToolMode,
      enabledTools: requestedToolMode === 'custom' ? toolsFromConfig(currentAppConfig) : TOOL_PRESETS[requestedToolMode],
      disabledProviders: [...new Set(currentAppConfig.disabledProviders || [])],
    })
    await this.disposeSessions()
    await this.reloadModelRuntime()
    return this.getConfig()
  }

  async setProviderEnabled(id, enabled) {
    const provider = String(id || '').trim()
    if (!this.modelRuntime.getProviders().some((item) => item.id === provider) && !KNOWN_PROVIDERS.includes(provider)) {
      throw new Error('Provider 不存在。')
    }
    const appConfig = await readJson(this.appConfigPath, { toolMode: 'read-only', disabledProviders: [] })
    const disabled = new Set(appConfig.disabledProviders || [])
    if (enabled) disabled.delete(provider)
    else disabled.add(provider)

    const settings = this.settingsManager.getGlobalSettings()
    if (!enabled && settings.defaultProvider === provider) {
      const credentials = await readJson(this.authPath, {})
      const alternative = this.modelRuntime.getProviders().find((item) => item.id !== provider && !disabled.has(item.id) && credentials[item.id] && this.modelRuntime.getModels(item.id).length)
      if (!alternative) throw new Error('至少需要保留一个已配置并启用的 Provider。')
      this.settingsManager.setDefaultModelAndProvider(alternative.id, this.modelRuntime.getModels(alternative.id)[0].id)
      await this.settingsManager.flush()
    }
    await writeJsonAtomic(this.appConfigPath, { ...appConfig, disabledProviders: [...disabled] })
    return this.getConfig()
  }

  async createProvider(input) {
    const id = providerProfileId(input.id || input.name)
    const name = String(input.name || '').trim()
    const api = String(input.api || 'openai-responses').trim()
    const baseUrl = String(input.baseUrl || '').trim()
    const modelId = String(input.model || '').trim()
    if (!id || !name || !baseUrl || !modelId) throw new Error('名称、Provider ID、Base URL 和初始模型不能为空。')
    if (this.modelRuntime.getProviders().some((item) => item.id === id) || KNOWN_PROVIDERS.includes(id)) throw new Error('Provider ID 已存在，请使用不同的连接标识。')

    const modelsJson = await readJson(this.modelsPath, { providers: {} })
    modelsJson.providers ||= {}
    modelsJson.providers[id] = {
      name,
      api,
      baseUrl,
      models: [{
        id: modelId,
        name: String(input.modelName || modelId).trim() || modelId,
        api,
        kind: inferModelKind(modelId, input.modelKind),
        reasoning: input.reasoning !== false,
        input: ['text', 'image'],
        contextWindow: Number(input.contextWindow) || 200_000,
        maxTokens: Number(input.maxTokens) || 128_000,
      }],
    }
    await writeJsonAtomic(this.modelsPath, modelsJson)

    const apiKey = String(input.apiKey || '').trim()
    if (apiKey) {
      const credentials = await readJson(this.authPath, {})
      credentials[id] = { type: 'api_key', key: apiKey }
      await writeJsonAtomic(this.authPath, credentials)
    }
    const appConfig = await readJson(this.appConfigPath, { toolMode: 'read-only', disabledProviders: [] })
    const disabled = new Set(appConfig.disabledProviders || [])
    if (input.enabled === false) disabled.add(id)
    else disabled.delete(id)
    await writeJsonAtomic(this.appConfigPath, { ...appConfig, disabledProviders: [...disabled] })
    await this.disposeSessions()
    await this.reloadModelRuntime()
    return { ...(await this.getConfig()), createdProviderId: id }
  }

  async addProviderModel(providerId, input) {
    const provider = String(providerId || '').trim()
    const modelId = String(input.id || '').trim()
    if (!provider || !modelId) throw new Error('Provider 和模型 ID 不能为空。')
    if (!this.modelRuntime.getProviders().some((item) => item.id === provider) && !KNOWN_PROVIDERS.includes(provider)) throw new Error('Provider 不存在。')
    const modelsJson = await readJson(this.modelsPath, { providers: {} })
    modelsJson.providers ||= {}
    const overlay = { ...(modelsJson.providers[provider] || {}) }
    overlay.models = Array.isArray(overlay.models) ? [...overlay.models] : []
    if (overlay.models.some((item) => item.id === modelId) || this.modelRuntime.getModel(provider, modelId)) throw new Error('该模型已经存在。')
    overlay.models.push({
      id: modelId,
      name: String(input.name || modelId).trim() || modelId,
      api: String(input.api || overlay.api || 'openai-responses'),
      kind: inferModelKind(modelId, input.kind),
      ...(String(input.baseUrl || '').trim() ? { baseUrl: String(input.baseUrl).trim() } : {}),
      reasoning: input.reasoning !== false,
      input: ['text', 'image'],
      contextWindow: Number(input.contextWindow) || 200_000,
      maxTokens: Number(input.maxTokens) || 128_000,
    })
    modelsJson.providers[provider] = overlay
    await writeJsonAtomic(this.modelsPath, modelsJson)
    await this.disposeSessions()
    await this.reloadModelRuntime()
    return this.getConfig()
  }

  async deleteProvider(id) {
    const provider = String(id || '').trim()
    if (KNOWN_PROVIDERS.includes(provider)) throw new Error('内置 Provider 不能删除，可以将其停用。')
    const modelsJson = await readJson(this.modelsPath, { providers: {} })
    if (!modelsJson.providers?.[provider]) return null
    delete modelsJson.providers[provider]
    await writeJsonAtomic(this.modelsPath, modelsJson)
    const credentials = await readJson(this.authPath, {})
    delete credentials[provider]
    await writeJsonAtomic(this.authPath, credentials)
    const appConfig = await readJson(this.appConfigPath, { toolMode: 'read-only', disabledProviders: [] })
    appConfig.disabledProviders = (appConfig.disabledProviders || []).filter((item) => item !== provider)
    await writeJsonAtomic(this.appConfigPath, appConfig)
    const settings = this.settingsManager.getGlobalSettings()
    if (settings.defaultProvider === provider) {
      const alternative = this.modelRuntime.getProviders().find((item) => item.id !== provider && credentials[item.id] && this.modelRuntime.getModels(item.id).length)
      if (alternative) {
        this.settingsManager.setDefaultModelAndProvider(alternative.id, this.modelRuntime.getModels(alternative.id)[0].id)
        await this.settingsManager.flush()
      }
    }
    await this.disposeSessions()
    await this.reloadModelRuntime()
    return this.getConfig()
  }
}
