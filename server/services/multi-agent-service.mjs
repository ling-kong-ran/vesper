import { randomUUID } from 'node:crypto'
import { createAgentSession, DEFAULT_MAX_BYTES, DefaultResourceLoader, estimateTokens, formatSize, SessionManager } from '@earendil-works/pi-coding-agent'
import { applyVesperSystemPrompt, vesperPromptExtension } from '../prompts/vesper-system-prompt.mjs'
import { createCompactionSettingsManager, vesperCompactionExtension } from '../runtime/compaction-policy.mjs'
import { readJson, writeJsonAtomic } from '../storage/json-file.mjs'
import { redactSecretText, redactSecretValue } from '../security/secret-redaction.mjs'

export const DEFAULT_AGENT_MAX_DURATION_SECONDS = 180
export const MAX_AGENT_MAX_DURATION_SECONDS = 600
export const DEFAULT_AGENT_MAX_TOOL_CALLS = 24
export const MAX_AGENT_MAX_TOOL_CALLS = 100
export const MAX_CONCURRENT_AGENTS = 4
export const MAX_AGENTS_PER_PARENT = 64
export const MAX_AGENT_TASK_CHARS = 12_000
export const MAX_AGENT_DEPENDENCIES = 8
export const AGENT_ROLES = Object.freeze(['explorer', 'reviewer', 'worker', 'tester'])

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

const EXECUTING_AGENT_STATUSES = new Set(['starting', 'running'])
const ACTIVE_AGENT_STATUSES = new Set(['queued', ...EXECUTING_AGENT_STATUSES])
const TERMINAL_AGENT_STATUSES = new Set(['completed', 'failed', 'interrupted'])
const READ_ONLY_ROLE_TOOLS = new Set(['read', 'ls', 'grep', 'find', 'memory_search', 'web_search'])
const TESTER_ROLE_TOOLS = new Set([...READ_ONLY_ROLE_TOOLS, 'bash'])
const RESTART_INTERRUPTION_REASON = 'Agent was interrupted because Vesper restarted.'

export const MULTI_AGENT_SYSTEM_PROMPT = `You are a Vesper subagent working in an isolated context on one delegated task.

Guidelines:
- Complete only the concrete task you were given and return a concise, evidence-based result.
- Inspect the relevant files before drawing conclusions or editing.
- Respect the tools, permission mode, workspace boundary, duration, and tool-call budget provided by the parent session.
- Do not duplicate unrelated work or wait for additional instructions.
- You cannot spawn other agents.
- Respond in the language used by the delegated task.`

const ROLE_SYSTEM_PROMPTS = Object.freeze({
  explorer: 'Role: explorer. Investigate and map the relevant code or evidence. Do not modify files. Return findings, exact file references, risks, and recommended next steps.',
  reviewer: 'Role: reviewer. Review the delegated scope without modifying files. Prioritize concrete defects, severity, evidence, and missing tests. Avoid speculative style comments.',
  worker: 'Role: worker. Implement only the delegated change. Avoid files owned by other tasks, validate the result, and report changed files, tests, and residual risks.',
  tester: 'Role: tester. Reproduce and validate behavior without modifying source files. Report commands, observed results, failures, and the smallest actionable diagnosis.',
})

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

function modelFromLabel(value) {
  const label = String(value || '')
  const separator = label.indexOf('/')
  return separator > 0 ? { provider: label.slice(0, separator), id: label.slice(separator + 1) } : null
}

function emptyUsage() {
  return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, totalTokens: 0 }
}

function durableRecord(record) {
  return {
    id: record.id,
    taskName: record.taskName,
    canonicalName: record.canonicalName,
    parentSessionId: record.parentSessionId,
    role: record.role,
    dependsOn: [...record.dependsOn],
    cwd: record.cwd,
    model: modelLabel(record.model),
    thinkingLevel: record.thinkingLevel,
    message: redactSecretText(record.message),
    availableTools: [...record.availableTools],
    maxDurationSeconds: record.maxDurationSeconds,
    maxToolCalls: record.maxToolCalls,
    toolCallCount: record.toolCallCount,
    tools: redactSecretValue(record.tools.map((tool) => ({ ...tool }))),
    output: redactSecretText(record.output),
    outputTruncated: record.outputTruncated,
    usage: { ...record.usage },
    runUsage: { ...record.runUsage },
    runNumber: record.runNumber,
    resultVersion: record.resultVersion,
    deliveredVersion: record.deliveredVersion,
    error: redactSecretText(record.error),
    startedAt: record.startedAt,
    lastActivityAt: record.lastActivityAt,
    completedAt: record.completedAt,
    durationMs: record.durationMs,
    status: record.status,
    currentActivity: redactSecretValue(record.currentActivity),
  }
}

