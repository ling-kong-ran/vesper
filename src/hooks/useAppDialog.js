import { useCallback, useEffect, useRef, useState } from 'react'
import { useI18n } from '../app/use-i18n.js'

export function useAppDialog() {
  const { t } = useI18n()
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

  const confirm = useCallback((options) => open({ type: 'confirm', title: t('确认操作'), confirmLabel: t('确认'), tone: 'danger', ...options }), [open, t])
  const prompt = useCallback((options) => open({ type: 'prompt', title: t('输入内容'), confirmLabel: t('保存'), tone: 'primary', value: '', ...options }), [open, t])
  const close = useCallback(() => finish(null), [finish])

  useEffect(() => () => resolver.current?.(null), [])
  return { dialog, confirm, prompt, close, finish }
}
