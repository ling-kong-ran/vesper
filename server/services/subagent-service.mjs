import { randomUUID } from 'node:crypto'
import { createAgentSession, DefaultResourceLoader, estimateTokens, SessionManager } from '@earendil-works/pi-coding-agent'

export const SUBAGENT_ROLES = Object.freeze({
  scout: Object.freeze({
    label: 'Scout',
    prompt: `You are a scout subagent working in an isolated context. Investigate the delegated task quickly and return evidence another agent can use without repeating the exploration.

Guidelines:
- Focus on evidence gathering, relevant imports, and the smallest useful set of files.
- Use only the read-only tools exposed to this role.
- Cite exact file paths and important functions, data structures, or line ranges when possible.
- Separate verified findings from assumptions.
- Respond in the language used by the delegated task.`,
  }),
  planner: Object.freeze({
    label: 'Planner',
    prompt: `You are a planning subagent working in an isolated context. Turn the delegated task into a concrete, safe implementation plan.

Guidelines:
- Inspect the relevant code before proposing changes and use only the read-only tools exposed to this role.
- Return a numbered plan, affected files, expected behavior, and risks or validation steps.
- Clearly distinguish proposed work from verified completed work.
- Respond in the language used by the delegated task.`,
  }),
  reviewer: Object.freeze({
    label: 'Reviewer',
    prompt: `You are a code-review subagent working in an isolated context. Analyze the delegated task or code for correctness, regressions, security, and maintainability.

Guidelines:
- Use only the read-only tools exposed to this role to investigate the task.
- Report concrete findings first, with file paths and rationale. Clearly say when no blocking issue is found.
- Distinguish critical issues, warnings, and suggestions.
- Respond in the language used by the delegated task.`,
  }),
  worker: Object.freeze({
    label: 'Worker',
    prompt: `You are an implementation subagent working in an isolated context. Complete the delegated coding task in the current workspace.

Guidelines:
- You receive the safe subset of the parent session's enabled tools and permission mode. Respect the resulting approvals and workspace boundary.
- Make only the changes required for the delegated task. Preserve existing user changes and do not revert unrelated work.
- Inspect relevant files before editing. Run focused validation when a shell tool is available and it is useful.
- At the end, report changed files, validation performed, and any remaining risk.
- Respond in the language used by the delegated task.`,
  }),
})

export const SUBAGENT_ROLE_NAMES = Object.freeze(Object.keys(SUBAGENT_ROLES))
export const DEFAULT_SUBAGENT_TIMEOUT_SECONDS = 180
export const MAX_SUBAGENT_TIMEOUT_SECONDS = 300
export const MAX_CONCURRENT_SUBAGENTS = 4
export const MAX_SUBAGENT_TASK_CHARS = 12_000
export const MAX_SUBAGENT_OUTPUT_BYTES = 50 * 1024

const READ_ONLY_SUBAGENT_TOOL_NAMES = new Set(['read', 'grep', 'find', 'ls', 'memory_search'])
const PARENT_ONLY_TOOL_NAMES = new Set(['delegate_task', 'get_goal', 'update_goal'])

function textFromContent(content) {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  return content.filter((part) => part?.type === 'text').map((part) => part.text || '').join('')
}

function usageTotal(messages = []) {
  return messages.reduce((total, message) => {
    if (message?.role !== 'assistant' || !message.usage) return total
    const usage = message.usage
    total.input += Number(usage.input) || 0
    total.output += Number(usage.output) || 0
    total.cacheRead += Number(usage.cacheRead) || 0
    total.cacheWrite += Number(usage.cacheWrite) || 0
    total.reasoning += Number(usage.reasoning) || 0
    total.totalTokens += Number(usage.totalTokens ?? usage.total) || 0
    return total
  }, { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, totalTokens: 0 })
}

function modelLabel(model) {
  return model?.provider && model?.id ? `${model.provider}/${model.id}` : ''
}

function positiveInteger(value) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : null
}

