import { STORAGE_KEYS } from '../../app/storage.js'

export const SESSION_SELECTED_EVENT = 'vesper:session-selected'
export const ACTIVE_SESSION_CHANGED_EVENT = 'vesper:active-session-changed'
export const SESSIONS_UPDATED_EVENT = 'vesper:sessions-updated'

export function requestSessionSelection(id) {
  if (!id) return
  localStorage.setItem(STORAGE_KEYS.activeSession, id)
  window.dispatchEvent(new CustomEvent(SESSION_SELECTED_EVENT, { detail: { id } }))
}

export function announceActiveSession(id) {
  window.dispatchEvent(new CustomEvent(ACTIVE_SESSION_CHANGED_EVENT, { detail: { id: id || '' } }))
}

export function announceSessionsUpdated() {
  window.dispatchEvent(new Event(SESSIONS_UPDATED_EVENT))
}
