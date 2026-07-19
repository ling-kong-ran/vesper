export function createPrimaryActionRegistry() {
  let currentAction = null
  let queued = false

  return {
    register(action) {
      currentAction = action
      if (queued) {
        queued = false
        action()
      }
      return () => {
        if (currentAction === action) currentAction = null
      }
    },
    invoke() {
      if (currentAction) return currentAction()
      queued = true
      return undefined
    },
    clear() {
      currentAction = null
    },
  }
}