function modelOutputTokenLimit(model) {
  const limits = [positiveInteger(model?.contextWindow), positiveInteger(model?.maxTokens)].filter(Boolean)
  return limits.length ? Math.min(...limits) : null
}

function estimatedTextTokens(text) {
  return estimateTokens({ role: 'custom', content: [{ type: 'text', text }] })
}

function utf8Prefix(value, maxBytes) {
  const buffer = Buffer.from(value, 'utf8')
  if (buffer.length <= maxBytes) return value
  let end = maxBytes
  while (end > 0 && (buffer[end] & 0xc0) === 0x80) end -= 1
  return buffer.subarray(0, end).toString('utf8')
}

function contextLimitedText(value, model) {
  const text = String(value || '').trim()
  const tokenLimit = modelOutputTokenLimit(model)
  const estimatedTokens = estimatedTextTokens(text)
  const outputBytes = Buffer.byteLength(text, 'utf8')
  const tokenTruncated = Boolean(tokenLimit && estimatedTokens > tokenLimit)
  const byteTruncated = outputBytes > MAX_SUBAGENT_OUTPUT_BYTES
  if (!tokenTruncated && !byteTruncated) {
    return { text, fullText: text, truncated: false, estimatedTokens, tokenLimit, outputBytes, byteLimit: MAX_SUBAGENT_OUTPUT_BYTES }
  }
  const reasons = [tokenTruncated ? 'model context' : '', byteTruncated ? '50 KB tool-output limit' : ''].filter(Boolean).join(' and ')
  const suffix = `\n\n[Output truncated for ${reasons}. Full output is preserved in tool details.]`
  const suffixBytes = Buffer.byteLength(suffix, 'utf8')
  const byteBudget = Math.max(0, MAX_SUBAGENT_OUTPUT_BYTES - suffixBytes)
  const charBudget = tokenTruncated ? Math.max(0, tokenLimit * 4 - suffix.length) : text.length
  const prefix = utf8Prefix(text.slice(0, charBudget), byteBudget)
  return {
    text: `${prefix}${suffix}`,
    fullText: text,
    truncated: true,
    estimatedTokens,
    tokenLimit,
    outputBytes,
    byteLimit: MAX_SUBAGENT_OUTPUT_BYTES,
  }
}

function timeoutSeconds(value) {
  const number = Number(value)
  if (!Number.isFinite(number)) return DEFAULT_SUBAGENT_TIMEOUT_SECONDS
  return Math.max(15, Math.min(MAX_SUBAGENT_TIMEOUT_SECONDS, Math.floor(number)))
}

function childToolsFor(role, allowedTools) {
  const inherited = [...new Set(Array.isArray(allowedTools) ? allowedTools.filter(Boolean) : [])]
    .filter((tool) => !PARENT_ONLY_TOOL_NAMES.has(tool))
  return role === 'worker' ? inherited : inherited.filter((tool) => READ_ONLY_SUBAGENT_TOOL_NAMES.has(tool))
}

function canModifyWorkspace(tools) {
  return ['edit', 'write', 'bash'].some((tool) => tools.includes(tool))
}

function inheritedCustomTools(tools, customTools) {
  const enabled = new Set(tools)
  return Array.isArray(customTools) ? customTools.filter((tool) => enabled.has(tool?.name)) : []
}

function safeProgressMessage(value) {
  return String(value || '').replace(/\s+/g, ' ').trim().slice(0, 180)
}

async function createRoleResourceLoader({ cwd, agentDir, settingsManager, rolePrompt }) {
  const loader = new DefaultResourceLoader({
    cwd,
    agentDir: agentDir || cwd,
    ...(settingsManager ? { settingsManager } : {}),
    appendSystemPromptOverride: (base) => [...base, rolePrompt],
  })
  await loader.reload()
  return loader
}

