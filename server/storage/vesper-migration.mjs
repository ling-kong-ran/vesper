import { cp, lstat, rename } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'

export const VESPER_CONFIG_DIR = '.vesper'
const LEGACY_CONFIG_DIR = '.pi'

const LEGACY_APP_DATA_ENTRIES = [
  ['pi-coder.json', 'vesper.json'],
  ['pi-coder-sessions.json', 'vesper-sessions.json'],
  ['pi-coder-usage.json', 'vesper-usage.json'],
  ['pi-coder-assets', 'vesper-assets'],
  ['pi-coder-assets.json', 'vesper-assets.json'],
  ['pi-coder-memory.sqlite', 'vesper-memory.sqlite'],
  ['pi-coder-memory.sqlite-shm', 'vesper-memory.sqlite-shm'],
  ['pi-coder-memory.sqlite-wal', 'vesper-memory.sqlite-wal'],
  ['pi-coder-channels.json', 'vesper-channels.json'],
  ['pi-coder-browser-notifications.json', 'vesper-browser-notifications.json'],
  ['pi-coder-schedules.json', 'vesper-schedules.json'],
]

async function pathInfo(path) {
  try {
    return await lstat(path)
  } catch (error) {
    if (error?.code === 'ENOENT') return null
    throw error
  }
}

/**
 * Copy the legacy Pi user directory only once. The original directory is left
 * untouched as a rollback-safe backup and for users who still use the Pi CLI.
 */
export async function migrateLegacyUserDirectory({ home = homedir() } = {}) {
  const source = join(home, LEGACY_CONFIG_DIR)
  const target = join(home, VESPER_CONFIG_DIR)
  const [sourceInfo, targetInfo] = await Promise.all([pathInfo(source), pathInfo(target)])
  if (!sourceInfo?.isDirectory() || targetInfo) return { copied: false, source, target }
  await cp(source, target, { recursive: true, force: false, preserveTimestamps: true, verbatimSymlinks: true })
  return { copied: true, source, target }
}

/** Move Vesper's copied application data away from the former product prefix. */
export async function migrateLegacyAppDataEntries(dataDir) {
  const migrated = []
  for (const [legacyName, vesperName] of LEGACY_APP_DATA_ENTRIES) {
    const source = join(dataDir, legacyName)
    const target = join(dataDir, vesperName)
    const [sourceInfo, targetInfo] = await Promise.all([pathInfo(source), pathInfo(target)])
    if (!sourceInfo || targetInfo) continue
    await rename(source, target)
    migrated.push({ source, target })
  }
  return migrated
}
