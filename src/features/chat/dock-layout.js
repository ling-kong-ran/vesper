export const CHAT_DOCK_LAYOUT_VERSION = 1
export const SESSION_OPEN_DISPOSITIONS = Object.freeze(['open', 'left', 'right'])
const SESSION_PANEL_PREFIX = 'session:'

export function panelIdForSession(sessionId) {
  return sessionId ? `${SESSION_PANEL_PREFIX}${sessionId}` : ''
}

export function sessionIdFromPanel(panel) {
  const fromParams = panel?.params?.sessionId
  if (typeof fromParams === 'string' && fromParams) return fromParams
  const panelId = typeof panel === 'string' ? panel : panel?.id
  return typeof panelId === 'string' && panelId.startsWith(SESSION_PANEL_PREFIX)
    ? panelId.slice(SESSION_PANEL_PREFIX.length)
    : ''
}

export function createDockLayoutEnvelope(layout, activePanelId = '') {
  return {
    version: CHAT_DOCK_LAYOUT_VERSION,
    engine: 'dockview',
    activePanelId: typeof activePanelId === 'string' ? activePanelId : '',
    layout,
  }
}

export function parseDockLayoutEnvelope(raw) {
  if (!raw) return null
  try {
    const value = typeof raw === 'string' ? JSON.parse(raw) : raw
    if (!value || value.version !== CHAT_DOCK_LAYOUT_VERSION || value.engine !== 'dockview') return null
    if (!value.layout || typeof value.layout !== 'object' || Array.isArray(value.layout)) return null
    return {
      version: CHAT_DOCK_LAYOUT_VERSION,
      engine: 'dockview',
      activePanelId: typeof value.activePanelId === 'string' ? value.activePanelId : '',
      layout: value.layout,
    }
  } catch {
    return null
  }
}

export function createSessionOpenRequest(sessionId, disposition = 'open') {
  if (!sessionId || !SESSION_OPEN_DISPOSITIONS.includes(disposition)) return null
  return { sessionId, disposition }
}

export function parseSessionOpenRequest(raw) {
  if (!raw) return null
  try {
    const value = typeof raw === 'string' ? JSON.parse(raw) : raw
    return createSessionOpenRequest(value?.sessionId, value?.disposition)
  } catch {
    return null
  }
}

export function initialDockSessionIds({ activeSessionId = '', legacyTiledSessionIds = [], validSessionIds = [] } = {}) {
  const valid = new Set(validSessionIds)
  const result = []
  const add = (id) => {
    if (valid.has(id) && !result.includes(id)) result.push(id)
  }
  add(activeSessionId)
  for (const id of legacyTiledSessionIds) add(id)
  if (!result.length) add(validSessionIds[0])
  return result
}
