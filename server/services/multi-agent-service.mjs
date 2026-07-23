import { randomUUID } from 'node:crypto'
import { createAgentSession, DefaultResourceLoader, estimateTokens, SessionManager } from '@earendil-works/pi-coding-agent'
import { applyVesperSystemPrompt, vesperPromptExtension } from '../prompts/vesper-system-prompt.mjs'

export const DEFAULT_AGENT_MAX_DURATION_SECONDS = 180
export const MAX_AGENT_MAX_DURATION_SECONDS = 600
export const DEFAULT_AGENT_MAX_TOOL_CALLS = 24
export const MAX_AGENT_MAX_TOOL_CALLS = 100
export const MAX_CONCURRENT_AGENTS = 4
export const MAX_AGENTS_PER_PARENT = 64
export const MAX_AGENT_TASK_CHARS = 12_000
export const MAX_AGENT_OUTPUT_BYTES = 50 * 1024

export const MULTI_AGENT_TOOL_NAMES = Object.freeze([
  'spawn_agent',
  'list_agents',
  'send_message',
  'followup_task',
  'wait_agent',
  'interrupt_agent',
])

const PARENT_ONLY_TOOL_NAMES = new Set([
  ...MULTI_AGENT_TOOL_NAMES,
  'get_goal',
  'update_goal',
  'get_task_list',
  'update_task_list',
  'browser_automation',
  'mcp_list',
  'mcp_manage',
])

export const MULTI_AGENT_SYSTEM_PROMPT = `You are a Vesper subagent working in an isolated context on one delegated task.

Guidelines:
- Complete only the concrete task you were given and return a concise, evidence-based result.
- Inspect the relevant files before drawing conclusions or editing.
- Respect the tools, permission mode, workspace boundary, duration, and tool-call budget provided by the parent session.
- Do not duplicate unrelated work or wait for additional instructions.
- You cannot spawn other agents.
- Respond in the language used by the delegated task.`

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

function usageDifference(total, baseline) {
  return Object.fromEntries(Object.keys(total).map((key) => [key, Math.max(0, (Number(total[key]) || 0) - (Number(baseline?.[key]) || 0))]))
}

function modelLabel(model) {
  return model?.provider && model?.id ? `${model.provider}/${model.id}` : ''
}

function positiveInteger(value) {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? Math.floor(number) : null
}

function boundedInteger(value, fallback, maximum) {
  const number = positiveInteger(value)
  return Math.max(1, Math.min(maximum, number || fallback))
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
  const byteTruncated = outputBytes > MAX_AGENT_OUTPUT_BYTES
  if (!tokenTruncated && !byteTruncated) {
    return { text, fullText: text, truncated: false, estimatedTokens, tokenLimit, outputBytes, byteLimit: MAX_AGENT_OUTPUT_BYTES }
  }
  const reasons = [tokenTruncated ? 'model context' : '', byteTruncated ? '50 KB tool-output limit' : ''].filter(Boolean).join(' and ')
  const suffix = `\n\n[Output truncated for ${reasons}. Full output is preserved in agent details.]`
  const byteBudget = Math.max(0, MAX_AGENT_OUTPUT_BYTES - Buffer.byteLength(suffix, 'utf8'))
  const charBudget = tokenTruncated ? Math.max(0, tokenLimit * 4 - suffix.length) : text.length
  return {
    text: `${utf8Prefix(text.slice(0, charBudget), byteBudget)}${suffix}`,
    fullText: text,
    truncated: true,
    estimatedTokens,
    tokenLimit,
    outputBytes,
    byteLimit: MAX_AGENT_OUTPUT_BYTES,
  }
}

function childTools(allowedTools) {
  return [...new Set(Array.isArray(allowedTools) ? allowedTools.filter(Boolean) : [])]
    .filter((tool) => !PARENT_ONLY_TOOL_NAMES.has(tool))
}

function inheritedCustomTools(tools, customTools) {
  const enabled = new Set(tools)
  return Array.isArray(customTools) ? customTools.filter((tool) => enabled.has(tool?.name)) : []
}

function normalizeTaskName(value) {
  const normalized = String(value || '').trim().toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '')
    .slice(0, 48)
  return normalized || 'task'
}