function restoredRecord(value) {
  const id = String(value?.id || '').trim()
  const parentSessionId = String(value?.parentSessionId || '').trim()
  const model = modelFromLabel(value?.model)
  if (!id || !parentSessionId || !model) return null
  const status = TERMINAL_AGENT_STATUSES.has(value?.status) || ACTIVE_AGENT_STATUSES.has(value?.status) ? value.status : 'failed'
  const output = String(value?.output || '')
  return {
    id,
    taskName: normalizeTaskName(value?.taskName),
    canonicalName: String(value?.canonicalName || `/root/${normalizeTaskName(value?.taskName)}_restored`),
    parentSessionId,
    role: normalizeRole(value?.role),
    dependsOn: Array.isArray(value?.dependsOn) ? [...new Set(value.dependsOn.map(String).filter(Boolean))].slice(0, MAX_AGENT_DEPENDENCIES) : [],
    cwd: String(value?.cwd || ''),
    model,
    thinkingLevel: String(value?.thinkingLevel || 'medium'),
    message: String(value?.message || ''),
    availableTools: childTools(value?.availableTools),
    customTools: [],
    maxDurationSeconds: boundedInteger(value?.maxDurationSeconds, DEFAULT_AGENT_MAX_DURATION_SECONDS, MAX_AGENT_MAX_DURATION_SECONDS),
    maxToolCalls: boundedInteger(value?.maxToolCalls, DEFAULT_AGENT_MAX_TOOL_CALLS, MAX_AGENT_MAX_TOOL_CALLS),
    toolCallCount: positiveInteger(value?.toolCallCount) || 0,
    tools: Array.isArray(value?.tools) ? value.tools.map((tool) => ({ ...tool })) : [],
    output,
    fullOutput: output,
    outputTruncated: Boolean(value?.outputTruncated),
    usage: { ...emptyUsage(), ...(value?.usage || {}) },
    runUsage: { ...emptyUsage(), ...(value?.runUsage || {}) },
    runNumber: positiveInteger(value?.runNumber) || 0,
    runGeneration: 0,
    timerGeneration: 0,
    slotActive: false,
    resultVersion: positiveInteger(value?.resultVersion) || 0,
    deliveredVersion: positiveInteger(value?.deliveredVersion) || 0,
    error: String(value?.error || ''),
    startedAt: value?.startedAt || new Date().toISOString(),
    lastActivityAt: value?.lastActivityAt || null,
    completedAt: value?.completedAt || null,
    durationMs: Number.isFinite(value?.durationMs) ? value.durationMs : null,
    status,
    currentActivity: value?.currentActivity && typeof value.currentActivity === 'object' ? { ...value.currentActivity } : null,
    session: null,
    unsubscribe: () => {},
    timer: null,
    aborted: false,
    abortReason: '',
    runningPromise: Promise.resolve(),
    restartChain: Promise.resolve(),
    pendingMessages: [],
    onProgress: null,
    onSession: null,
    onCompleted: null,
    onTerminal: null,
  }
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
  const byteTruncated = outputBytes > DEFAULT_MAX_BYTES
  if (!tokenTruncated && !byteTruncated) {
    return { text, fullText: text, truncated: false, estimatedTokens, tokenLimit, outputBytes, byteLimit: DEFAULT_MAX_BYTES }
  }
  const reasons = [tokenTruncated ? 'model context' : '', byteTruncated ? `${formatSize(DEFAULT_MAX_BYTES)} Pi tool-output limit` : ''].filter(Boolean).join(' and ')
  const suffix = `\n\n[Output truncated for ${reasons}.]`
  const byteBudget = Math.max(0, DEFAULT_MAX_BYTES - Buffer.byteLength(suffix, 'utf8'))
  const charBudget = tokenTruncated ? Math.max(0, tokenLimit * 4 - suffix.length) : text.length
  return {
    text: `${utf8Prefix(text.slice(0, charBudget), byteBudget)}${suffix}`,
    fullText: text,
    truncated: true,
    estimatedTokens,
    tokenLimit,
    outputBytes,
    byteLimit: DEFAULT_MAX_BYTES,
  }
}

