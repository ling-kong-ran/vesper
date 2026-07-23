export const DEFAULT_SESSION_STATE = Object.freeze({
  messages: [],
  tools: [],
  approvals: [],
  taskList: null,
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