function forkTurnCount(value) {
  if (value == null || value === '' || String(value).toLowerCase() === 'all') return Infinity
  if (String(value).toLowerCase() === 'none') return 0
  const number = positiveInteger(value)
  if (!number) throw new Error('forkTurns must be `none`, `all`, or a positive integer.')
  return number
}

function forkedMessages(messages, forkTurns) {
  const count = forkTurnCount(forkTurns)
  if (count === 0 || !Array.isArray(messages)) return []
  const safe = messages.filter((message) => ['user', 'assistant', 'toolResult'].includes(message?.role))
  if (!Number.isFinite(count)) return safe
  let remaining = count
  let start = safe.length
  while (start > 0 && remaining > 0) {
    start -= 1
    if (safe[start]?.role === 'user') remaining -= 1
  }
  return safe.slice(start)
}

function snapshotParentMessages(messages, forkTurns) {
  return forkedMessages(messages, forkTurns).map((message) => {
    try {
      return structuredClone(message)
    } catch {
      return message
    }
  })
}

async function createAgentResourceLoader({ cwd, agentDir, settingsManager, appendSystemPrompt = MULTI_AGENT_SYSTEM_PROMPT }) {
  const loader = new DefaultResourceLoader({
    cwd,
    agentDir: agentDir || cwd,
    ...(settingsManager ? { settingsManager } : {}),
    extensionFactories: [vesperPromptExtension],
    appendSystemPromptOverride: (base) => [...base, appendSystemPrompt],
  })
  await loader.reload()
  return loader
}

function publicRecord(record) {
  return {
    id: record.id,
    taskName: record.taskName,
    canonicalName: record.canonicalName,
    parentSessionId: record.parentSessionId,
    status: record.status,
    message: record.message,
    model: modelLabel(record.model),
    thinkingLevel: record.thinkingLevel,
    availableTools: [...record.availableTools],
    startedAt: record.startedAt,
    lastActivityAt: record.lastActivityAt,
    completedAt: record.completedAt,
    durationMs: record.durationMs,
    maxDurationSeconds: record.maxDurationSeconds,
    maxToolCalls: record.maxToolCalls,
    toolCallCount: record.toolCallCount,
    tools: record.tools.map((tool) => ({ ...tool })),
    output: record.output,
    fullOutput: record.fullOutput,
    outputTruncated: record.outputTruncated,
    usage: { ...record.usage },
    runUsage: { ...record.runUsage },
    runNumber: record.runNumber,
    error: record.error,
  }
}

export class MultiAgentService {
  constructor({
    agentDir,
    getModelRuntime,
    getSettingsManager,
    createSession = createAgentSession,
    createSessionManager = (cwd) => SessionManager.inMemory(cwd),
    createResourceLoader = createAgentResourceLoader,
    maxConcurrent = MAX_CONCURRENT_AGENTS,
    setTimer = setTimeout,
    clearTimer = clearTimeout,
  } = {}) {
    this.agentDir = agentDir
    this.getModelRuntime = getModelRuntime || (() => null)
    this.getSettingsManager = getSettingsManager || (() => null)
    this.createSession = createSession
    this.createSessionManager = createSessionManager
    this.createResourceLoader = createResourceLoader
    this.maxConcurrent = Math.max(1, Number(maxConcurrent) || MAX_CONCURRENT_AGENTS)
    this.setTimer = setTimer
    this.clearTimer = clearTimer
    this.records = new Map()
    this.waiters = new Map()
    this.sequence = 0
  }

  list(parentSessionId) {
    return [...this.records.values()]
      .filter((record) => !parentSessionId || record.parentSessionId === parentSessionId)
      .sort((left, right) => left.startedAt.localeCompare(right.startedAt))
      .map(publicRecord)
  }

  find(parentSessionId, target) {
    const value = String(target || '').trim()
    return [...this.records.values()].reverse().find((record) => record.parentSessionId === parentSessionId
      && [record.id, record.taskName, record.canonicalName].includes(value))
  }

  prune(parentSessionId) {
    const records = [...this.records.values()].filter((record) => record.parentSessionId === parentSessionId)
    const removable = records.filter((record) => !['starting', 'running'].includes(record.status))
    while (records.length > MAX_AGENTS_PER_PARENT && removable.length) {
      const record = removable.shift()
      try { record.unsubscribe?.() } catch {}
      try { record.session?.dispose?.() } catch {}
      this.records.delete(record.id)
      records.splice(records.indexOf(record), 1)
    }
  }

