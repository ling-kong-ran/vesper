import { isAbsolute, relative, resolve, sep } from 'node:path'
import { randomUUID } from 'node:crypto'
import { TOOL_CATALOG } from '../tools/registry.mjs'

export const PERMISSION_MODES = new Set(['ask', 'auto', 'ignore'])
export const DEFAULT_PERMISSION_MODE = 'auto'

const TOOL_RISKS = new Map(TOOL_CATALOG.map((tool) => [tool.id, tool.risk]))
const SENSITIVE_RISKS = new Set(['中风险', '高风险'])
const DANGEROUS_COMMAND = /(?:\brm\s+-[^\r\n]*r[^\r\n]*f|\brmdir\s+\/s|\bdel\s+\/s|remove-item[^\r\n]*(?:-recurse|-force)|\bformat(?:\.com)?\b|\bshutdown(?:\.exe)?\b|\btaskkill[^\r\n]*\/f|\bgit\s+(?:reset\s+--hard|clean\s+-[^\r\n]*f)|\breg\s+delete\b|\bdrop\s+(?:database|table)\b|\btruncate\s+table\b)/i

function safeArgs(value, depth = 0, key = '') {
  if (depth > 3) return '[内容已省略]'
  if (/api.?key|password|passwd|secret|token/i.test(key)) return '[已隐藏敏感信息]'
  if (typeof value === 'string') {
    if (/^(?:data|image|content)$/i.test(key) && value.length > 500) return `[内容已省略，共 ${value.length} 字符]`
    return value.length > 800 ? `${value.slice(0, 800)}…` : value
  }
  if (Array.isArray(value)) return value.slice(0, 12).map((item) => safeArgs(item, depth + 1, key))
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).slice(0, 30).map(([childKey, child]) => [childKey, safeArgs(child, depth + 1, childKey)]))
  return value
}

function pathOutsideWorkspace(cwd, input) {
  const rawPath = String(input || '').trim()
  if (!rawPath) return false
  const root = resolve(cwd)
  const target = isAbsolute(rawPath) ? resolve(rawPath) : resolve(root, rawPath)
  const result = relative(root, target)
  return result === '..' || result.startsWith(`..${sep}`) || isAbsolute(result)
}

export function permissionRequirement({ mode, cwd, toolName, args }) {
  if (mode === 'ignore') return null
  const risk = TOOL_RISKS.get(toolName) || '高风险'
  if (['read', 'ls', 'grep', 'find', 'edit', 'write'].includes(toolName) && pathOutsideWorkspace(cwd, args?.path || args?.file_path)) {
    return { risk: '高风险', reason: `${toolName} 将访问当前工作目录之外的文件。` }
  }
  if (mode === 'ask' && SENSITIVE_RISKS.has(risk)) {
    return { risk, reason: `${toolName} 属于${risk}工具，需要确认后执行。` }
  }
  if (mode !== 'auto') return null
  if (toolName === 'bash' && DANGEROUS_COMMAND.test(String(args?.command || ''))) {
    return { risk: '高风险', reason: 'Shell 命令包含删除、重置或系统级操作。' }
  }
  return null
}

export class SessionPermissionService {
  constructor({ getMode, timeoutMs = 10 * 60_000 } = {}) {
    this.getMode = getMode || (() => DEFAULT_PERMISSION_MODE)
    this.timeoutMs = timeoutMs
    this.pending = new Map()
    this.emitters = new Map()
    this.installedSessions = new WeakSet()
  }

  attachEmitter(sessionId, emit) {
    if (emit) this.emitters.set(sessionId, emit)
  }

  detachEmitter(sessionId, emit) {
    if (!emit || this.emitters.get(sessionId) === emit) this.emitters.delete(sessionId)
  }

  emit(sessionId, event, data) {
    try { this.emitters.get(sessionId)?.(event, data) } catch {}
  }

  install(session, { sessionId, cwd }) {
    if (!session?.agent || this.installedSessions.has(session)) return
    this.installedSessions.add(session)
    const upstream = session.agent.beforeToolCall
    session.agent.beforeToolCall = async (context, signal) => {
      const upstreamResult = await upstream?.(context, signal)
      if (upstreamResult?.block) return upstreamResult
      return this.authorize({
        sessionId,
        cwd,
        toolName: context.toolCall.name,
        toolCallId: context.toolCall.id,
        args: context.args,
        signal,
      })
    }
  }

  async authorize({ sessionId, cwd, toolName, toolCallId, args, signal }) {
    const mode = PERMISSION_MODES.has(this.getMode(sessionId)) ? this.getMode(sessionId) : DEFAULT_PERMISSION_MODE
    const requirement = permissionRequirement({ mode, cwd, toolName, args })
    if (!requirement) return undefined
    const approval = await this.requestApproval({ sessionId, toolName, toolCallId, args, mode, ...requirement, signal })
    if (approval.approved) return undefined
    return { block: true, reason: approval.reason || `用户拒绝执行工具 ${toolName}。` }
  }

  requestApproval({ sessionId, toolName, toolCallId, args, mode, risk, reason, signal }) {
    const id = randomUUID()
    const createdAt = new Date().toISOString()
    const publicApproval = { id, sessionId, toolName, toolCallId, args: safeArgs(args), mode, risk, reason, createdAt }
    return new Promise((resolveApproval) => {
      let settled = false
      const settle = (approved, resolutionReason) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        signal?.removeEventListener('abort', abort)
        this.pending.delete(id)
        this.emit(sessionId, 'permission_resolved', { id, approved, reason: resolutionReason || '' })
        resolveApproval({ approved, reason: resolutionReason })
      }
      const abort = () => settle(false, '操作已停止，工具未执行。')
      const timer = setTimeout(() => settle(false, '等待授权超时，工具未执行。'), this.timeoutMs)
      timer.unref?.()
      if (signal?.aborted) {
        abort()
        return
      }
      signal?.addEventListener('abort', abort, { once: true })
      this.pending.set(id, { ...publicApproval, settle })
      this.emit(sessionId, 'permission_request', publicApproval)
    })
  }

  resolve(sessionId, approvalId, approved) {
    const approval = this.pending.get(approvalId)
    if (!approval || approval.sessionId !== sessionId) return false
    approval.settle(Boolean(approved), approved ? '用户已授权执行。' : '用户拒绝执行该工具。')
    return true
  }

  resolveSession(sessionId, approved, reason = '') {
    let count = 0
    for (const approval of [...this.pending.values()]) {
      if (approval.sessionId !== sessionId) continue
      approval.settle(Boolean(approved), reason || (approved ? '权限模式已允许执行。' : '会话已停止。'))
      count += 1
    }
    return count
  }

  getPending(sessionId) {
    return [...this.pending.values()].filter((approval) => approval.sessionId === sessionId).map(({ settle: _settle, ...approval }) => approval)
  }

  dispose() {
    for (const approval of [...this.pending.values()]) approval.settle(false, '应用正在关闭，工具未执行。')
    this.emitters.clear()
  }
}
