import { useCallback, useEffect, useMemo, useState } from 'react'
import { Check, ChevronRight, Grid2X2, History, MessageSquare, Pencil, RefreshCw, Trash2 } from 'lucide-react'
import { APP_NAME } from '../../app/brand.js'
import { useI18n } from '../../app/i18n.jsx'
import { STORAGE_KEYS } from '../../app/storage.js'
import { StarOrbit } from '../../components/StarOrbit.jsx'
import { Panel } from '../../components/ui.jsx'
import { apiJson } from '../../lib/api.js'
import { relativeTime, workspaceName } from '../../lib/format.js'
import { ACTIVE_SESSION_CHANGED_EVENT, SESSIONS_UPDATED_EVENT, announceActiveSession, announceSessionsUpdated, requestSessionSelection } from './events.js'

function readTiledSessions() {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEYS.tiledSessions) || '[]')
    return Array.isArray(value) ? value.filter((id) => typeof id === 'string') : []
  } catch {
    return []
  }
}

export function ChatHistoryPage({ query, navigate, setChatMode, notify, requestConfirm, requestText }) {
  const { t, language } = useI18n()
  const [sessions, setSessions] = useState([])
  const [tiledIds, setTiledIds] = useState(readTiledSessions)
  const [activeId, setActiveId] = useState(() => localStorage.getItem(STORAGE_KEYS.activeSession) || '')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  const load = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const data = await apiJson('/api/sessions')
      setSessions([...(data.sessions || [])].sort((a, b) => Date.parse(b.modified) - Date.parse(a.modified)))
    } catch (caught) {
      setError(caught.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    document.title = `${t('历史会话')} · ${APP_NAME}`
    return () => { document.title = APP_NAME }
  }, [t])

  useEffect(() => {
    load()
    const refresh = () => load()
    const syncActive = (event) => setActiveId(event.detail?.id || localStorage.getItem(STORAGE_KEYS.activeSession) || '')
    window.addEventListener(SESSIONS_UPDATED_EVENT, refresh)
    window.addEventListener(ACTIVE_SESSION_CHANGED_EVENT, syncActive)
    return () => {
      window.removeEventListener(SESSIONS_UPDATED_EVENT, refresh)
      window.removeEventListener(ACTIVE_SESSION_CHANGED_EVENT, syncActive)
    }
  }, [load])

  const visible = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return sessions
    return sessions.filter((session) => `${session.name || ''} ${session.firstMessage || ''} ${session.cwd || ''} ${session.model || ''}`.toLowerCase().includes(needle))
  }, [query, sessions])

  const openSession = (id) => {
    setChatMode('focus')
    requestSessionSelection(id)
    navigate('chat')
  }

  const toggleTiled = (session) => {
    setTiledIds((current) => {
      const selected = current.includes(session.id)
      const next = selected ? current.filter((id) => id !== session.id) : [...current, session.id]
      localStorage.setItem(STORAGE_KEYS.tiledSessions, JSON.stringify(next))
      notify(t(selected ? '已将「{name}」移出平铺' : '已将「{name}」加入平铺', { name: session.name }), 'info')
      return next
    })
  }

  const renameSession = async (session) => {
    const name = await requestText({ title: t('重命名会话'), inputLabel: t('会话标题'), value: session.name, confirmLabel: t('保存') })
    if (name === null || name === session.name) return
    try {
      const updated = await apiJson(`/api/sessions/${encodeURIComponent(session.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ name }),
      })
      setSessions((current) => current.map((item) => item.id === session.id ? { ...item, name: updated.name } : item))
      announceSessionsUpdated()
      notify(t('会话标题已更新'))
    } catch (caught) {
      setError(caught.message)
    }
  }

  const deleteSession = async (session) => {
    const approved = await requestConfirm({ title: t('删除会话'), message: t('确定删除会话「{name}」吗？此操作会删除本地历史记录。', { name: session.name }), confirmLabel: t('删除') })
    if (!approved) return
    try {
      await apiJson(`/api/sessions/${encodeURIComponent(session.id)}`, { method: 'DELETE' })
      const remaining = sessions.filter((item) => item.id !== session.id)
      const nextTiled = tiledIds.filter((id) => id !== session.id)
      setSessions(remaining)
      setTiledIds(nextTiled)
      localStorage.setItem(STORAGE_KEYS.tiledSessions, JSON.stringify(nextTiled))
      if (activeId === session.id) {
        const nextId = remaining[0]?.id || ''
        setActiveId(nextId)
        if (nextId) localStorage.setItem(STORAGE_KEYS.activeSession, nextId)
        else localStorage.removeItem(STORAGE_KEYS.activeSession)
        announceActiveSession(nextId)
      }
      announceSessionsUpdated()
      notify(t('会话已删除'))
    } catch (caught) {
      setError(caught.message)
    }
  }

  return (
    <div className="chat-history-page">
      <div className="chat-history-summary">
        <div><History size={18} /><span><strong>{t('{count} 个历史会话', { count: sessions.length })}</strong><small>{query ? t('当前筛选到 {count} 个', { count: visible.length }) : t('按最近更新时间排列')}</small></span></div>
        <button className="button secondary" onClick={load} disabled={loading}><RefreshCw className={loading ? 'spin' : ''} size={14} />{t('刷新')}</button>
      </div>
      {error && <div className="config-error">{error}</div>}
      {loading && !sessions.length ? (
        <Panel className="empty-state"><RefreshCw className="spin" size={22} /><h2>{t('正在加载历史会话')}</h2></Panel>
      ) : visible.length ? (
        <Panel className="chat-history-list">
          {visible.map((session) => {
            const tiled = tiledIds.includes(session.id)
            return <div className={`chat-history-row ${session.id === activeId ? 'active' : ''}`} key={session.id}>
              <button className="chat-history-open" onClick={() => openSession(session.id)}>
                <span className="chat-history-icon"><MessageSquare size={15} /></span>
                <span className="chat-history-copy"><strong title={session.name || t('未命名会话')}>{session.name || t('未命名会话')}</strong><span>{session.firstMessage || t('暂无消息摘要')}</span><small>{workspaceName(session.cwd, language)}{session.model ? ` · ${String(session.model).split('/').at(-1)}` : ''}{session.streaming ? ` · ${t('Agent 运行中')}` : ''}</small></span>
                <span className="chat-history-meta"><strong>{t('{count} 条消息', { count: session.messageCount || 0 })}</strong><small>{relativeTime(session.modified, language)}</small></span>
                <ChevronRight size={15} />
              </button>
              <div className="chat-history-actions">
                <button className={tiled ? 'active' : ''} title={t(tiled ? '移出平铺' : '加入平铺')} aria-label={t(tiled ? '移出平铺' : '加入平铺')} onClick={() => toggleTiled(session)}>{tiled ? <Check size={14} /> : <Grid2X2 size={14} />}</button>
                <button title={t('重命名会话')} aria-label={t('重命名会话')} onClick={() => renameSession(session)}><Pencil size={14} /></button>
                <button className="danger" title={t('删除会话')} aria-label={t('删除会话')} onClick={() => deleteSession(session)}><Trash2 size={14} /></button>
              </div>
            </div>
          })}
        </Panel>
      ) : (
        <Panel className="empty-state"><StarOrbit size={48} /><h2>{t(query ? '没有匹配的历史会话' : '暂无历史会话')}</h2><p>{t(query ? '更换搜索关键词后重试。' : '创建并开始对话后，会话会显示在这里。')}</p></Panel>
      )}
    </div>
  )
}