  notify(parentSessionId) {
    const waiters = this.waiters.get(parentSessionId)
    if (!waiters?.size) return
    this.waiters.delete(parentSessionId)
    for (const resolve of waiters) resolve(this.list(parentSessionId))
  }

  emit(record, onProgress) {
    record.lastActivityAt = new Date().toISOString()
    try { onProgress?.(publicRecord(record)) } catch {}
    this.notify(record.parentSessionId)
  }

  async wait(parentSessionId, timeoutMs = 15_000) {
    const current = this.list(parentSessionId)
    if (!current.some((record) => ['starting', 'running'].includes(record.status))) return { timedOut: false, agents: current }
    return new Promise((resolve) => {
      let settled = false
      let timer = null
      const finish = (agents, timedOut) => {
        if (settled) return
        settled = true
        this.clearTimer(timer)
        const waiters = this.waiters.get(parentSessionId)
        waiters?.delete(onUpdate)
        if (!waiters?.size) this.waiters.delete(parentSessionId)
        resolve({ timedOut, agents })
      }
      const onUpdate = (agents) => finish(agents, false)
      const waiters = this.waiters.get(parentSessionId) || new Set()
      waiters.add(onUpdate)
      this.waiters.set(parentSessionId, waiters)
      timer = this.setTimer(() => finish(this.list(parentSessionId), true), Math.max(250, Math.min(30_000, Number(timeoutMs) || 15_000)))
      timer?.unref?.()
    })
  }

