/** Coalesce high-frequency streaming text into ~20fps React updates. */
export function createStreamingTextScheduler(onFlush, { intervalMs = 48 } = {}) {
  let pending = null
  let timer = null
  let lastActivityAt = null

  const flush = () => {
    timer = null
    if (pending == null) return
    const text = pending
    const activityAt = lastActivityAt
    pending = null
    lastActivityAt = null
    onFlush(text, activityAt)
  }

  return {
    push(text, activityAt = new Date().toISOString()) {
      pending = text
      lastActivityAt = activityAt
      if (timer != null) return
      timer = setTimeout(flush, intervalMs)
    },
    flush() {
      if (timer != null) {
        clearTimeout(timer)
        timer = null
      }
      flush()
    },
    cancel() {
      if (timer != null) clearTimeout(timer)
      timer = null
      pending = null
      lastActivityAt = null
    },
  }
}
