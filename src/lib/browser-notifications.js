let serviceWorkerRegistrationPromise

function browserGlobals(options = {}) {
  return {
    windowRef: options.windowRef || (typeof window !== 'undefined' ? window : undefined),
    navigatorRef: options.navigatorRef || (typeof navigator !== 'undefined' ? navigator : undefined),
  }
}

export function getBrowserNotificationPermission(options = {}) {
  const { windowRef } = browserGlobals(options)
  if (!windowRef || !('Notification' in windowRef)) return 'unsupported'
  return windowRef.Notification.permission
}

export async function requestBrowserNotificationPermission(options = {}) {
  const { windowRef } = browserGlobals(options)
  if (!windowRef || !('Notification' in windowRef)) return 'unsupported'
  if (windowRef.Notification.permission !== 'default') return windowRef.Notification.permission
  return windowRef.Notification.requestPermission()
}

export async function prepareBrowserNotifications(options = {}) {
  const { windowRef, navigatorRef } = browserGlobals(options)
  if (!windowRef || !navigatorRef || !windowRef.isSecureContext || !('serviceWorker' in navigatorRef)) return null
  if (!serviceWorkerRegistrationPromise || options.forceRegistration) {
    serviceWorkerRegistrationPromise = navigatorRef.serviceWorker
      .register('/notification-sw.js', { scope: '/' })
      .then(() => navigatorRef.serviceWorker.ready)
      .catch((error) => {
        serviceWorkerRegistrationPromise = undefined
        throw error
      })
  }
  return serviceWorkerRegistrationPromise
}

export async function showBrowserSystemNotification({ title, body = '', tag = '', url = '' }, options = {}) {
  const { windowRef } = browserGlobals(options)
  if (!windowRef || !('Notification' in windowRef)) throw new Error('当前浏览器不支持系统通知。')
  if (windowRef.Notification.permission !== 'granted') throw new Error('通知权限未授权，请在浏览器站点设置中允许通知。')

  const registration = await prepareBrowserNotifications(options)
  const notificationOptions = {
    body: String(body || ''),
    tag: String(tag || ''),
    data: { url: String(url || windowRef.location?.href || '/') },
  }
  if (registration?.showNotification) {
    await registration.showNotification(String(title || 'Vesper'), notificationOptions)
    return { shown: true, transport: 'service-worker' }
  }

  const item = new windowRef.Notification(String(title || 'Vesper'), notificationOptions)
  item.onclick = () => { windowRef.focus(); item.close() }
  return { shown: true, transport: 'window' }
}

export function resetBrowserNotificationRegistrationForTests() {
  serviceWorkerRegistrationPromise = undefined
}