  async spawn({ parentSessionId, cwd, model, thinkingLevel, taskName, message, forkTurns = 'all', parentMessages, allowedTools, customTools, maxDurationSeconds, maxToolCalls, onProgress, onSession, onCompleted } = {}) {
    if (!parentSessionId) throw new Error('Agent requires a parent session.')
    if (!cwd) throw new Error('Agent requires a workspace directory.')
    if (!model) throw new Error('Agent requires an active parent model.')
    const normalizedMessage = String(message || '').trim()
    if (!normalizedMessage) throw new Error('Agent task cannot be empty.')
    if (normalizedMessage.length > MAX_AGENT_TASK_CHARS) throw new Error(`Agent task is limited to ${MAX_AGENT_TASK_CHARS} characters.`)
    const active = [...this.records.values()].filter((record) => record.parentSessionId === parentSessionId && ['starting', 'running'].includes(record.status)).length
    if (active >= this.maxConcurrent) throw new Error(`Agent concurrency limit reached (${this.maxConcurrent}).`)

    const id = randomUUID()
    const normalizedName = normalizeTaskName(taskName)
    const record = {
      id,
      taskName: normalizedName,
      canonicalName: `/root/${normalizedName}_${++this.sequence}`,
      parentSessionId,
      cwd,
      model,
      thinkingLevel: thinkingLevel || 'medium',
      message: normalizedMessage,
      availableTools: childTools(allowedTools),
      customTools,
      // Snapshot at spawn time so later parent turns cannot change the forked context.
      parentMessages: snapshotParentMessages(parentMessages, forkTurns),
      maxDurationSeconds: boundedInteger(maxDurationSeconds, DEFAULT_AGENT_MAX_DURATION_SECONDS, MAX_AGENT_MAX_DURATION_SECONDS),
      maxToolCalls: boundedInteger(maxToolCalls, DEFAULT_AGENT_MAX_TOOL_CALLS, MAX_AGENT_MAX_TOOL_CALLS),
      toolCallCount: 0,
      tools: [],
      output: '',
      fullOutput: '',
      outputTruncated: false,
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, totalTokens: 0 },
      runUsage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, totalTokens: 0 },
      runNumber: 0,
      runGeneration: 0,
      timerGeneration: 0,
      error: '',
      startedAt: new Date().toISOString(),
      lastActivityAt: null,
      completedAt: null,
      durationMs: null,
      status: 'starting',
      session: null,
      unsubscribe: () => {},
      timer: null,
      aborted: false,
      abortReason: '',
      runningPromise: Promise.resolve(),
      restartChain: Promise.resolve(),
      onProgress,
      onSession,
      onCompleted,
    }
    this.records.set(id, record)
    this.prune(parentSessionId)
    this.emit(record, onProgress)
    record.runningPromise = this.startRun(record, normalizedMessage).catch(() => {})
    return publicRecord(record)
  }

  clearRunTimer(record, generation) {
    if (record.timerGeneration !== generation) return
    if (record.timer) this.clearTimer(record.timer)
    record.timer = null
    record.timerGeneration = 0
  }

  async startRun(record, message) {
    const generation = ++record.runGeneration
    const startedAt = Date.now()
    const isCurrent = () => record.runGeneration === generation
    try {
      if (!isCurrent()) return
      if (record.aborted) throw new Error(record.abortReason || 'Agent was interrupted.')
      if (!record.session) {
        const settingsManager = this.getSettingsManager()
        const resourceLoader = await this.createResourceLoader({ cwd: record.cwd, agentDir: this.agentDir || record.cwd, settingsManager, appendSystemPrompt: MULTI_AGENT_SYSTEM_PROMPT })
        if (!isCurrent()) return
        if (record.aborted) throw new Error(record.abortReason || 'Agent was interrupted.')
        const sessionManager = this.createSessionManager(record.cwd)
        for (const parentMessage of record.parentMessages) sessionManager.appendMessage?.(parentMessage)
        const childCustomTools = inheritedCustomTools(record.availableTools, record.customTools)
        const result = await this.createSession({
          cwd: record.cwd,
          agentDir: this.agentDir,
          model: record.model,
          thinkingLevel: record.thinkingLevel,
          modelRuntime: this.getModelRuntime(),
          settingsManager,
          resourceLoader,
          sessionManager,
          tools: record.availableTools,
          excludeTools: [...PARENT_ONLY_TOOL_NAMES],
          ...(childCustomTools.length ? { customTools: childCustomTools } : {}),
        })
        if (!isCurrent()) {
          try { result?.session?.dispose?.() } catch {}
          return
        }
        if (record.aborted) {
          try { result?.session?.dispose?.() } catch {}
          throw new Error(record.abortReason || 'Agent was interrupted.')
        }
        if (!result?.session) throw new Error('Agent session could not be created.')
        record.session = result.session
        applyVesperSystemPrompt(record.session, record.model)
        record.onSession?.(record.session)
        record.unsubscribe = record.session.subscribe((event) => {
          // Session is reused across follow-up runs; always attribute live tool events to the current record state.
          if (event.type === 'tool_execution_start') {
            record.toolCallCount += 1
            record.tools.push({ id: event.toolCallId, name: event.toolName, status: 'running' })
            if (record.toolCallCount > record.maxToolCalls) {
              this.interrupt(record.parentSessionId, record.id, `Agent exceeded its ${record.maxToolCalls}-tool-call budget.`)
            }
          } else if (event.type === 'tool_execution_end') {
            record.tools = record.tools.map((tool) => tool.id === event.toolCallId ? { ...tool, status: event.isError ? 'error' : 'done' } : tool)
          }
          this.emit(record, record.onProgress)
        })
      }

      if (!isCurrent()) return
      const usageBeforeRun = usageTotal(record.session.messages)
      record.runNumber += 1
      record.message = message
      record.toolCallCount = 0
      record.tools = []
      record.output = ''
      record.fullOutput = ''
      record.outputTruncated = false
      record.runUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, totalTokens: 0 }
      record.status = 'running'
      record.error = ''
      record.completedAt = null
      record.durationMs = null
      this.emit(record, record.onProgress)
      this.clearRunTimer(record, record.timerGeneration)
      record.timerGeneration = generation
      record.timer = this.setTimer(() => {
        if (record.runGeneration !== generation) return
        this.interrupt(record.parentSessionId, record.id, `Agent exceeded its ${record.maxDurationSeconds}-second duration limit.`)
      }, record.maxDurationSeconds * 1000)
      record.timer?.unref?.()
      await record.session.prompt(message)
      if (!isCurrent()) return
      if (record.aborted) throw new Error(record.abortReason || 'Agent was interrupted.')
      const last = [...record.session.messages].reverse().find((item) => item?.role === 'assistant')
      if (last?.errorMessage) throw new Error(last.errorMessage)
      const output = contextLimitedText(textFromContent(last?.content), record.model)
      record.output = output.text || '(Agent returned no text output.)'
      record.fullOutput = output.fullText
      record.outputTruncated = output.truncated
      record.usage = usageTotal(record.session.messages)
      record.runUsage = usageDifference(record.usage, usageBeforeRun)
      record.status = 'completed'
      record.completedAt = new Date().toISOString()
      record.durationMs = Date.now() - startedAt
      this.emit(record, record.onProgress)
      try { await record.onCompleted?.(publicRecord(record)) } catch {}
    } catch (error) {
      if (!isCurrent()) return
      record.error = error instanceof Error ? error.message : String(error)
      record.status = record.aborted ? 'interrupted' : 'failed'
      record.completedAt = new Date().toISOString()
      record.durationMs = Date.now() - startedAt
      this.emit(record, record.onProgress)
    } finally {
      this.clearRunTimer(record, generation)
    }
  }

  async sendMessage(parentSessionId, target, message) {
    const record = this.find(parentSessionId, target)
    if (!record) throw new Error(`Unknown agent: ${target}`)
    const text = String(message || '').trim()
    if (!text) throw new Error('Agent message cannot be empty.')
    if (!record.session) throw new Error('Agent session is still starting.')
    if (record.status !== 'running') throw new Error('Agent is not running. Use followup_task to start another run.')
    await record.session.steer(text)
    this.emit(record, record.onProgress)
    return publicRecord(record)
  }

  async followup(parentSessionId, target, message) {
    const record = this.find(parentSessionId, target)
    if (!record) throw new Error(`Unknown agent: ${target}`)
    const text = String(message || '').trim()
    if (!text) throw new Error('Follow-up task cannot be empty.')

    if (['starting', 'running'].includes(record.status)) {
      if (!record.session) throw new Error('Agent session is still starting.')
      await record.session.followUp(text)
      this.emit(record, record.onProgress)
      return publicRecord(record)
    }

    // Serialize restarts and wait for the previous run to fully settle before clearing abort state.
    const restart = async () => {
      await (record.runningPromise || Promise.resolve()).catch(() => {})
      if (['starting', 'running'].includes(record.status)) {
        if (!record.session) throw new Error('Agent session is still starting.')
        await record.session.followUp(text)
        this.emit(record, record.onProgress)
        return publicRecord(record)
      }
      if (!record.session) throw new Error('Agent session is not available for follow-up.')
      record.aborted = false
      record.abortReason = ''
      record.startedAt = new Date().toISOString()
      record.status = 'starting'
      record.error = ''
      record.completedAt = null
      record.durationMs = null
      this.emit(record, record.onProgress)
      record.runningPromise = this.startRun(record, text).catch(() => {})
      return publicRecord(record)
    }

    record.restartChain = (record.restartChain || Promise.resolve()).then(restart, restart)
    return record.restartChain
  }

  interrupt(parentSessionId, target, reason = 'Agent was interrupted.') {
    const record = this.find(parentSessionId, target)
    if (!record) throw new Error(`Unknown agent: ${target}`)
    if (!['starting', 'running'].includes(record.status)) return publicRecord(record)
    record.aborted = true
    record.abortReason = reason
    record.status = 'interrupted'
    record.error = reason
    try {
      const aborting = record.session?.abort?.()
      if (aborting?.catch) void aborting.catch(() => {})
    } catch {}
    this.emit(record, record.onProgress)
    return publicRecord(record)
  }

  abortParent(parentSessionId) {
    let count = 0
    for (const record of this.records.values()) {
      if (record.parentSessionId !== parentSessionId || !['starting', 'running'].includes(record.status)) continue
      this.interrupt(parentSessionId, record.id, 'Agent was cancelled because the parent session stopped.')
      count += 1
    }
    return count
  }

  async dispose() {
    for (const record of this.records.values()) {
      if (['starting', 'running'].includes(record.status)) this.interrupt(record.parentSessionId, record.id, 'Agent service is shutting down.')
      try { record.unsubscribe?.() } catch {}
      try { record.session?.dispose?.() } catch {}
    }
    this.records.clear()
    for (const waiters of this.waiters.values()) for (const resolve of waiters) resolve([])
    this.waiters.clear()
  }
}
