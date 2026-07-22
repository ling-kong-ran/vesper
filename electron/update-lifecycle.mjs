import { appendFileSync, existsSync, mkdirSync, renameSync, rmSync, statSync } from 'node:fs'
import { dirname } from 'node:path'
import { inspect } from 'node:util'

function logValue(value) {
  if (value instanceof Error) return value.stack || value.message
  if (typeof value === 'string') return value
  return inspect(value, { depth: 5, breakLength: 140, compact: true })
}

export function createUpdateLogger({ filePath, maxBytes = 2 * 1024 * 1024, now = () => new Date() }) {
  const archivePath = `${filePath}.1`
  const write = (level, values) => {
    try {
      mkdirSync(dirname(filePath), { recursive: true })
      if (existsSync(filePath) && statSync(filePath).size >= maxBytes) {
        rmSync(archivePath, { force: true })
        renameSync(filePath, archivePath)
      }
      appendFileSync(filePath, `${now().toISOString()} [${level}] ${values.map(logValue).join(' ')}\n`, 'utf8')
    } catch {
      // Logging must never prevent startup or updating.
    }
  }
  return {
    filePath,
    debug: (...values) => write('DEBUG', values),
    info: (...values) => write('INFO', values),
    warn: (...values) => write('WARN', values),
    error: (...values) => write('ERROR', values),
  }
}

export async function shutdownWithDeadline({ destroy, close, exit, logger = console, timeoutMs = 8_000 }) {
  try {
    await destroy?.()
  } catch (error) {
    logger.warn('Failed to destroy the application window during shutdown.', error)
  }

  let timer = null
  let timedOut = false
  try {
    await Promise.race([
      Promise.resolve().then(() => close?.()),
      new Promise((resolve) => {
        timer = setTimeout(() => {
          timedOut = true
          resolve()
        }, timeoutMs)
      }),
    ])
  } catch (error) {
    logger.error('Application cleanup failed during shutdown.', error)
  } finally {
    if (timer) clearTimeout(timer)
    if (timedOut) logger.warn(`Application cleanup exceeded ${timeoutMs}ms; forcing exit so the updater can continue.`)
    exit?.(0)
  }
  return { timedOut }
}
