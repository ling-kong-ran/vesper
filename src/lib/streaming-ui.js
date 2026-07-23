function createTimerScheduler(flush, intervalMs) {
  let timer = null
  return {
    schedule() {
      if (timer != null) return
      timer = setTimeout(() => {
        timer = null
        flush()
      }, intervalMs)
    },
    flushNow() {
      if (timer != null) {
        clearTimeout(timer)
        timer = null
      }
      flush()
    },
    cancel() {
      if (timer != null) clearTimeout(timer)
      timer = null
    },
    get active() {
      return timer != null
    },
  }
}

/** Coalesce high-frequency streaming text into ~20fps React updates. */
export function createStreamingTextScheduler(onFlush, { intervalMs = 48 } = {}) {
  let pending = null
  let lastActivityAt = null
  const timer = createTimerScheduler(() => {
    if (pending == null) return
    const text = pending
    const activityAt = lastActivityAt
    pending = null
    lastActivityAt = null
    onFlush(text, activityAt)
  }, intervalMs)

  return {
    push(text, activityAt = new Date().toISOString()) {
      pending = text
      lastActivityAt = activityAt
      timer.schedule()
    },
    flush() {
      timer.flushNow()
    },
    cancel() {
      timer.cancel()
      pending = null
      lastActivityAt = null
    },
  }
}

/** Merge rapid tool_update events by tool id before hitting React state. */
export function createToolUpdateScheduler(onFlush, { intervalMs = 80 } = {}) {
  let pending = new Map()
  let lastActivityAt = null
  const timer = createTimerScheduler(() => {
    if (!pending.size) return
    const batch = pending
    const activityAt = lastActivityAt
    pending = new Map()
    lastActivityAt = null
    onFlush(batch, activityAt)
  }, intervalMs)

  return {
    push(id, patch, activityAt = new Date().toISOString()) {
      if (!id) return
      pending.set(id, { ...(pending.get(id) || {}), ...patch })
      lastActivityAt = activityAt
      timer.schedule()
    },
    flush() {
      timer.flushNow()
    },
    cancel() {
      timer.cancel()
      pending = new Map()
      lastActivityAt = null
    },
  }
}
