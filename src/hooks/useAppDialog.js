import { useCallback, useEffect, useRef, useState } from 'react'

export function useAppDialog() {
  const [dialog, setDialog] = useState(null)
  const resolver = useRef(null)

  const finish = useCallback((value) => {
    resolver.current?.(value)
    resolver.current = null
    setDialog(null)
  }, [])

  const open = useCallback((next) => new Promise((resolve) => {
    resolver.current?.(null)
    resolver.current = resolve
    setDialog(next)
  }), [])

  const confirm = useCallback((options) => open({ type: 'confirm', title: '确认操作', confirmLabel: '确认', tone: 'danger', ...options }), [open])
  const prompt = useCallback((options) => open({ type: 'prompt', title: '输入内容', confirmLabel: '保存', tone: 'primary', value: '', ...options }), [open])
  const close = useCallback(() => finish(null), [finish])

  useEffect(() => () => resolver.current?.(null), [])
  return { dialog, confirm, prompt, close, finish }
}
