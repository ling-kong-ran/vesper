export const RUN_INACTIVITY_THRESHOLD_MS = 10_000
export const MAX_CURRENT_ACTIVITIES = 6

const RESEARCH_TOOLS = new Set(['read', 'grep', 'find', 'ls', 'memory_search', 'get_task_list', 'browser_automation'])
const EDIT_TOOLS = new Set(['edit', 'write', 'memory_remember'])
const AGENT_TOOLS = new Set(['spawn_agent', 'list_agents', 'send_message', 'followup_task', 'wait_agent', 'interrupt_agent'])

function timestamp(value) {
  const parsed = new Date(value || 0).getTime()
  return Number.isFinite(parsed) ? parsed : 0
}

export function latestRunningTool(tools = []) {
  return [...tools].reverse().find((tool) => tool?.status === 'running') || null
}

function activityKey(activity) {
  if (!activity?.type) return ''
  if (activity.type === 'tool') return `tool:${activity.id || activity.name || ''}`
  if (activity.type === 'agent') return `agent:${activity.agent?.id || activity.agent?.canonicalName || ''}:${activity.agent?.status || ''}`
  if (activity.type === 'plan') return `plan:${activity.updatedAt || activity.taskList?.updatedAt || ''}`
  if (activity.type === 'model') return `model:${activity.stage || ''}`
  if (activity.type === 'compaction') return `compaction:${activity.compaction?.status || activity.compaction?.active || ''}`
  return `${activity.type}:${activity.id || activity.updatedAt || ''}`
}

export function taskListChanges(previous, next) {
  const previousItems = new Map((previous?.items || []).map((item) => [item.id, item]))
  const nextItems = new Map((next?.items || []).map((item) => [item.id, item]))
  const changes = []
  for (const item of nextItems.values()) {
    const before = previousItems.get(item.id)
    if (!before) changes.push({ id: item.id, title: item.title, status: item.status, kind: 'added' })
    else if (before.status !== item.status || before.title !== item.title || before.note !== item.note) {
      changes.push({ id: item.id, title: item.title, status: item.status, previousStatus: before.status, kind: 'updated' })
    }
  }
  for (const item of previousItems.values()) {
    if (!nextItems.has(item.id)) changes.push({ id: item.id, title: item.title, status: item.status, kind: 'removed' })
  }
  return changes
}

export function pushCurrentActivity(feed = [], activity, maximum = MAX_CURRENT_ACTIVITIES) {
  const current = Array.isArray(feed) ? feed : []
  if (!['tool', 'plan', 'agent'].includes(activity?.type)) return current
  let next = [...current]
  if (activity.type === 'plan') next = next.filter((item) => item?.type !== 'tool' || !['get_task_list', 'update_task_list'].includes(item.name))
  if (activity.type === 'agent') next = next.filter((item) => item?.type !== 'tool' || !['spawn_agent', 'list_agents', 'send_message', 'followup_task', 'wait_agent', 'interrupt_agent'].includes(item.name))
  const key = activityKey(activity)
  const existingIndex = next.findIndex((item) => activityKey(item) === key)
  if (existingIndex >= 0) next[existingIndex] = { ...next[existingIndex], ...activity }
  else next.push(activity)
  return next.slice(-Math.max(1, Number(maximum) || MAX_CURRENT_ACTIVITIES))
}

export function settleToolCalls(tools = [], { finishedAt = new Date().toISOString(), error = '' } = {}) {
  return tools.map((tool) => tool?.status === 'running'
    ? { ...tool, status: error ? 'error' : 'done', message: error || tool.message || '', updatedAt: finishedAt, finishedAt }
    : tool)
}

