import { execFile } from 'node:child_process'

export const WINDOWS_NOTIFICATION_SETTINGS_URL = 'ms-settings:notifications'

const WINDOWS_PUSH_NOTIFICATIONS_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\PushNotifications'
const WINDOWS_NOTIFICATION_SETTINGS_KEY = 'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Notifications\\Settings'

export function parseRegistryDword(output, valueName) {
  const escapedName = String(valueName || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = String(output || '').match(new RegExp(`(?:^|\\r?\\n)\\s*${escapedName}\\s+REG_DWORD\\s+(0x[0-9a-f]+|\\d+)`, 'i'))
  if (!match) return null
  return Number.parseInt(match[1], match[1].toLowerCase().startsWith('0x') ? 16 : 10)
}

export function windowsNotificationStatus({ toastEnabled, globalToastsEnabled, appEnabled } = {}) {
  if (toastEnabled === 0 || globalToastsEnabled === 0) {
    return { supported: true, permission: 'denied', reason: 'system-disabled' }
  }
  if (appEnabled === 0) return { supported: true, permission: 'denied', reason: 'app-disabled' }
  return { supported: true, permission: 'granted', reason: '' }
}

export async function queryWindowsRegistryDword(key, valueName, execFileImpl = execFile) {
  return new Promise((resolve) => {
    execFileImpl('reg.exe', ['query', key, '/v', valueName], { encoding: 'utf8', windowsHide: true }, (error, stdout) => {
      if (error) { resolve(null); return }
      resolve(parseRegistryDword(stdout, valueName))
    })
  })
}

export async function getDesktopNotificationStatus({
  platform = process.platform,
  appUserModelId = '',
  isSupported = true,
  queryDword = queryWindowsRegistryDword,
} = {}) {
  if (!isSupported) return { supported: false, permission: 'unsupported', reason: 'unsupported' }
  if (platform !== 'win32') return { supported: true, permission: 'granted', reason: '' }

  const [toastEnabled, globalToastsEnabled, appEnabled] = await Promise.all([
    queryDword(WINDOWS_PUSH_NOTIFICATIONS_KEY, 'ToastEnabled'),
    queryDword(WINDOWS_NOTIFICATION_SETTINGS_KEY, 'NOC_GLOBAL_SETTING_TOASTS_ENABLED'),
    appUserModelId
      ? queryDword(`${WINDOWS_NOTIFICATION_SETTINGS_KEY}\\${appUserModelId}`, 'Enabled')
      : Promise.resolve(null),
  ])
  return windowsNotificationStatus({ toastEnabled, globalToastsEnabled, appEnabled })
}
