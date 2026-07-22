import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { app, BrowserWindow, ipcMain, Menu, nativeTheme, net, shell } from 'electron'
import updater from 'electron-updater'
import { createVesperServer } from '../server/app-server.mjs'
import { releaseNotesMarkdown } from '../shared/release-notes.mjs'

const { autoUpdater } = updater
const RELEASES_URL = 'https://github.com/ling-kong-ran/vesper/releases'
const LATEST_RELEASE_API = 'https://api.github.com/repos/ling-kong-ran/vesper/releases/latest'
const UPDATE_CHANNEL = 'vesper:update-status'
let mainWindow = null
let vesperServer = null
let updateCheck = null
let quitting = false
let updateState = { state: 'idle', checkedAt: null }

process.env.PI_SKIP_VERSION_CHECK ||= '1'
process.env.PI_TELEMETRY ||= '0'

function normalizedVersion(value) {
  return String(value || '').trim().replace(/^v/i, '').split('-')[0]
}

function newerVersion(candidate, current) {
  const left = normalizedVersion(candidate).split('.').map((value) => Number.parseInt(value, 10) || 0)
  const right = normalizedVersion(current).split('.').map((value) => Number.parseInt(value, 10) || 0)
  for (let index = 0; index < Math.max(left.length, right.length); index += 1) {
    if ((left[index] || 0) !== (right[index] || 0)) return (left[index] || 0) > (right[index] || 0)
  }
  return false
}

function publishUpdate(patch) {
  updateState = { ...updateState, ...patch }
  for (const window of BrowserWindow.getAllWindows()) window.webContents.send(UPDATE_CHANNEL, updateState)
  return updateState
}

async function githubLatestRelease() {
  const response = await net.fetch(LATEST_RELEASE_API, {
    headers: { Accept: 'application/vnd.github+json', 'User-Agent': `Vesper/${app.getVersion()}` },
  })
  if (!response.ok) throw new Error(`GitHub Release 请求失败：HTTP ${response.status}`)
  const release = await response.json()
  const version = normalizedVersion(release.tag_name)
  return {
    version,
    releaseDate: release.published_at || release.created_at || null,
    notes: releaseNotesMarkdown(release.body),
    releaseUrl: release.html_url || RELEASES_URL,
    available: newerVersion(version, app.getVersion()),
  }
}

async function checkForUpdates({ silent = false } = {}) {
  if (updateCheck) return updateCheck
  if (!silent) publishUpdate({ state: 'checking', message: '', checkedAt: null })
  updateCheck = (async () => {
    try {
      if (app.isPackaged) {
        await autoUpdater.checkForUpdates()
        return updateState
      }
      const latest = await githubLatestRelease()
      return publishUpdate(latest.available ? {
        state: 'available',
        availableVersion: latest.version,
        releaseDate: latest.releaseDate,
        notes: latest.notes,
        releaseUrl: latest.releaseUrl,
        canDownload: false,
        checkedAt: new Date().toISOString(),
        message: '开发模式仅检查版本，请从 GitHub Releases 下载正式安装包。',
      } : {
        state: 'current',
        availableVersion: latest.version,
        releaseDate: latest.releaseDate,
        notes: latest.notes,
        releaseUrl: latest.releaseUrl,
        canDownload: false,
        checkedAt: new Date().toISOString(),
        message: '当前已是最新版本。',
      })
    } catch (error) {
      return publishUpdate({
        state: 'error',
        message: error instanceof Error ? error.message : String(error),
        checkedAt: new Date().toISOString(),
      })
    } finally {
      updateCheck = null
    }
  })()
  return updateCheck
}

function configureUpdater() {
  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.allowPrerelease = false
  autoUpdater.on('checking-for-update', () => publishUpdate({ state: 'checking', message: '' }))
  autoUpdater.on('update-available', (info) => publishUpdate({
    state: 'available',
    availableVersion: info.version,
    releaseDate: info.releaseDate || null,
    notes: releaseNotesMarkdown(info.releaseNotes),
    releaseUrl: RELEASES_URL,
    canDownload: true,
    checkedAt: new Date().toISOString(),
    message: '',
  }))
  autoUpdater.on('update-not-available', (info) => publishUpdate({
    state: 'current',
    availableVersion: info.version || app.getVersion(),
    releaseDate: info.releaseDate || null,
    notes: releaseNotesMarkdown(info.releaseNotes),
    releaseUrl: RELEASES_URL,
    canDownload: false,
    checkedAt: new Date().toISOString(),
    message: '当前已是最新版本。',
  }))
  autoUpdater.on('download-progress', (progress) => publishUpdate({
    state: 'downloading',
    percent: Math.max(0, Math.min(100, Number(progress.percent) || 0)),
    bytesPerSecond: Number(progress.bytesPerSecond) || 0,
    transferred: Number(progress.transferred) || 0,
    total: Number(progress.total) || 0,
    message: '',
  }))
  autoUpdater.on('update-downloaded', (info) => publishUpdate({
    state: 'downloaded',
    availableVersion: info.version,
    releaseDate: info.releaseDate || updateState.releaseDate || null,
    notes: releaseNotesMarkdown(info.releaseNotes) || updateState.notes || '',
    releaseUrl: RELEASES_URL,
    canDownload: false,
    canInstall: true,
    percent: 100,
    message: '更新已下载，重启后完成安装。',
  }))
  autoUpdater.on('error', (error) => publishUpdate({
    state: 'error',
    message: error instanceof Error ? error.message : String(error),
    checkedAt: new Date().toISOString(),
  }))
}

