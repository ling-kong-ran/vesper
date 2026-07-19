import { useCallback, useEffect, useRef, useState } from 'react'

export function useAutoScroll(contentVersion, { threshold = 64 } = {}) {
  const scrollRef = useRef(null)
  const [pinnedToBottom, setPinnedToBottom] = useState(true)
  const [hasUnread, setHasUnread] = useState(false)

  const scrollToBottom = useCallback((behavior = 'auto') => {
    const node = scrollRef.current
    if (!node) return
    node.scrollTo({ top: node.scrollHeight, behavior })
    setPinnedToBottom(true)
    setHasUnread(false)
  }, [])

  const onScroll = useCallback((event) => {
    const node = event.currentTarget
    const pinned = node.scrollHeight - node.scrollTop - node.clientHeight <= threshold
    setPinnedToBottom(pinned)
    if (pinned) setHasUnread(false)
  }, [threshold])

  useEffect(() => {
    if (!scrollRef.current) return
    if (pinnedToBottom) scrollToBottom()
    else setHasUnread(true)
  }, [contentVersion, pinnedToBottom, scrollToBottom])

  return { scrollRef, onScroll, hasUnread, scrollToBottom }
}