export class SubagentService {
  constructor({
    agentDir,
    getModelRuntime,
    getSettingsManager,
    createSession = createAgentSession,
    createSessionManager = (cwd) => SessionManager.inMemory(cwd),
    createResourceLoader = createRoleResourceLoader,
    maxConcurrent = MAX_CONCURRENT_SUBAGENTS,
    setTimer = setTimeout,
    clearTimer = clearTimeout,
  } = {}) {
    this.agentDir = agentDir
    this.getModelRuntime = getModelRuntime || (() => null)
    this.getSettingsManager = getSettingsManager || (() => null)
    this.createSession = createSession
    this.createSessionManager = createSessionManager
    this.createResourceLoader = createResourceLoader
    this.maxConcurrent = Math.max(1, Number(maxConcurrent) || MAX_CONCURRENT_SUBAGENTS)
    this.setTimer = setTimer
    this.clearTimer = clearTimer
    this.active = new Map()
  }

  getActive(parentSessionId) {
    return [...this.active.values()]
      .filter((item) => !parentSessionId || item.parentSessionId === parentSessionId)
      .map(({ session: _session, abort: _abort, ...item }) => ({ ...item, model: modelLabel(item.model) }))
  }

  abortParent(parentSessionId) {
    let count = 0
    for (const record of this.active.values()) {
      if (record.parentSessionId !== parentSessionId) continue
      record.abort('Subagent was cancelled because the parent session stopped.')
      count += 1
    }
    return count
  }

  abortAll(reason = 'Subagent service is shutting down.') {
    for (const record of this.active.values()) record.abort(reason)
  }

  async dispose() {
    this.abortAll()
  }