export function deriveRunActivity({ streaming, text, tools = [], compaction, error, stopped, lastActivityAt, now = Date.now() } = {}) {
  if (!streaming) {
    if (stopped) return { stage: 'stopped', inactiveMs: 0, activeTool: null }
    if (error) return { stage: 'failed', inactiveMs: 0, activeTool: null }
    return { stage: 'completed', inactiveMs: 0, activeTool: null }
  }

  const activeTool = latestRunningTool(tools)
  const lastActivity = timestamp(lastActivityAt)
  const inactiveMs = lastActivity ? Math.max(0, now - lastActivity) : 0
  if (compaction?.active) return { stage: 'compacting', inactiveMs, activeTool: null }
  if (inactiveMs >= RUN_INACTIVITY_THRESHOLD_MS) {
    return { stage: activeTool ? 'waiting_tool' : 'waiting_model', inactiveMs, activeTool }
  }
  if (AGENT_TOOLS.has(activeTool?.name)) return { stage: 'subagent', inactiveMs, activeTool }
  if (activeTool?.name === 'generate_visual') return { stage: 'generating_visual', inactiveMs, activeTool }
  if (activeTool?.name === 'bash') return { stage: 'validating', inactiveMs, activeTool }
  if (EDIT_TOOLS.has(activeTool?.name)) return { stage: 'editing', inactiveMs, activeTool }
  if (RESEARCH_TOOLS.has(activeTool?.name)) return { stage: 'researching', inactiveMs, activeTool }
  if (activeTool) return { stage: 'using_tool', inactiveMs, activeTool }
  if (String(text || '').trim()) return { stage: 'responding', inactiveMs, activeTool: null }
  return { stage: 'thinking', inactiveMs, activeTool: null }
}

export function latestUnrecoveredToolError(tools = [], { streaming = true, lastActivityAt } = {}) {
  if (!streaming) return null
  let errorIndex = -1
  for (let index = tools.length - 1; index >= 0; index -= 1) {
    if (tools[index]?.status === 'error') { errorIndex = index; break }
  }
  if (errorIndex < 0) return null

  const error = tools[errorIndex]
  const hasLaterToolProgress = tools.slice(errorIndex + 1).some((tool) => tool?.status !== 'error')
  const errorAt = timestamp(error.finishedAt || error.updatedAt || error.startedAt)
  const activityAt = timestamp(lastActivityAt)
  if (hasLaterToolProgress || (errorAt && activityAt > errorAt)) return null
  return error
}

export function groupToolCalls(tools = []) {
  const running = []
  const errors = []
  const completedByName = new Map()
  for (const tool of tools) {
    if (!tool?.name) continue
    if (tool.status === 'running') {
      running.push(tool)
    } else if (tool.status === 'error') {
      errors.push(tool)
    } else {
      const existing = completedByName.get(tool.name) || { name: tool.name, count: 0, tools: [], message: '' }
      existing.count += 1
      existing.tools.push(tool)
      existing.message = tool.message || existing.message
      completedByName.set(tool.name, existing)
    }
  }
  return { running, errors, completed: [...completedByName.values()] }
}

export function runDurationMs(startedAt, finishedAt, now = Date.now()) {
  const start = timestamp(startedAt)
  if (!start) return 0
  const end = timestamp(finishedAt) || now
  return Math.max(0, end - start)
}

export function activityDurationMs(activity, runStartedAt, now = Date.now()) {
  const agent = activity?.type === 'agent' ? activity.agent || {} : {}
  const startedAt = activity?.startedAt || agent.startedAt || activity?.updatedAt || runStartedAt
  let finishedAt = activity?.finishedAt || agent.completedAt || ''
  if (!finishedAt && activity?.type === 'tool' && activity.status && activity.status !== 'running') finishedAt = activity.updatedAt
  if (!finishedAt && activity?.type === 'agent' && !['starting', 'running'].includes(agent.status)) finishedAt = agent.lastActivityAt || activity.updatedAt
  if (!finishedAt && activity?.type === 'plan') finishedAt = activity.updatedAt
  return runDurationMs(startedAt, finishedAt, now)
}

export function formatRunDuration(milliseconds, language = 'zh-CN') {
  const totalSeconds = Math.max(0, Math.floor((Number(milliseconds) || 0) / 1000))
  if (totalSeconds < 60) return language === 'en-US' ? `${totalSeconds}s` : `${totalSeconds} 秒`
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  if (minutes < 60) return `${minutes}:${String(seconds).padStart(2, '0')}`
  const hours = Math.floor(minutes / 60)
  return `${hours}:${String(minutes % 60).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}