function titleBarOptions() {
  if (process.platform === 'darwin') return { titleBarStyle: 'hiddenInset' }
  return {
    titleBarStyle: 'hidden',
    titleBarOverlay: {
      color: '#00000000',
      symbolColor: nativeTheme.shouldUseDarkColors ? '#f4f4f5' : '#18181b',
      height: 42,
    },
  }
}

function updateTitleBarOverlay() {
  if (!mainWindow || process.platform === 'darwin' || typeof mainWindow.setTitleBarOverlay !== 'function') return
  mainWindow.setTitleBarOverlay({
    color: '#00000000',
    symbolColor: nativeTheme.shouldUseDarkColors ? '#f4f4f5' : '#18181b',
    height: 42,
  })
}

async function openExternalUrl(value) {
  try {
    const url = new URL(value)
    if (!['http:', 'https:', 'mailto:'].includes(url.protocol)) return false
    await shell.openExternal(url.href)
    return true
  } catch {
    return false
  }
}

async function createWindow() {
  const appRoot = app.getAppPath()
  const icon = join(appRoot, 'build', 'icon.png')
  if (!vesperServer) {
    vesperServer = await createVesperServer({
      root: appRoot,
      runtimeCwd: process.env.VESPER_WORKSPACE_DIR || homedir(),
      dataDir: process.env.VESPER_AGENT_DIR || join(homedir(), '.vesper', 'agent'),
      production: true,
      port: 0,
      host: '127.0.0.1',
    })
  }
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 980,
    minHeight: 680,
    show: false,
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#111113' : '#ffffff',
    autoHideMenuBar: true,
    ...(existsSync(icon) ? { icon } : {}),
    ...titleBarOptions(),
    webPreferences: {
      preload: join(appRoot, 'electron', 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })
  Menu.setApplicationMenu(null)
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    void openExternalUrl(url)
    return { action: 'deny' }
  })
  mainWindow.webContents.on('will-navigate', (event, url) => {
    try {
      if (new URL(url).origin === vesperServer.url) return
    } catch {
      // Invalid and non-web URLs are always kept outside the renderer.
    }
    event.preventDefault()
    void openExternalUrl(url)
  })
  mainWindow.once('ready-to-show', () => mainWindow?.show())
  mainWindow.on('closed', () => { mainWindow = null })
  await mainWindow.loadURL(vesperServer.url)
}

function registerIpc() {
  ipcMain.handle('vesper:get-app-info', () => ({
    desktop: true,
    packaged: app.isPackaged,
    version: app.getVersion(),
    platform: process.platform,
    arch: process.arch,
    releasesUrl: RELEASES_URL,
    update: updateState,
  }))
  ipcMain.handle('vesper:check-for-updates', () => checkForUpdates())
  ipcMain.handle('vesper:download-update', async () => {
    if (!app.isPackaged || updateState.state !== 'available' || !updateState.canDownload) {
      await openExternalUrl(updateState.releaseUrl || RELEASES_URL)
      return publishUpdate({ ...updateState, message: '已打开 GitHub Releases。' })
    }
    publishUpdate({ state: 'downloading', percent: 0, message: '' })
    await autoUpdater.downloadUpdate()
    return updateState
  })
  ipcMain.handle('vesper:install-update', () => {
    if (updateState.state !== 'downloaded') return false
    autoUpdater.quitAndInstall(false, true)
    return true
  })
  ipcMain.handle('vesper:open-releases', async () => {
    await openExternalUrl(updateState.releaseUrl || RELEASES_URL)
    return true
  })
}

if (!app.requestSingleInstanceLock()) app.quit()
else {
  app.on('second-instance', () => {
    if (!mainWindow) return
    if (mainWindow.isMinimized()) mainWindow.restore()
    mainWindow.focus()
  })
  app.whenReady().then(async () => {
    configureUpdater()
    registerIpc()
    nativeTheme.on('updated', updateTitleBarOverlay)
    await createWindow()
    setTimeout(() => { void checkForUpdates({ silent: true }) }, 12_000)
    app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) void createWindow() })
  })
}

app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
app.on('before-quit', (event) => {
  if (quitting || !vesperServer) return
  event.preventDefault()
  quitting = true
  void vesperServer.close().finally(() => app.quit())
})