  async run({ parentSessionId, cwd, model, role = 'scout', task, timeoutSeconds: requestedTimeout, allowedTools, customTools, signal, onProgress, onSession, onCompleted } = {}) {
    const definition = SUBAGENT_ROLES[role]
    if (!definition) throw new Error(`Unknown subagent role: ${role}`)
    if (!parentSessionId) throw new Error('Subagent requires a parent session.')
    if (!cwd) throw new Error('Subagent requires a workspace directory.')
    if (!model) throw new Error('Subagent requires an active parent model.')
    const normalizedTask = String(task || '').trim()
    if (!normalizedTask) throw new Error('Subagent task cannot be empty.')
    if (normalizedTask.length > MAX_SUBAGENT_TASK_CHARS) throw new Error(`Subagent task is limited to ${MAX_SUBAGENT_TASK_CHARS} characters.`)
    const childTools = childToolsFor(role, allowedTools)
    const childCustomTools = inheritedCustomTools(childTools, customTools)
    const writeCapable = canModifyWorkspace(childTools)
    if (this.active.size >= this.maxConcurrent) throw new Error(`Subagent concurrency limit reached (${this.maxConcurrent}).`)

    const id = randomUUID()
    const timeout = timeoutSeconds(requestedTimeout)
    const startedAt = Date.now()
    const record = {
      id,
      parentSessionId,
      role,
      model,
      task: normalizedTask,
      writeCapable,
      availableTools: childTools,
      startedAt: new Date(startedAt).toISOString(),
      lastActivityAt: null,
      inactivityTimeoutSeconds: timeout,
      status: 'starting',
      tools: [],
      session: null,
      aborted: false,
      timedOut: false,
      abortReason: '',
      abort: (reason = 'Subagent was cancelled.') => {
        record.aborted = true
        record.abortReason ||= reason
        void record.session?.abort?.().catch(() => {})
      },
    }
    this.active.set(id, record)

    const emit = (phase, message = '') => {
      record.status = phase
      try {
        onProgress?.({
          id,
          role,
          label: definition.label,
          writeCapable: record.writeCapable,
          phase,
          model: modelLabel(model),
          startedAt: record.startedAt,
          lastActivityAt: record.lastActivityAt,
          inactivityTimeoutSeconds: record.inactivityTimeoutSeconds,
          tools: record.tools.map((item) => ({ ...item })),
          message: safeProgressMessage(message),
        })
      } catch {}
    }

    let unsubscribe = () => {}
    let timer = null
    const clearInactivityTimer = () => {
      if (!timer) return
      this.clearTimer(timer)
      timer = null
    }
    const touchActivity = () => {
      if (record.aborted || record.timedOut) return
      clearInactivityTimer()
      record.lastActivityAt = new Date().toISOString()
      timer = this.setTimer(() => {
        timer = null
        record.timedOut = true
        record.abort(`Subagent was inactive for ${timeout} seconds.`)
      }, timeout * 1000)
      timer?.unref?.()
    }
    const abort = () => record.abort('Subagent was cancelled.')
    try {
      if (signal?.aborted) abort()
      signal?.addEventListener?.('abort', abort, { once: true })
      emit('starting', `${definition.label} is starting`)
      const settingsManager = this.getSettingsManager()
      const resourceLoader = await this.createResourceLoader({
        cwd,
        agentDir: this.agentDir || cwd,
        settingsManager,
        role,
        rolePrompt: definition.prompt,
      })
      const result = await this.createSession({
        cwd,
        agentDir: this.agentDir,
        model,
        modelRuntime: this.getModelRuntime(),
        settingsManager,
        resourceLoader,
        sessionManager: this.createSessionManager(cwd),
        tools: childTools,
        excludeTools: [...PARENT_ONLY_TOOL_NAMES],
        ...(childCustomTools.length ? { customTools: childCustomTools } : {}),
      })
      const session = result?.session
      if (!session) throw new Error('Subagent session could not be created.')
      record.session = session
      onSession?.(session)
      unsubscribe = session.subscribe((event) => {
        touchActivity()
        if (event.type === 'tool_execution_start') {
          record.tools = [...record.tools, { id: event.toolCallId, name: event.toolName, status: 'running' }]
          emit('working', `${definition.label} is using ${event.toolName}`)
        } else if (event.type === 'tool_execution_end') {
          record.tools = record.tools.map((item) => item.id === event.toolCallId
            ? { ...item, status: event.isError ? 'error' : 'done' }
            : item)
          emit('working', `${definition.label} ${event.isError ? 'could not use' : 'finished'} ${event.toolName}`)
        }
      })
      if (record.aborted) await session.abort()
      record.status = 'running'
      emit('running', `${definition.label} is working on the task`)
      touchActivity()
      await session.prompt(normalizedTask)
      clearInactivityTimer()
      if (record.timedOut) throw new Error(`Subagent was inactive for ${timeout} seconds.`)
      if (record.aborted || signal?.aborted) throw new Error(record.abortReason || 'Subagent was cancelled.')
      const last = [...session.messages].reverse().find((message) => message?.role === 'assistant')
      if (last?.errorMessage) throw new Error(last.errorMessage)
      const output = contextLimitedText(textFromContent(last?.content), model)
      const completedAt = Date.now()
      const value = {
        id,
        parentSessionId,
        role,
        label: definition.label,
        writeCapable: record.writeCapable,
        availableTools: childTools,
        task: normalizedTask,
        model: modelLabel(model),
        output: output.text || '(Subagent returned no text output.)',
        fullOutput: output.fullText,
        outputTruncated: output.truncated,
        outputEstimatedTokens: output.estimatedTokens,
        outputTokenLimit: output.tokenLimit,
        outputBytes: output.outputBytes,
        outputByteLimit: output.byteLimit,
        usage: usageTotal(session.messages),
        tools: record.tools,
        startedAt: record.startedAt,
        completedAt: new Date(completedAt).toISOString(),
        durationMs: completedAt - startedAt,
        status: 'completed',
      }
      emit('completed', `${definition.label} completed`)
      try { await onCompleted?.(value) } catch {}
      return value
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      emit(record.timedOut ? 'timed_out' : record.aborted ? 'cancelled' : 'failed', message)
      throw error
    } finally {
      clearInactivityTimer()
      signal?.removeEventListener?.('abort', abort)
      try { unsubscribe() } catch {}
      try { record.session?.dispose?.() } catch {}
      this.active.delete(id)
    }
  }
}
