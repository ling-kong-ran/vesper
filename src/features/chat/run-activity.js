export const RUN_INACTIVITY_THRESHOLD_MS = 10_000

const RESEARCH_TOOLS = new Set(['read', 'grep', 'find', 'ls', 'memory_search'])
const EDIT_TOOLS = new Set(['edit', 'write', 'memory_remember'])

function timestamp(value) {
  const parsed = new Date(value || 0).getTime()
  return Number.isFinite(parsed) ? parsed : 0
}

export function latestRunningTool(tools = []) {
  return [...tools].reverse().find((tool) => tool?.status === 'running') || null
}

export function deriveRunActivity({ streaming, text, tools = [], error, stopped, lastActivityAt, now = Date.now() } = {}) {
  if (!streaming) {
    if (stopped) return { stage: 'stopped', inactiveMs: 0, activeTool: null }
    if (error) return { stage: 'failed', inactiveMs: 0, activeTool: null }
    return { stage: 'completed', inactiveMs: 0, activeTool: null }
  }

  const activeTool = latestRunningTool(tools)
  const lastActivity = timestamp(lastActivityAt)
  const inactiveMs = lastActivity ? Math.max(0, now - lastActivity) : 0
  if (inactiveMs >= RUN_INACTIVITY_THRESHOLD_MS) {
    return { stage: activeTool ? 'waiting_tool' : 'waiting_model', inactiveMs, activeTool }
  }
  if (activeTool?.name === 'delegate_task') return { stage: 'subagent', inactiveMs, activeTool }
  if (activeTool?.name === 'generate_visual') return { stage: 'generating_visual', inactiveMs, activeTool }
  if (activeTool?.name === 'bash') return { stage: 'validating', inactiveMs, activeTool }
  if (EDIT_TOOLS.has(activeTool?.name)) return { stage: 'editing', inactiveMs, activeTool }
  if (RESEARCH_TOOLS.has(activeTool?.name)) return { stage: 'researching', inactiveMs, activeTool }
  if (activeTool) return { stage: 'using_tool', inactiveMs, activeTool }
  if (String(text || '').trim()) return { stage: 'responding', inactiveMs, activeTool: null }
  return { stage: 'thinking', inactiveMs, activeTool: null }
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

export function formatRunDuration(milliseconds, language = 'zh-CN') {
  const totalSeconds = Math.max(0, Math.floor((Number(milliseconds) || 0) / 1000))
  if (totalSeconds < 60) return language === 'en-US' ? `${totalSeconds}s` : `${totalSeconds} 秒`
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  if (minutes < 60) return `${minutes}:${String(seconds).padStart(2, '0')}`
  const hours = Math.floor(minutes / 60)
  return `${hours}:${String(minutes % 60).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`
}
