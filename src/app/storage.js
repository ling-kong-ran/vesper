export const STORAGE_KEYS = Object.freeze({
  theme: 'vesper-theme',
  chatMode: 'vesper-chat-mode',
  activeSession: 'vesper-active-session',
  tiledSessions: 'vesper-tiled-sessions',
})

const LEGACY_STORAGE_KEYS = Object.freeze({
  theme: 'pi-coder-theme',
  chatMode: 'pi-coder-chat-mode',
  activeSession: 'pi-coder-active-session',
  tiledSessions: 'pi-coder-tiled-sessions',
})

export function migrateLegacyStorage(storage = typeof window === 'undefined' ? null : window.localStorage) {
  if (!storage) return
  for (const name of Object.keys(STORAGE_KEYS)) {
    try {
      const legacyValue = storage.getItem(LEGACY_STORAGE_KEYS[name])
      if (legacyValue === null) continue
      if (storage.getItem(STORAGE_KEYS[name]) === null) storage.setItem(STORAGE_KEYS[name], legacyValue)
      storage.removeItem(LEGACY_STORAGE_KEYS[name])
    } catch {
      // Storage may be unavailable or disabled; the app can still use its defaults.
    }
  }
}
