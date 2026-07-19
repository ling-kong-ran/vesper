import { useEffect, useRef } from 'react'

export function usePagePrimaryAction(registerPrimaryAction, action) {
  const actionRef = useRef(action)
  actionRef.current = action

  useEffect(() => {
    if (!registerPrimaryAction) return undefined
    return registerPrimaryAction(() => actionRef.current?.())
  }, [registerPrimaryAction])
}
