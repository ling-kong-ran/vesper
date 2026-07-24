export const DEFAULT_SESSION_STATE = Object.freeze({
  messages: [],
  tools: [],
  approvals: [],
  agents: [],
  currentActivity: null,
  activityFeed: [],
  thinkingText: '',
  queuedInputs: [],
  taskList: null,
  executionMode: null,
  contextUsage: null,
  compaction: null,
  streaming: false,
  error: '',
  loaded: false,
  messageStart: null,
  hasOlder: false,
  olderCursor: null,
})

export function sessionStateChanged(previous, next) {
  if (previous === next) return false
  if (!previous || !next) return true
  const keys = new Set([...Object.keys(previous), ...Object.keys(next)])
  for (const key of keys) {
    if (previous[key] !== next[key]) return true
  }
  return false
}

export function applySessionUpdate(previous, update) {
  const base = previous || DEFAULT_SESSION_STATE
  const next = typeof update === 'function' ? update(base) : { ...base, ...update }
  return sessionStateChanged(base, next) ? next : base
}

export function resolveQueuedInputs(current, incoming) {
  if (incoming === undefined) return current || []
  return Array.isArray(incoming) ? incoming : []
}

/**
 * Prefer the live session-state task list once a session has been opened.
 * Important: `null` means “cleared”, and must NOT fall back to stale listSessions data.
 */
export function resolveSessionTaskList(state, session) {
  if (state && (state.loaded || state.streaming || Object.hasOwn(state, 'taskList'))) {
    return state.taskList ?? null
  }
  return session?.taskList ?? state?.taskList ?? null
}

export function isTaskListActive(taskList, { streaming = false } = {}) {
  const items = taskList?.items || []
  if (!items.length) return false
  if (streaming) return true
  return items.some((item) => item?.status !== 'completed')
}