function childTools(allowedTools) {
  return [...new Set(Array.isArray(allowedTools) ? allowedTools.filter(Boolean) : [])]
    .filter((tool) => !PARENT_ONLY_TOOL_NAMES.has(tool))
}

function normalizeRole(value) {
  return AGENT_ROLES.includes(value) ? value : 'worker'
}

function toolsForRole(role, allowedTools) {
  const tools = childTools(allowedTools)
  if (role === 'explorer' || role === 'reviewer') return tools.filter((tool) => READ_ONLY_ROLE_TOOLS.has(tool))
  if (role === 'tester') return tools.filter((tool) => TESTER_ROLE_TOOLS.has(tool))
  return tools
}

function roleSystemPrompt(role) {
  return `${MULTI_AGENT_SYSTEM_PROMPT}\n\n${ROLE_SYSTEM_PROMPTS[normalizeRole(role)]}`
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

async function createAgentResourceLoader({ cwd, agentDir, settingsManager, appendSystemPrompt = MULTI_AGENT_SYSTEM_PROMPT }) {
  const loader = new DefaultResourceLoader({
    cwd,
    agentDir: agentDir || cwd,
    ...(settingsManager ? { settingsManager } : {}),
    extensionFactories: [vesperPromptExtension, vesperCompactionExtension],
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
    role: record.role,
    dependsOn: [...record.dependsOn],
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
    resultVersion: record.resultVersion,
    deliveredVersion: record.deliveredVersion,
    error: record.error,
    currentActivity: record.currentActivity ? { ...record.currentActivity } : null,
  }
}

export class MultiAgentService {
  constructor({
    path,
    agentDir,
    getModelRuntime,
    getSettingsManager,
    createSession = createAgentSession,
    createSessionManager = (cwd) => SessionManager.inMemory(cwd),
    createResourceLoader = createAgentResourceLoader,
    maxConcurrent = MAX_CONCURRENT_AGENTS,
    setTimer = setTimeout,
    clearTimer = clearTimeout,
    now = () => Date.now(),
  } = {}) {
    this.path = path
    this.agentDir = agentDir
    this.getModelRuntime = getModelRuntime || (() => null)
    this.getSettingsManager = getSettingsManager || (() => null)
    this.createSession = createSession
    this.createSessionManager = createSessionManager
    this.createResourceLoader = createResourceLoader
    this.maxConcurrent = Math.max(1, Number(maxConcurrent) || MAX_CONCURRENT_AGENTS)
    this.setTimer = setTimer
    this.clearTimer = clearTimer
    this.now = now
    this.records = new Map()
    this.waiters = new Map()
    this.sequence = 0
    this.write = Promise.resolve()
    this.disposing = false
  }

  async init() {
    if (!this.path) return
    const state = await readJson(this.path, { version: 1, sequence: 0, records: [] })
    this.sequence = Math.max(0, Number(state?.sequence) || 0)
    this.records.clear()
    let changed = false
    for (const value of Array.isArray(state?.records) ? state.records : []) {
      const record = restoredRecord(value)
      if (!record) continue
      if (ACTIVE_AGENT_STATUSES.has(record.status)) {
        const completedAt = new Date(this.now()).toISOString()
        record.status = 'interrupted'
        record.error = RESTART_INTERRUPTION_REASON
        record.tools = record.tools.map((tool) => tool.status === 'running' ? { ...tool, status: 'error', message: RESTART_INTERRUPTION_REASON } : tool)
        record.completedAt = completedAt
        record.lastActivityAt = completedAt
        record.durationMs = Math.max(0, this.now() - new Date(record.startedAt).getTime())
        record.resultVersion += 1
        changed = true
      }
      this.records.set(record.id, record)
    }
    if (changed) await this.save()
  }

  save() {
    if (!this.path) return Promise.resolve()
    const snapshot = {
      version: 2,
      sequence: this.sequence,
      records: [...this.records.values()].map(durableRecord),
    }
    this.write = this.write.catch(() => {}).then(() => writeJsonAtomic(this.path, snapshot))
    return this.write
  }

  flush() {
    return this.write
  }

  peekMailbox(parentSessionId) {
    return this.list(parentSessionId).filter((record) => TERMINAL_AGENT_STATUSES.has(record.status) && record.resultVersion > record.deliveredVersion)
  }

  async acknowledge(parentSessionId, agents = []) {
    const versions = new Map((Array.isArray(agents) ? agents : []).map((agent) => [agent.id, Number(agent.resultVersion) || 0]))
    let changed = false
    for (const record of this.records.values()) {
      if (record.parentSessionId !== parentSessionId || !TERMINAL_AGENT_STATUSES.has(record.status)) continue
      const version = versions.get(record.id)
      if (!version || version <= record.deliveredVersion) continue
      record.deliveredVersion = Math.min(record.resultVersion, version)
      changed = true
    }
    if (changed) await this.save()
    return changed
  }

  list(parentSessionId) {
    return [...this.records.values()]
      .filter((record) => !parentSessionId || record.parentSessionId === parentSessionId)
      .sort((left, right) => left.startedAt.localeCompare(right.startedAt))
      .map(publicRecord)
  }

  summaries(parentSessionId) {
    return this.list(parentSessionId).map((record) => {
      const { fullOutput: _fullOutput, ...summary } = record
      return { ...summary, output: String(record.output || '').slice(0, 1_000) }
    })
  }

  graph(parentSessionId) {
    const agents = this.summaries(parentSessionId)
    const nodes = [
      { id: `session:${parentSessionId}`, kind: 'parent', status: 'active' },
      ...agents.map((agent) => ({ id: agent.id, kind: 'agent', role: agent.role, taskName: agent.taskName, canonicalName: agent.canonicalName, status: agent.status })),
    ]
    const edges = agents.flatMap((agent) => [
      { sourceId: `session:${parentSessionId}`, targetId: agent.id, relation: 'delegates' },
      ...agent.dependsOn.map((dependencyId) => ({ sourceId: dependencyId, targetId: agent.id, relation: 'depends_on' })),
    ])
    return {
      parentSessionId,
      nodes,
      edges,
      counts: {
        queued: agents.filter((agent) => agent.status === 'queued').length,
        active: agents.filter((agent) => EXECUTING_AGENT_STATUSES.has(agent.status)).length,
        completed: agents.filter((agent) => agent.status === 'completed').length,
        failed: agents.filter((agent) => ['failed', 'interrupted'].includes(agent.status)).length,
      },
    }
  }

  find(parentSessionId, target) {
    const value = String(target || '').trim()
    return [...this.records.values()].reverse().find((record) => record.parentSessionId === parentSessionId
      && [record.id, record.taskName, record.canonicalName].includes(value))
  }

  resolveDependencies(parentSessionId, targets) {
    const dependencies = []
    for (const target of Array.isArray(targets) ? targets : []) {
      const record = this.find(parentSessionId, target)
      if (!record) throw new Error(`Unknown dependency agent: ${target}`)
      if (!dependencies.includes(record.id)) dependencies.push(record.id)
    }
    if (dependencies.length > MAX_AGENT_DEPENDENCIES) throw new Error(`Agent dependencies are limited to ${MAX_AGENT_DEPENDENCIES}.`)
    return dependencies
  }

  prune(parentSessionId) {
    const records = [...this.records.values()].filter((record) => record.parentSessionId === parentSessionId)
    const removable = records.filter((record) => !ACTIVE_AGENT_STATUSES.has(record.status))
    while (records.length >= MAX_AGENTS_PER_PARENT && removable.length) {
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
    const agents = this.list(parentSessionId)
    for (const waiter of [...waiters]) {
      if (waiter.predicate(agents)) waiter.finish(agents, false)
    }
  }

  emit(record, onProgress) {
    record.lastActivityAt = new Date(this.now()).toISOString()
    try { onProgress?.(publicRecord(record)) } catch {}
    this.notify(record.parentSessionId)
    void this.save().catch(() => {})
  }

  executingCount() {
    return [...this.records.values()].filter((record) => record.slotActive).length
  }

  dependencyState(record) {
    const dependencies = record.dependsOn.map((id) => this.records.get(id))
    const missingId = record.dependsOn.find((_id, index) => !dependencies[index])
    if (missingId) return { ready: false, failed: { canonicalName: missingId, status: 'missing' } }
    const failed = dependencies.find((dependency) => ['failed', 'interrupted'].includes(dependency.status))
    if (failed) return { ready: false, failed }
    return { ready: dependencies.every((dependency) => dependency.status === 'completed'), failed: null }
  }

  async scheduleQueued() {
    if (this.disposing) return
    let slots = Math.max(0, this.maxConcurrent - this.executingCount())
    const queued = [...this.records.values()]
      .filter((record) => record.status === 'queued')
      .sort((left, right) => left.startedAt.localeCompare(right.startedAt))
    for (const record of queued) {
      const dependency = this.dependencyState(record)
      if (dependency.failed) {
        const completedAt = new Date(this.now()).toISOString()
        record.status = 'failed'
        record.error = `Dependency ${dependency.failed.canonicalName} ended as ${dependency.failed.status}.`
        record.completedAt = completedAt
        record.currentActivity = null
        record.durationMs = Math.max(0, this.now() - new Date(record.startedAt).getTime())
        record.resultVersion += 1
        this.emit(record, record.onProgress)
        try { await record.onTerminal?.(publicRecord(record)) } catch {}
        continue
      }
      if (!dependency.ready || slots <= 0) continue
      slots -= 1
      record.status = 'starting'
      record.slotActive = true
      record.currentActivity = { type: 'model', stage: 'starting', updatedAt: new Date(this.now()).toISOString() }
      this.emit(record, record.onProgress)
      record.runningPromise = this.startRun(record, record.message).catch(() => {})
    }
    await this.save()
  }

  async wait(parentSessionId, timeoutMs = 15_000, target = '') {
    const current = this.list(parentSessionId)
    const targetRecord = target ? this.find(parentSessionId, target) : null
    if (target && !targetRecord) throw new Error(`Unknown agent: ${target}`)
    if (targetRecord && TERMINAL_AGENT_STATUSES.has(targetRecord.status)) return { timedOut: false, agents: current }
    const activeIds = new Set(current.filter((record) => ACTIVE_AGENT_STATUSES.has(record.status)).map((record) => record.id))
    if (!activeIds.size) return { timedOut: false, agents: current }
    const predicate = targetRecord
      ? (agents) => agents.some((record) => record.id === targetRecord.id && TERMINAL_AGENT_STATUSES.has(record.status))
      : (agents) => agents.some((record) => activeIds.has(record.id) && TERMINAL_AGENT_STATUSES.has(record.status))
    return new Promise((resolve) => {
      let settled = false
      let timer = null
      let waiter = null
      const finish = (agents, timedOut) => {
        if (settled) return
        settled = true
        this.clearTimer(timer)
        const waiters = this.waiters.get(parentSessionId)
        waiters?.delete(waiter)
        if (!waiters?.size) this.waiters.delete(parentSessionId)
        resolve({ timedOut, agents })
      }
      waiter = { predicate, finish }
      const waiters = this.waiters.get(parentSessionId) || new Set()
      waiters.add(waiter)
      this.waiters.set(parentSessionId, waiters)
      timer = this.setTimer(() => finish(this.list(parentSessionId), true), Math.max(250, Math.min(30_000, Number(timeoutMs) || 15_000)))
      timer?.unref?.()
    })
  }

  async spawn({ parentSessionId, cwd, model, thinkingLevel, taskName, message, role, dependsOn, allowedTools, customTools, maxDurationSeconds, maxToolCalls, onProgress, onSession, onCompleted, onTerminal } = {}) {
    if (!parentSessionId) throw new Error('Agent requires a parent session.')
    if (!cwd) throw new Error('Agent requires a workspace directory.')
    if (!model) throw new Error('Agent requires an active parent model.')
    const normalizedMessage = String(message || '').trim()
    if (!normalizedMessage) throw new Error('Agent task cannot be empty.')
    if (normalizedMessage.length > MAX_AGENT_TASK_CHARS) throw new Error(`Agent task is limited to ${MAX_AGENT_TASK_CHARS} characters.`)
    this.prune(parentSessionId)
    const parentRecordCount = [...this.records.values()].filter((record) => record.parentSessionId === parentSessionId).length
    if (parentRecordCount >= MAX_AGENTS_PER_PARENT) throw new Error(`Agent record limit reached for this session (${MAX_AGENTS_PER_PARENT}).`)
    const normalizedRole = normalizeRole(role)
    const dependencies = this.resolveDependencies(parentSessionId, dependsOn)
    const id = randomUUID()
    const normalizedName = normalizeTaskName(taskName)
    const record = {
      id,
      taskName: normalizedName,
      canonicalName: `/root/${normalizedName}_${++this.sequence}`,
      parentSessionId,
      role: normalizedRole,
      dependsOn: dependencies,
      cwd,
      model,
      thinkingLevel: thinkingLevel || 'medium',
      message: normalizedMessage,
      availableTools: toolsForRole(normalizedRole, allowedTools),
      customTools,
      maxDurationSeconds: boundedInteger(maxDurationSeconds, DEFAULT_AGENT_MAX_DURATION_SECONDS, MAX_AGENT_MAX_DURATION_SECONDS),
      maxToolCalls: boundedInteger(maxToolCalls, DEFAULT_AGENT_MAX_TOOL_CALLS, MAX_AGENT_MAX_TOOL_CALLS),
      toolCallCount: 0,
      tools: [],
      output: '',
      fullOutput: '',
      outputTruncated: false,
      usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, reasoning: 0, totalTokens: 0 },
      runUsage: emptyUsage(),
      runNumber: 0,
      runGeneration: 0,
      resultVersion: 0,
      deliveredVersion: 0,
      timerGeneration: 0,
      slotActive: false,
      error: '',
      startedAt: new Date(this.now()).toISOString(),
      lastActivityAt: null,
      completedAt: null,
      durationMs: null,
      status: 'queued',
      currentActivity: { type: 'queue', dependsOn: dependencies, updatedAt: new Date(this.now()).toISOString() },
      session: null,
      unsubscribe: () => {},
      timer: null,
      aborted: false,
      abortReason: '',
      runningPromise: Promise.resolve(),
      restartChain: Promise.resolve(),
      pendingMessages: [],
      onProgress,
      onSession,
      onCompleted,
      onTerminal,
    }
    this.records.set(id, record)
    this.emit(record, onProgress)
    await this.save()
    await this.scheduleQueued()
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
    const startedAt = this.now()
    const isCurrent = () => record.runGeneration === generation
    this.clearRunTimer(record, record.timerGeneration)
    record.timerGeneration = generation
    record.timer = this.setTimer(() => {
      if (record.runGeneration !== generation) return
      this.interrupt(record.parentSessionId, record.id, `Agent exceeded its ${record.maxDurationSeconds}-second duration limit.`)
    }, record.maxDurationSeconds * 1000)
    record.timer?.unref?.()
    try {
      if (!isCurrent()) return
      if (record.aborted) throw new Error(record.abortReason || 'Agent was interrupted.')
      if (!record.session) {
        const settingsManager = createCompactionSettingsManager(
          this.getSettingsManager(),
          () => record.model?.contextWindow,
        )
        const resourceLoader = await this.createResourceLoader({ cwd: record.cwd, agentDir: this.agentDir || record.cwd, settingsManager, appendSystemPrompt: roleSystemPrompt(record.role) })
        if (!isCurrent()) return
        if (record.aborted) throw new Error(record.abortReason || 'Agent was interrupted.')
        const sessionManager = this.createSessionManager(record.cwd)
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
            const tool = { type: 'tool', id: event.toolCallId, name: event.toolName, args: event.args, status: 'running', startedAt: new Date(this.now()).toISOString() }
            record.tools.push(tool)
            record.currentActivity = tool
            if (record.toolCallCount > record.maxToolCalls) {
              this.interrupt(record.parentSessionId, record.id, `Agent exceeded its ${record.maxToolCalls}-tool-call budget.`)
            }
          } else if (event.type === 'tool_execution_end') {
            const finishedAt = new Date(this.now()).toISOString()
            record.tools = record.tools.map((tool) => tool.id === event.toolCallId ? { ...tool, status: event.isError ? 'error' : 'done', finishedAt } : tool)
            record.currentActivity = event.isError
              ? { ...(record.currentActivity || {}), type: 'tool', id: event.toolCallId, name: event.toolName, status: 'error', finishedAt }
              : { type: 'model', stage: 'processing_result', updatedAt: finishedAt }
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
      record.runUsage = emptyUsage()
      record.status = 'running'
      record.currentActivity = { type: 'model', stage: 'thinking', updatedAt: new Date(this.now()).toISOString() }
      record.error = ''
      record.completedAt = null
      record.durationMs = null
      this.emit(record, record.onProgress)
      const promptPromise = record.session.prompt(message)
      try {
        const pendingMessages = record.pendingMessages.splice(0)
        for (const pending of pendingMessages) await record.session[pending.behavior](pending.text)
      } catch (error) {
        try { await record.session.abort?.() } catch {}
        await promptPromise.catch(() => {})
        throw error
      }
      await promptPromise
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
      record.currentActivity = null
      record.completedAt = new Date(this.now()).toISOString()
      record.durationMs = this.now() - startedAt
      record.resultVersion += 1
      this.emit(record, record.onProgress)
      await this.save()
      const terminal = publicRecord(record)
      try { await record.onCompleted?.(terminal) } catch {}
      try { await record.onTerminal?.(terminal) } catch {}
    } catch (error) {
      if (!isCurrent()) return
      const wasTerminal = TERMINAL_AGENT_STATUSES.has(record.status) && Boolean(record.completedAt)
      record.error = error instanceof Error ? error.message : String(error)
      record.status = record.aborted ? 'interrupted' : 'failed'
      record.currentActivity = null
      record.tools = record.tools.map((tool) => tool.status === 'running' ? { ...tool, status: 'error', message: record.error } : tool)
      record.completedAt ||= new Date(this.now()).toISOString()
      record.durationMs ??= this.now() - startedAt
      if (!wasTerminal) record.resultVersion += 1
      record.pendingMessages = []
      this.emit(record, record.onProgress)
      await this.save()
      if (!wasTerminal) {
        try { await record.onTerminal?.(publicRecord(record)) } catch {}
      }
    } finally {
      this.clearRunTimer(record, generation)
      if (record.runGeneration === generation) record.slotActive = false
      try { await this.scheduleQueued() } catch {}
    }
  }

  async sendMessage(parentSessionId, target, message) {
    const record = this.find(parentSessionId, target)
    if (!record) throw new Error(`Unknown agent: ${target}`)
    const text = String(message || '').trim()
    if (!text) throw new Error('Agent message cannot be empty.')
    if (text.length > MAX_AGENT_TASK_CHARS) throw new Error(`Agent message is limited to ${MAX_AGENT_TASK_CHARS} characters.`)
    if (['queued', 'starting'].includes(record.status)) {
      record.pendingMessages.push({ behavior: 'steer', text })
      this.emit(record, record.onProgress)
      return publicRecord(record)
    }
    if (record.status !== 'running' || !record.session) throw new Error('Agent is not running. Use followup_task to start another run.')
    await record.session.steer(text)
    this.emit(record, record.onProgress)
    return publicRecord(record)
  }

  async followup(parentSessionId, target, message) {
    const record = this.find(parentSessionId, target)
    if (!record) throw new Error(`Unknown agent: ${target}`)
    const text = String(message || '').trim()
    if (!text) throw new Error('Follow-up task cannot be empty.')
    if (text.length > MAX_AGENT_TASK_CHARS) throw new Error(`Follow-up task is limited to ${MAX_AGENT_TASK_CHARS} characters.`)

    if (['queued', 'starting'].includes(record.status)) {
      record.pendingMessages.push({ behavior: 'followUp', text })
      this.emit(record, record.onProgress)
      return publicRecord(record)
    }
    if (record.status === 'running') {
      if (!record.session) throw new Error('Agent session is not available.')
      await record.session.followUp(text)
      this.emit(record, record.onProgress)
      return publicRecord(record)
    }

    // Serialize restarts and wait for the previous run to fully settle before clearing abort state.
    const restart = async () => {
      await (record.runningPromise || Promise.resolve()).catch(() => {})
      if (['queued', 'starting'].includes(record.status)) {
        record.pendingMessages.push({ behavior: 'followUp', text })
        this.emit(record, record.onProgress)
        return publicRecord(record)
      }
      if (record.status === 'running') {
        if (!record.session) throw new Error('Agent session is not available.')
        await record.session.followUp(text)
        this.emit(record, record.onProgress)
        return publicRecord(record)
      }
      if (!record.session) throw new Error('Agent session is not available for follow-up.')
      record.aborted = false
      record.abortReason = ''
      record.startedAt = new Date(this.now()).toISOString()
      record.message = text
      record.status = 'queued'
      record.currentActivity = { type: 'queue', dependsOn: record.dependsOn, updatedAt: record.startedAt }
      record.error = ''
      record.completedAt = null
      record.durationMs = null
      this.emit(record, record.onProgress)
      await this.scheduleQueued()
      return publicRecord(record)
    }

    record.restartChain = (record.restartChain || Promise.resolve()).then(restart, restart)
    return record.restartChain
  }

  interrupt(parentSessionId, target, reason = 'Agent was interrupted.', schedule = true) {
    const record = this.find(parentSessionId, target)
    if (!record) throw new Error(`Unknown agent: ${target}`)
    if (!ACTIVE_AGENT_STATUSES.has(record.status)) return publicRecord(record)
    record.aborted = true
    record.abortReason = reason
    record.status = 'interrupted'
    record.currentActivity = null
    record.error = reason
    record.tools = record.tools.map((tool) => tool.status === 'running' ? { ...tool, status: 'error', message: reason } : tool)
    record.completedAt = new Date(this.now()).toISOString()
    record.durationMs = Math.max(0, this.now() - new Date(record.startedAt).getTime())
    record.resultVersion += 1
    record.pendingMessages = []
    try {
      const aborting = record.session?.abort?.()
      if (aborting?.catch) void aborting.catch(() => {})
    } catch {}
    this.emit(record, record.onProgress)
    const terminal = publicRecord(record)
    try {
      const notifying = record.onTerminal?.(terminal)
      if (notifying?.catch) void notifying.catch(() => {})
    } catch {}
    if (schedule) void this.scheduleQueued().catch(() => {})
    return terminal
  }

  abortParent(parentSessionId) {
    let count = 0
    for (const record of this.records.values()) {
      if (record.parentSessionId !== parentSessionId || !ACTIVE_AGENT_STATUSES.has(record.status)) continue
      this.interrupt(parentSessionId, record.id, 'Agent was cancelled because the parent session stopped.', false)
      count += 1
    }
    void this.scheduleQueued().catch(() => {})
    return count
  }

  async removeParent(parentSessionId) {
    this.abortParent(parentSessionId)
    for (const [id, record] of this.records) {
      if (record.parentSessionId !== parentSessionId) continue
      try { record.unsubscribe?.() } catch {}
      try { record.session?.dispose?.() } catch {}
      this.records.delete(id)
    }
    await this.save()
  }

  async dispose() {
    this.disposing = true
    for (const record of this.records.values()) {
      if (ACTIVE_AGENT_STATUSES.has(record.status)) this.interrupt(record.parentSessionId, record.id, 'Agent service is shutting down.', false)
      try { record.unsubscribe?.() } catch {}
      try { record.session?.dispose?.() } catch {}
    }
    await this.flush()
    this.records.clear()
    for (const waiters of this.waiters.values()) for (const waiter of [...waiters]) waiter.finish([], false)
    this.waiters.clear()
  }
}
