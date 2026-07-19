import { Suspense, lazy, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  AlertTriangle,
  ArrowDown,
  Bot,
  Check,
  ChevronDown,
  ChevronRight,
  Download,
  File,
  FolderOpen,
  Link2,
  Menu,
  Monitor,
  Moon,
  MoreHorizontal,
  Paperclip,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Rocket,
  Save,
  Search,
  Send,
  ShieldCheck,
  Square,
  Sun,
  Wrench,
  X,
} from 'lucide-react'
import { APP_NAME } from './app/brand.js'
import { STORAGE_KEYS } from './app/storage.js'
import { NAV_GROUPS, PAGE_META } from './app/navigation.jsx'
import { BrandLogo } from './components/BrandLogo.jsx'
import { StarOrbit } from './components/StarOrbit.jsx'
import { AppDialog, InputLabel, Panel, Segmented, SelectLabel, Toast } from './components/ui.jsx'
import { useAttachmentSelection } from './features/chat/attachments.js'
import { ChatHistoryPage } from './features/chat/ChatHistoryPage.jsx'
import { ACTIVE_SESSION_CHANGED_EVENT, SESSION_SELECTED_EVENT, SESSIONS_UPDATED_EVENT, announceActiveSession, announceSessionsUpdated, requestSessionSelection } from './features/chat/events.js'
import { useAutoScroll } from './hooks/useAutoScroll.js'
import { usePagePrimaryAction } from './hooks/usePagePrimaryAction.js'
import { apiJson, consumeEventStream } from './lib/api.js'
import { formatFileSize, formatTokenCount, relativeTime, workspaceName } from './lib/format.js'
import { useAppDialog } from './hooks/useAppDialog.js'

const PluginsPage = lazy(() => import('./features/plugins/PluginsPage.jsx').then((module) => ({ default: module.PluginsPage })))
const ChannelsPage = lazy(() => import('./features/channels/ChannelsPage.jsx').then((module) => ({ default: module.ChannelsPage })))
const ConfigPage = lazy(() => import('./features/config/ConfigPage.jsx').then((module) => ({ default: module.ConfigPage })))
const MemoryPage = lazy(() => import('./features/memory/MemoryPage.jsx').then((module) => ({ default: module.MemoryPage })))
const SchedulesPage = lazy(() => import('./features/schedules/SchedulesPage.jsx').then((module) => ({ default: module.SchedulesPage })))
const AssetsPage = lazy(() => import('./features/assets/AssetsPage.jsx').then((module) => ({ default: module.AssetsPage })))
const McpPage = lazy(() => import('./features/workflows/PreviewPages.jsx').then((module) => ({ default: module.McpPage })))
const SkillsPage = lazy(() => import('./features/workflows/PreviewPages.jsx').then((module) => ({ default: module.SkillsPage })))
const WorkflowsPage = lazy(() => import('./features/workflows/PreviewPages.jsx').then((module) => ({ default: module.WorkflowsPage })))
const WorkflowBuilder = lazy(() => import('./features/workflows/PreviewPages.jsx').then((module) => ({ default: module.WorkflowBuilder })))
const LazyMarkdownMessage = lazy(() => import('./components/MarkdownMessage.jsx'))

const EMPTY_LIST = []
const USAGE_UPDATED_EVENT = 'vesper:usage-updated'
const FOCUS_MESSAGE_PAGE_SIZE = 40
const GRID_MESSAGE_PAGE_SIZE = 16

function latestPageState(current, data) {
  const incomingStart = Number(data.pageInfo?.start) || 0
  const currentStart = Number.isInteger(current.messageStart) ? current.messageStart : null
  const preservePrefix = currentStart != null && currentStart <= incomingStart
  const prefixLength = preservePrefix ? Math.max(0, incomingStart - currentStart) : 0
  const messageStart = preservePrefix ? currentStart : incomingStart
  return {
    messages: preservePrefix ? [...current.messages.slice(0, prefixLength), ...data.messages] : data.messages,
    messageStart,
    hasOlder: messageStart > 0,
    olderCursor: messageStart > 0 ? String(messageStart) : null,
  }
}

function hasUsableProvider(config) {
  return Boolean(config?.providers?.some((provider) => provider.configured && provider.enabled && provider.models.some((model) => model.kind === 'chat')))
}

function readStoredArray(key) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || '[]')
    return Array.isArray(value) ? value.filter((item) => typeof item === 'string') : []
  } catch {
    return []
  }
}

function renderNotificationContent(content, data) {
  return String(content || '').replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_match, path) => {
    const value = path.split('.').reduce((current, key) => current?.[key], data)
    return value == null ? `{{${path}}}` : String(value)
  })
}

const THEME_SEQUENCE = ['system', 'light', 'dark']
const THEME_META = {
  system: ['跟随系统', Monitor],
  light: ['浅色', Sun],
  dark: ['深色', Moon],
}

function resolveDark(mode) {
  return mode === 'dark' || (mode === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
}

function isEditableTarget(target) {
  return target instanceof HTMLElement && (target.matches('input, textarea, select') || target.isContentEditable)
}

function App() {
  const initialPage = window.location.hash.slice(1)
  const [page, setPage] = useState(PAGE_META[initialPage] ? initialPage : 'chat')
  const [chatMode, setChatModeState] = useState(() => localStorage.getItem(STORAGE_KEYS.chatMode) || 'focus')
  const [query, setQuery] = useState('')
  const [mobileNav, setMobileNav] = useState(false)
  const [toast, setToast] = useState(null)
  const [modal, setModal] = useState(null)
  const [configSection, setConfigSection] = useState('models')
  const [pendingAsset, setPendingAsset] = useState(null)
  const [pluginStats, setPluginStats] = useState(null)
  const [startupReady, setStartupReady] = useState(false)
  const [notificationSettings, setNotificationSettings] = useState({ browser: { enabled: false }, templates: [] })
  const browserEventCursor = useRef('')
  const primaryActionRef = useRef(null)
  const queuedPrimaryActionRef = useRef(false)
  const searchInputRef = useRef(null)
  const toastTimer = useRef(null)
  const appDialog = useAppDialog()
  const [theme, setTheme] = useState(() => {
    const stored = localStorage.getItem(STORAGE_KEYS.theme)
    return THEME_SEQUENCE.includes(stored) ? stored : 'system'
  })

  useEffect(() => {
    const apply = () => { document.documentElement.dataset.theme = resolveDark(theme) ? 'dark' : 'light' }
    apply()
    if (theme === 'system') localStorage.removeItem(STORAGE_KEYS.theme)
    else localStorage.setItem(STORAGE_KEYS.theme, theme)
    if (theme !== 'system') return undefined
    const media = window.matchMedia('(prefers-color-scheme: dark)')
    media.addEventListener('change', apply)
    return () => media.removeEventListener('change', apply)
  }, [theme])

  const cycleTheme = () => setTheme((current) => THEME_SEQUENCE[(THEME_SEQUENCE.indexOf(current) + 1) % THEME_SEQUENCE.length])

  const refreshPluginStats = useCallback(async () => {
    try {
      const data = await apiJson('/api/plugins')
      setPluginStats({
        enabled: data.tools.filter((tool) => tool.enabled).length,
        total: data.tools.length,
      })
    } catch {
      // Keep the rest of the application usable if the plugin catalog is unavailable.
    }
  }, [])

  const setChatMode = (nextMode) => {
    setChatModeState(nextMode)
    localStorage.setItem(STORAGE_KEYS.chatMode, nextMode)
    if (nextMode === 'focus') setQuery('')
  }

  const notify = useCallback((message, tone = 'success') => {
    setToast({ message, tone })
    window.clearTimeout(toastTimer.current)
    toastTimer.current = window.setTimeout(() => setToast(null), 2800)
  }, [])

  useEffect(() => () => window.clearTimeout(toastTimer.current), [])

  const showBrowserNotification = useCallback((title, body, { force = false } = {}) => {
    if (!notificationSettings.browser?.enabled || !('Notification' in window) || window.Notification.permission !== 'granted') return
    if (!force && document.visibilityState === 'visible' && document.hasFocus()) return
    const item = new window.Notification(title, { body, tag: `vesper-${title}` })
    item.onclick = () => { window.focus(); item.close() }
  }, [notificationSettings.browser?.enabled])

  const browserNotify = useCallback((event, data, options) => {
    const template = notificationSettings.templates?.find((item) => item.id === event)
    const content = template?.channels?.browser?.content
    if (!template?.enabled || !content) return
    showBrowserNotification(template.name, renderNotificationContent(content, data), options)
  }, [notificationSettings.templates, showBrowserNotification])

  const registerPrimaryAction = useCallback((action) => {
    primaryActionRef.current = action
    if (queuedPrimaryActionRef.current) {
      queuedPrimaryActionRef.current = false
      action()
    }
    return () => { if (primaryActionRef.current === action) primaryActionRef.current = null }
  }, [])

  const invokePrimaryAction = useCallback(() => {
    if (primaryActionRef.current) primaryActionRef.current()
    else queuedPrimaryActionRef.current = true
  }, [])

  const navigate = useCallback((next) => {
    primaryActionRef.current = null
    setPage(next)
    window.location.hash = next
    setQuery('')
    setMobileNav(false)
  }, [])

  const handlePrimary = useCallback(() => {
    if (page === 'config' && configSection !== 'models') return
    if (['chat', 'config', 'assets', 'plugins', 'channels', 'schedules', 'memory'].includes(page)) invokePrimaryAction()
    else if (page === 'chatHistory') { navigate('chat'); invokePrimaryAction() }
    else if (page === 'workflows') navigate('workflowCreate')
    else if (page === 'workflowCreate') notify('工作流运行时尚未接入，当前不会真实发布', 'info')
    else if (page === 'mcp' || page === 'skills') notify('该页面当前为演示界面，功能尚未接入', 'info')
    else setModal(page)
  }, [configSection, invokePrimaryAction, navigate, notify, page])

  useEffect(() => {
    const focusSearch = () => {
      if (page === 'chat' && chatMode === 'focus') {
        navigate('chatHistory')
        requestAnimationFrame(() => requestAnimationFrame(() => searchInputRef.current?.focus()))
      } else searchInputRef.current?.focus()
    }
    const onKeyDown = (event) => {
      const modifier = event.metaKey || event.ctrlKey
      if (modifier && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        focusSearch()
      } else if (modifier && event.key.toLowerCase() === 'n' && !isEditableTarget(event.target)) {
        event.preventDefault()
        handlePrimary()
      } else if (event.key === '/' && !modifier && !event.altKey && !isEditableTarget(event.target)) {
        event.preventDefault()
        focusSearch()
      } else if (event.key === 'Escape' && !appDialog.dialog) {
        if (modal) setModal(null)
        else if (mobileNav) setMobileNav(false)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [appDialog.dialog, chatMode, handlePrimary, modal, mobileNav, navigate, page])

  useEffect(() => {
    let active = true
    apiJson('/api/config')
      .then((config) => {
        if (!active) return
        if (!hasUsableProvider(config)) {
          primaryActionRef.current = null
          queuedPrimaryActionRef.current = true
          setPage('config')
          window.location.hash = 'config'
        }
      })
      .catch(() => {})
      .finally(() => active && setStartupReady(true))
    return () => { active = false }
  }, [])

  useEffect(() => {
    const syncHash = () => {
      const next = window.location.hash.slice(1)
      if (PAGE_META[next]) {
        primaryActionRef.current = null
        setPage(next)
      }
    }
    window.addEventListener('hashchange', syncHash)
    return () => window.removeEventListener('hashchange', syncHash)
  }, [])

  useEffect(() => {
    refreshPluginStats()
  }, [refreshPluginStats])

  useEffect(() => {
    apiJson('/api/settings/notifications')
      .then(setNotificationSettings)
      .catch(() => {})
  }, [])

  useEffect(() => {
    let active = true
    const poll = async () => {
      try {
        const result = await apiJson(`/api/settings/notifications/browser/events?after=${encodeURIComponent(browserEventCursor.current)}`)
        if (!active) return
        for (const event of result.events || []) showBrowserNotification(event.title, event.body, { force: true })
        browserEventCursor.current = result.latestId || browserEventCursor.current
      } catch {}
    }
    poll()
    const timer = window.setInterval(poll, 3000)
    return () => { active = false; window.clearInterval(timer) }
  }, [showBrowserNotification])

  const activeMeta = page === 'chat' && chatMode === 'focus'
    ? ['对话', '聚集模式 · 单会话工作台']
    : PAGE_META[page]

  if (!startupReady) return <div className="app-startup"><BrandLogo size={30} className="startup-logo" /><strong>正在唤醒 Vesper…</strong></div>

  return (
    <div className="app-shell">
      <div className="app-body">
        <Sidebar page={page} navigate={navigate} setChatMode={setChatMode} open={mobileNav} onClose={() => setMobileNav(false)} pluginStats={pluginStats} />
        <main className="main-surface">
          <PageHeader
            meta={activeMeta}
            page={page}
            query={query}
            setQuery={setQuery}
            chatMode={chatMode}
            setChatMode={setChatMode}
            configSection={configSection}
            onMenu={() => setMobileNav(true)}
            onPrimary={handlePrimary}
            notify={notify}
            searchInputRef={searchInputRef}
            theme={theme}
            onCycleTheme={cycleTheme}
          />
          <div className={`page-content page-${page}`} key={page}>
            {page === 'chat' && <ChatPage mode={chatMode} setMode={setChatMode} query={query} notify={notify} browserNotify={browserNotify} registerPrimaryAction={registerPrimaryAction} pendingAsset={pendingAsset} onAssetConsumed={() => setPendingAsset(null)} requestText={appDialog.prompt} />}
            {page === 'chatHistory' && <ChatHistoryPage query={query} navigate={navigate} setChatMode={setChatMode} notify={notify} requestConfirm={appDialog.confirm} requestText={appDialog.prompt} />}
            {page === 'assets' && <Suspense fallback={<PageLoader />}><AssetsPage query={query} notify={notify} registerPrimaryAction={registerPrimaryAction} requestConfirm={appDialog.confirm} onUse={(asset) => { setPendingAsset(asset); setChatMode('focus'); navigate('chat') }} /></Suspense>}
            {page === 'channels' && <Suspense fallback={<PageLoader />}><ChannelsPage notify={notify} registerPrimaryAction={registerPrimaryAction} requestConfirm={appDialog.confirm} /></Suspense>}
            {page === 'schedules' && <Suspense fallback={<PageLoader />}><SchedulesPage notify={notify} registerPrimaryAction={registerPrimaryAction} requestConfirm={appDialog.confirm} openNotificationSettings={() => { setConfigSection('notifications'); navigate('config') }} /></Suspense>}
            {page === 'config' && <Suspense fallback={<PageLoader />}><ConfigPage notify={notify} registerPrimaryAction={registerPrimaryAction} section={configSection} setSection={setConfigSection} onBrowserNotificationChange={setNotificationSettings} requestConfirm={appDialog.confirm} /></Suspense>}
            {page === 'plugins' && <Suspense fallback={<PageLoader />}><PluginsPage query={query} notify={notify} registerPrimaryAction={registerPrimaryAction} onStatusChange={setPluginStats} /></Suspense>}
            {page === 'memory' && <Suspense fallback={<PageLoader />}><MemoryPage query={query} notify={notify} registerPrimaryAction={registerPrimaryAction} requestConfirm={appDialog.confirm} /></Suspense>}
            {page === 'mcp' && <Suspense fallback={<PageLoader />}><McpPage notify={notify} /></Suspense>}
            {page === 'skills' && <Suspense fallback={<PageLoader />}><SkillsPage notify={notify} /></Suspense>}
            {page === 'workflows' && <Suspense fallback={<PageLoader />}><WorkflowsPage navigate={navigate} notify={notify} /></Suspense>}
            {page === 'workflowCreate' && <Suspense fallback={<PageLoader />}><WorkflowBuilder notify={notify} /></Suspense>}
          </div>
        </main>
      </div>
      {toast && <Toast message={toast.message} tone={toast.tone} />}
      <AppDialog dialog={appDialog.dialog} onClose={appDialog.close} onFinish={appDialog.finish} />
      {modal && <QuickCreate type={modal} close={() => setModal(null)} notify={notify} />}
    </div>
  )
}

function PageLoader() {
  return <Panel className="empty-state"><RefreshCw className="spin" size={24} /><h2>正在加载页面</h2><p>按需加载功能模块…</p></Panel>
}

function Sidebar({ page, navigate, setChatMode, open, onClose, pluginStats }) {
  const [usage, setUsage] = useState(null)
  const [sessions, setSessions] = useState([])
  const [historyExpanded, setHistoryExpanded] = useState(false)
  const [activeSessionId, setActiveSessionId] = useState(() => localStorage.getItem(STORAGE_KEYS.activeSession) || '')
  const active = page === 'workflowCreate' ? 'workflows' : page === 'chatHistory' ? 'chat' : page

  const refreshUsage = useCallback(async () => {
    try { setUsage(await apiJson('/api/usage/today')) } catch {}
  }, [])

  const refreshSessions = useCallback(async () => {
    try {
      const data = await apiJson('/api/sessions')
      setSessions([...(data.sessions || [])].sort((a, b) => Date.parse(b.modified) - Date.parse(a.modified)))
    } catch {}
  }, [])

  useEffect(() => {
    refreshUsage()
    const timer = window.setInterval(refreshUsage, 15_000)
    const refreshWhenVisible = () => { if (document.visibilityState === 'visible') refreshUsage() }
    document.addEventListener('visibilitychange', refreshWhenVisible)
    window.addEventListener(USAGE_UPDATED_EVENT, refreshUsage)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', refreshWhenVisible)
      window.removeEventListener(USAGE_UPDATED_EVENT, refreshUsage)
    }
  }, [refreshUsage])

  useEffect(() => {
    refreshSessions()
    const timer = window.setInterval(refreshSessions, 20_000)
    const refreshWhenVisible = () => { if (document.visibilityState === 'visible') refreshSessions() }
    const syncActive = (event) => setActiveSessionId(event.detail?.id || localStorage.getItem(STORAGE_KEYS.activeSession) || '')
    document.addEventListener('visibilitychange', refreshWhenVisible)
    window.addEventListener(SESSIONS_UPDATED_EVENT, refreshSessions)
    window.addEventListener(SESSION_SELECTED_EVENT, syncActive)
    window.addEventListener(ACTIVE_SESSION_CHANGED_EVENT, syncActive)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', refreshWhenVisible)
      window.removeEventListener(SESSIONS_UPDATED_EVENT, refreshSessions)
      window.removeEventListener(SESSION_SELECTED_EVENT, syncActive)
      window.removeEventListener(ACTIVE_SESSION_CHANGED_EVENT, syncActive)
    }
  }, [refreshSessions])

  const openRecentSession = (id) => {
    setActiveSessionId(id)
    setChatMode('focus')
    requestSessionSelection(id)
    navigate('chat')
  }

  const usageTitle = usage
    ? `输入 ${usage.input.toLocaleString()} · 输出 ${usage.output.toLocaleString()} · 推理 ${usage.reasoning.toLocaleString()} · 缓存读取 ${usage.cacheRead.toLocaleString()}`
    : '正在统计今日 Token 消耗'

  return (
    <>
      {open && <button className="nav-scrim" aria-label="关闭导航" onClick={onClose} />}
      <aside className={`sidebar ${open ? 'is-open' : ''}`}>
        <div className="brand"><BrandLogo size={22} /><strong>{APP_NAME}</strong><button className="mobile-close" onClick={onClose}><X size={18} /></button></div>
        <nav className="nav-list" aria-label="主导航">
          {NAV_GROUPS.map(([group, items]) => (
            <div className="nav-group" key={group}>
              <span className="nav-group-label">{group}</span>
              {items.map(([id, label, Icon]) => id === 'chat' ? (
                <div className={`nav-chat-block ${historyExpanded ? 'is-expanded' : ''}`} key={id}>
                  <div className="nav-chat-entry">
                    <button className={`nav-main nav-chat-main ${active === id ? 'active' : ''}`} onClick={() => navigate(id)}><Icon size={16} /><span>{label}</span></button>
                    <button className="nav-history-toggle" title={historyExpanded ? '收起最近会话' : '展开最近会话'} aria-label={historyExpanded ? '收起最近会话' : '展开最近会话'} aria-expanded={historyExpanded} onClick={() => setHistoryExpanded((value) => !value)}><ChevronDown className={historyExpanded ? 'is-open' : ''} size={14} /></button>
                  </div>
                  {historyExpanded && <div className="nav-history-preview">
                    {sessions.slice(0, 4).map((session) => <button className={`nav-history-item ${session.id === activeSessionId ? 'active-session' : ''}`} title={session.name || '未命名会话'} onClick={() => openRecentSession(session.id)} key={session.id}><span>{session.name || '未命名会话'}</span><small>{relativeTime(session.modified)}</small></button>)}
                    {!sessions.length && <span className="nav-history-empty">暂无历史会话</span>}
                    <button className="nav-history-all" onClick={() => navigate('chatHistory')}><span>查看全部{sessions.length ? ` · ${sessions.length}` : ''}</span><ChevronRight size={12} /></button>
                  </div>}
                </div>
              ) : (
                <button className={`nav-main ${active === id ? 'active' : ''}`} key={id} onClick={() => navigate(id)}><Icon size={16} /><span>{label}</span></button>
              ))}
            </div>
          ))}
        </nav>
        <div className="sidebar-status">
          <span>{['skills', 'mcp', 'workflows', 'workflowCreate'].includes(page) ? '功能状态' : page === 'plugins' ? '插件状态' : '运行状态'}</span>
          <b>{['skills', 'mcp', 'workflows', 'workflowCreate'].includes(page) ? <>演示页面 <em className="amber">尚未接入</em></> : page === 'plugins' ? `已启用 ${pluginStats?.enabled ?? '—'} / ${pluginStats?.total ?? '—'}` : <>今日 tokens <em title={usageTitle}>{usage ? formatTokenCount(usage.totalTokens) : '—'}</em></>}</b>
        </div>
      </aside>
    </>
  )
}

function PageHeader({ meta, page, query, setQuery, chatMode, setChatMode, configSection, onMenu, onPrimary, notify, theme, onCycleTheme, searchInputRef }) {
  const primary = page === 'config' && configSection !== 'models' ? null : ({
    chat: ['新会话', Plus], chatHistory: ['新会话', Plus], assets: ['添加链接', Link2], channels: ['连接渠道', Plus], schedules: ['新建任务', Plus],
    config: ['添加 Provider', Plus], plugins: ['保存策略', Save], memory: ['新建节点', Plus], mcp: ['添加服务', Plus],
    skills: ['安装技能', Plus], workflows: ['新建工作流', Plus], workflowCreate: ['发布', Rocket],
  }[page])
  const PrimaryIcon = primary?.[1]
  const [themeLabel, ThemeIcon] = THEME_META[theme] || THEME_META.system
  return (
    <header className="page-header">
      <button className="mobile-menu" onClick={onMenu}><Menu size={19} /></button>
      <div className="title-block"><h1>{meta[0]}</h1><p>{meta[1]}</p></div>
      <div className="header-actions">
        {page === 'chat' && <Segmented options={['平铺', '聚集']} value={chatMode === 'grid' ? '平铺' : '聚集'} onChange={(v) => setChatMode(v === '平铺' ? 'grid' : 'focus')} compact />}
        {page === 'workflowCreate' ? (
          <>
            <button className="button secondary" onClick={() => notify('当前为演示编辑器，草稿不会持久化', 'info')}><Save size={15} />保存草稿</button>
            <button className="button dark" onClick={() => notify('工作流运行时尚未接入，无法试运行', 'info')}><Play size={15} />试运行</button>
          </>
        ) : page === 'chat' && chatMode === 'focus' ? null : (
          <label className="search-box" title="搜索（Ctrl/⌘ K 或 /）"><Search size={15} /><input ref={searchInputRef} value={query} onChange={(e) => setQuery(e.target.value)} placeholder={page === 'chat' ? '搜索平铺会话' : page === 'mcp' ? '搜索服务或工具' : page === 'memory' ? '搜索节点或文件' : `搜索${meta[0]}`} /></label>
        )}
        {primary && <button className="button primary" title={`${primary[0]}（Ctrl/⌘ N）`} onClick={onPrimary}><PrimaryIcon size={15} />{primary[0]}</button>}
        <button className="icon-button theme-toggle" title={`主题：${themeLabel}（点击切换）`} aria-label={`主题：${themeLabel}，点击切换主题`} onClick={onCycleTheme}><ThemeIcon size={16} /></button>
      </div>
    </header>
  )
}

function ChatPage({ mode, setMode, query, notify, browserNotify, registerPrimaryAction, pendingAsset, onAssetConsumed, requestText }) {
  const [remoteSessions, setRemoteSessions] = useState([])
  const [activeId, setActiveId] = useState(() => localStorage.getItem(STORAGE_KEYS.activeSession) || '')
  const [sessionStates, setSessionStates] = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [model, setModel] = useState('等待配置')
  const [availableModels, setAvailableModels] = useState([])
  const [workspaceSession, setWorkspaceSession] = useState(null)
  const [tiledSessionIds, setTiledSessionIds] = useState(() => readStoredArray(STORAGE_KEYS.tiledSessions))
  const tiledStorageWasEmpty = useRef(localStorage.getItem(STORAGE_KEYS.tiledSessions) === null)
  const sessionStatesRef = useRef(sessionStates)

  useEffect(() => {
    sessionStatesRef.current = sessionStates
  }, [sessionStates])

  const updateSessionState = useCallback((id, update) => {
    if (!id) return
    const current = sessionStatesRef.current
    const previous = current[id] || { messages: [], tools: [], approvals: [], streaming: false, error: '', loaded: false, messageStart: null, hasOlder: false, olderCursor: null }
    const next = typeof update === 'function' ? update(previous) : { ...previous, ...update }
    const states = { ...current, [id]: next }
    sessionStatesRef.current = states
    setSessionStates(states)
  }, [])

  const syncLiveSession = useCallback(async (id) => {
    if (!id) return
    try {
      const data = await apiJson(`/api/sessions/${encodeURIComponent(id)}/live`)
      updateSessionState(id, (current) => ({
        ...current,
        ...latestPageState(current, data),
        tools: data.tools || [],
        streaming: data.streaming,
        recovering: data.streaming,
        loaded: true,
        loading: false,
        error: data.error || '',
        model: data.model || current.model,
        cwd: data.cwd || current.cwd,
        permissionMode: data.permissionMode || current.permissionMode,
        approvals: data.approvals || [],
      }))
      setRemoteSessions((current) => current.map((session) => session.id === id ? { ...session, streaming: data.streaming, model: data.model || session.model, cwd: data.cwd || session.cwd, permissionMode: data.permissionMode || session.permissionMode } : session))
    } catch (caught) {
      updateSessionState(id, { recovering: false, loading: false, error: caught.message })
    }
  }, [updateSessionState])

  const loadSessionMessages = useCallback(async (id, { force = false, limit = FOCUS_MESSAGE_PAGE_SIZE } = {}) => {
    if (!id) return
    const current = sessionStatesRef.current[id]
    if (current?.recovering) { await syncLiveSession(id); return }
    if (!force && (current?.loading || current?.streaming || (current?.loaded && (current.pageSize || 0) >= limit))) return
    updateSessionState(id, { loading: true })
    try {
      const data = await apiJson(`/api/sessions/${encodeURIComponent(id)}/messages?limit=${limit}`)
      updateSessionState(id, (latest) => latest.streaming
        ? { ...latest, loaded: true, loading: false, pageSize: Math.max(latest.pageSize || 0, limit) }
        : { ...latest, ...latestPageState(latest, data), loaded: true, loading: false, pageSize: Math.max(latest.pageSize || 0, limit), error: '', olderError: '' })
    } catch (caught) {
      updateSessionState(id, { loading: false, error: caught.message })
    }
  }, [syncLiveSession, updateSessionState])

  const loadOlderMessages = useCallback(async (id) => {
    const current = sessionStatesRef.current[id]
    if (!id || !current?.hasOlder || !current.olderCursor || current.loadingOlder) return false
    updateSessionState(id, { loadingOlder: true, olderError: '' })
    try {
      const data = await apiJson(`/api/sessions/${encodeURIComponent(id)}/messages?limit=${FOCUS_MESSAGE_PAGE_SIZE}&before=${encodeURIComponent(current.olderCursor)}`)
      updateSessionState(id, (latest) => {
        const existingIds = new Set(latest.messages.map((message) => message.id))
        const older = data.messages.filter((message) => !existingIds.has(message.id))
        return {
          ...latest,
          messages: [...older, ...latest.messages],
          messageStart: data.pageInfo.start,
          hasOlder: data.pageInfo.hasMore,
          olderCursor: data.pageInfo.nextCursor,
          loadingOlder: false,
          olderError: '',
        }
      })
      return data.messages.length > 0
    } catch (caught) {
      updateSessionState(id, { loadingOlder: false, olderError: caught.message })
      return false
    }
  }, [updateSessionState])

  useEffect(() => {
    const selectSession = (event) => {
      const id = event.detail?.id
      if (!id) return
      setActiveId(id)
      setMode('focus')
    }
    window.addEventListener(SESSION_SELECTED_EVENT, selectSession)
    return () => window.removeEventListener(SESSION_SELECTED_EVENT, selectSession)
  }, [setMode])

  useEffect(() => {
    if (activeId) localStorage.setItem(STORAGE_KEYS.activeSession, activeId)
    announceActiveSession(activeId)
  }, [activeId])

  useEffect(() => {
    localStorage.setItem(STORAGE_KEYS.tiledSessions, JSON.stringify(tiledSessionIds))
  }, [tiledSessionIds])

  const refreshSessions = async (preferredId) => {
    const data = await apiJson('/api/sessions')
    setRemoteSessions(data.sessions)
    if (preferredId) setActiveId(preferredId)
    else setActiveId((current) => data.sessions.some((session) => session.id === current) ? current : (data.sessions[0]?.id || ''))
    announceSessionsUpdated()
    return data.sessions
  }

  const createSession = async () => {
    try {
      setError('')
      const created = await apiJson('/api/sessions', { method: 'POST', body: JSON.stringify({ name: '新会话' }) })
      setActiveId(created.id)
      updateSessionState(created.id, { messages: [], tools: [], approvals: [], permissionMode: created.permissionMode || 'auto', streaming: false, error: '', loaded: true, pageSize: FOCUS_MESSAGE_PAGE_SIZE, messageStart: 0, hasOlder: false, olderCursor: null })
      setTiledSessionIds((current) => current.includes(created.id) ? current : [...current, created.id])
      setMode('focus')
      await refreshSessions(created.id)
      notify('新会话已创建')
      return created.id
    } catch (caught) {
      setError(caught.message)
      return ''
    }
  }
  usePagePrimaryAction(registerPrimaryAction, createSession)

  useEffect(() => {
    let active = true
    Promise.all([apiJson('/api/sessions'), apiJson('/api/config')])
      .then(async ([sessionData, configData]) => {
        if (!active) return
        setModel(configData.model ? `${configData.provider}/${configData.model}` : '未配置模型')
        setAvailableModels(configData.providers.flatMap((provider) => provider.configured && provider.enabled
          ? provider.models.filter((item) => item.kind === 'chat').map((item) => ({
              key: `${provider.id}/${item.id}`,
              provider: provider.id,
              modelId: item.id,
              label: item.name || item.id,
              providerName: provider.name || provider.id,
            }))
          : []))
        let list = sessionData.sessions
        if (!list.length) {
          const created = await apiJson('/api/sessions', { method: 'POST', body: JSON.stringify({ name: '新会话' }) })
          list = [created]
        }
        if (!active) return
        setRemoteSessions(list)
        announceSessionsUpdated()
        for (const session of list) {
          if (session.streaming) updateSessionState(session.id, { streaming: true, recovering: true, loaded: false, error: '' })
        }
        const storedId = localStorage.getItem(STORAGE_KEYS.activeSession)
        setActiveId(list.some((session) => session.id === storedId) ? storedId : (list[0]?.id || ''))
        setTiledSessionIds((current) => {
          const valid = current.filter((id) => list.some((session) => session.id === id))
          if (tiledStorageWasEmpty.current) {
            tiledStorageWasEmpty.current = false
            return list.slice(0, 4).map((session) => session.id)
          }
          return valid
        })
      })
      .catch((caught) => active && setError(caught.message))
      .finally(() => active && setLoading(false))
    return () => { active = false }
  }, [updateSessionState])

  useEffect(() => {
    loadSessionMessages(activeId, { limit: FOCUS_MESSAGE_PAGE_SIZE })
  }, [activeId, loadSessionMessages])

  useEffect(() => {
    for (const id of tiledSessionIds) loadSessionMessages(id, { limit: GRID_MESSAGE_PAGE_SIZE })
  }, [tiledSessionIds, loadSessionMessages])

  useEffect(() => {
    let active = true
    const poll = () => {
      if (!active) return
      for (const [id, state] of Object.entries(sessionStatesRef.current)) if (state.recovering) void syncLiveSession(id)
    }
    poll()
    const timer = window.setInterval(poll, 800)
    return () => { active = false; window.clearInterval(timer) }
  }, [syncLiveSession])

  const sendPrompt = async (text, requestedSessionId = activeId, attachments = []) => {
    const prompt = text.trim() || (attachments.length ? '请分析这些附件。' : '')
    if (!prompt) return
    let sessionId = requestedSessionId
    if (!sessionId) sessionId = await createSession()
    if (!sessionId) return
    if (sessionStatesRef.current[sessionId]?.streaming) return
    setActiveId(sessionId)
    setError('')
    const userMessage = { id: `user-${Date.now()}`, role: 'user', text: prompt, attachments: attachments.map(({ id, kind, name, mimeType, size, data }) => ({ id, kind, name, mimeType, size, data: kind === 'image' ? data : undefined })) }
    const agentId = `agent-${Date.now()}`
    let responseText = ''
    updateSessionState(sessionId, (current) => ({ ...current, messages: [...current.messages, userMessage, { id: agentId, role: 'agent', text: '', streaming: true }], tools: [], approvals: [], error: '', streaming: true, loaded: true }))
    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, message: prompt, attachments }),
      })
      await consumeEventStream(response, (event, data) => {
        if (event === 'meta') {
          setModel(data.model)
          updateSessionState(sessionId, { model: data.model, cwd: data.cwd, permissionMode: data.permissionMode })
          if (data.cwd || data.permissionMode) setRemoteSessions((current) => current.map((session) => session.id === sessionId ? { ...session, cwd: data.cwd || session.cwd, permissionMode: data.permissionMode || session.permissionMode } : session))
        } else if (event === 'text_delta') {
          responseText += data.delta || ''
          updateSessionState(sessionId, (current) => ({ ...current, messages: current.messages.map((item) => item.id === agentId ? { ...item, text: item.text + data.delta } : item) }))
        } else if (event === 'tool_start') {
          updateSessionState(sessionId, (current) => ({ ...current, tools: [...current.tools, { id: data.id, name: data.name, status: 'running' }] }))
        } else if (event === 'tool_end') {
          updateSessionState(sessionId, (current) => ({
            ...current,
            error: data.error ? data.message || `${data.name} 执行失败` : current.error,
            tools: current.tools.map((item) => item.id === data.id ? { ...item, status: data.error ? 'error' : 'done', message: data.message || '' } : item),
          }))
        } else if (event === 'permission_request') {
          updateSessionState(sessionId, (current) => ({ ...current, approvals: [...(current.approvals || []).filter((item) => item.id !== data.id), data] }))
        } else if (event === 'permission_resolved') {
          updateSessionState(sessionId, (current) => ({ ...current, approvals: (current.approvals || []).filter((item) => item.id !== data.id) }))
        } else if (event === 'generated_asset') {
          updateSessionState(sessionId, (current) => ({
            ...current,
            messages: current.messages.map((item) => item.id === agentId
              ? { ...item, attachments: [...(item.attachments || []).filter((attachment) => attachment.id !== data.id), data] }
              : item),
          }))
        } else if (event === 'session_title') {
          setRemoteSessions((current) => current.map((session) => session.id === sessionId ? { ...session, name: data.name } : session))
        } else if (event === 'retry') {
          updateSessionState(sessionId, { error: `正在重试 ${data.attempt}/${data.maxAttempts}：${data.message}` })
        } else if (event === 'error') {
          throw new Error(data.message)
        }
      })
      updateSessionState(sessionId, (current) => ({ ...current, messages: current.messages.map((item) => item.id === agentId ? { ...item, streaming: false } : item) }))
      const sessions = await refreshSessions()
      const completed = sessions.find((session) => session.id === sessionId)
      browserNotify?.('chat.completed', { chat: { title: completed?.name || `${APP_NAME} 对话`, summary: responseText.trim().slice(0, 260) || 'Agent 已完成回复。', model: sessionStatesRef.current[sessionId]?.model || model } })
    } catch (caught) {
      updateSessionState(sessionId, (current) => ({ ...current, error: caught.message, messages: current.messages.map((item) => item.id === agentId ? { ...item, streaming: false, error: caught.message, text: item.text || caught.message } : item) }))
    } finally {
      updateSessionState(sessionId, { streaming: false })
      window.dispatchEvent(new Event(USAGE_UPDATED_EVENT))
    }
  }

  const abort = async (sessionId = activeId) => {
    if (!sessionId) return
    await apiJson(`/api/sessions/${encodeURIComponent(sessionId)}/abort`, { method: 'POST', body: '{}' })
    updateSessionState(sessionId, { streaming: false })
    notify('已停止当前运行', 'info')
  }

  const switchSessionModel = async (sessionId, nextModel) => {
    const selected = availableModels.find((item) => item.key === nextModel)
    if (!sessionId || !selected || sessionStatesRef.current[sessionId]?.streaming) return
    updateSessionState(sessionId, { switchingModel: true, error: '' })
    try {
      const updated = await apiJson(`/api/sessions/${encodeURIComponent(sessionId)}/model`, {
        method: 'PUT',
        body: JSON.stringify({ provider: selected.provider, model: selected.modelId }),
      })
      updateSessionState(sessionId, { model: updated.model, switchingModel: false })
      setRemoteSessions((current) => current.map((session) => session.id === sessionId ? { ...session, model: updated.model } : session))
      notify(`已切换至 ${selected.label}`)
    } catch (caught) {
      updateSessionState(sessionId, { switchingModel: false, error: caught.message })
    }
  }

  const switchSessionPermission = async (sessionId, permissionMode) => {
    if (!sessionId) return
    updateSessionState(sessionId, { switchingPermission: true, error: '' })
    try {
      const updated = await apiJson(`/api/sessions/${encodeURIComponent(sessionId)}/permission`, {
        method: 'PUT', body: JSON.stringify({ mode: permissionMode }),
      })
      updateSessionState(sessionId, { permissionMode: updated.permissionMode, switchingPermission: false })
      setRemoteSessions((current) => current.map((session) => session.id === sessionId ? { ...session, permissionMode: updated.permissionMode } : session))
      notify(`权限模式已切换为${updated.permissionMode === 'ask' ? '询问' : updated.permissionMode === 'ignore' ? '忽略' : '自动'}`)
    } catch (caught) {
      updateSessionState(sessionId, { switchingPermission: false, error: caught.message })
    }
  }

  const resolveToolApproval = async (sessionId, approvalId, approved) => {
    try {
      await apiJson(`/api/sessions/${encodeURIComponent(sessionId)}/approvals/${encodeURIComponent(approvalId)}`, {
        method: 'POST', body: JSON.stringify({ approved }),
      })
      updateSessionState(sessionId, (current) => ({ ...current, approvals: (current.approvals || []).filter((item) => item.id !== approvalId) }))
    } catch (caught) {
      updateSessionState(sessionId, { error: caught.message })
      throw caught
    }
  }

  const switchSessionCwd = async (session, cwd) => {
    if (!session?.id || sessionStatesRef.current[session.id]?.streaming) return
    updateSessionState(session.id, { switchingCwd: true, error: '' })
    try {
      const updated = await apiJson(`/api/sessions/${encodeURIComponent(session.id)}/cwd`, {
        method: 'PUT',
        body: JSON.stringify({ cwd }),
      })
      updateSessionState(session.id, { cwd: updated.cwd, switchingCwd: false })
      setRemoteSessions((current) => current.map((item) => item.id === session.id ? { ...item, cwd: updated.cwd } : item))
      setWorkspaceSession(null)
      notify(`工作目录已切换至 ${workspaceName(updated.cwd)}`)
    } catch (caught) {
      updateSessionState(session.id, { switchingCwd: false, error: caught.message })
      throw caught
    }
  }

  const renameSession = async (session) => {
    const name = await requestText({ title: '重命名会话', inputLabel: '会话标题', value: session.name, confirmLabel: '保存' })
    if (name === null || name === session.name) return
    try {
      const updated = await apiJson(`/api/sessions/${encodeURIComponent(session.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ name }),
      })
      setRemoteSessions((current) => current.map((item) => item.id === session.id ? { ...item, name: updated.name } : item))
      announceSessionsUpdated()
      notify('会话标题已更新')
    } catch (caught) {
      setError(caught.message)
    }
  }

  const visible = useMemo(() => remoteSessions.filter((session) =>
    tiledSessionIds.includes(session.id) && `${session.name} ${session.firstMessage}`.toLowerCase().includes(query.toLowerCase()),
  ), [remoteSessions, query, tiledSessionIds])
  const activeSession = remoteSessions.find((session) => session.id === activeId)
  const activeState = sessionStates[activeId] || { messages: [], tools: [], approvals: [], streaming: false, error: '', loading: false, switchingModel: false, switchingCwd: false, switchingPermission: false, messageStart: null, hasOlder: false, olderCursor: null }

  useEffect(() => {
    document.title = activeSession?.name ? `${activeSession.name} · ${APP_NAME}` : APP_NAME
    return () => { document.title = APP_NAME }
  }, [activeSession?.name])

  return (
    <>
    <div className={`chat-layout mode-${mode}`}>
      {loading ? <Panel className="empty-state"><RefreshCw className="spin" size={24} /><h2>正在启动 Agent</h2><p>加载模型目录与历史会话…</p></Panel> : mode === 'grid' ? (
        <div className="session-grid">
          {visible.length ? visible.map((session) => <SessionCard key={session.id} session={session} state={sessionStates[session.id]} model={sessionStates[session.id]?.model || session.model || model} permissionMode={sessionStates[session.id]?.permissionMode || session.permissionMode || 'auto'} availableModels={availableModels} onModelChange={(nextModel) => switchSessionModel(session.id, nextModel)} onPermissionChange={(nextMode) => switchSessionPermission(session.id, nextMode)} onApproval={(approvalId, approved) => resolveToolApproval(session.id, approvalId, approved)} onWorkspace={() => setWorkspaceSession(session)} onOpen={() => { setActiveId(session.id); setMode('focus') }} onRename={() => renameSession(session)} onSend={(value, attachments) => sendPrompt(value, session.id, attachments)} onAbort={() => abort(session.id)} />) : <TiledEmptyState hasQuery={Boolean(query)} />}
        </div>
      ) : <FocusSession session={activeSession} messages={activeState.messages} messageStart={activeState.messageStart} hasOlder={activeState.hasOlder} loadingOlder={activeState.loadingOlder} olderError={activeState.olderError} model={activeState.model || activeSession?.model || model} permissionMode={activeState.permissionMode || activeSession?.permissionMode || 'auto'} cwd={activeState.cwd || activeSession?.cwd} availableModels={availableModels} switchingModel={activeState.switchingModel} switchingCwd={activeState.switchingCwd} switchingPermission={activeState.switchingPermission} streaming={activeState.streaming} tools={activeState.tools} approvals={activeState.approvals || []} error={activeState.error || error} pendingAsset={pendingAsset} onAssetConsumed={onAssetConsumed} onLoadOlder={() => loadOlderMessages(activeId)} onModelChange={(nextModel) => switchSessionModel(activeId, nextModel)} onPermissionChange={(nextMode) => switchSessionPermission(activeId, nextMode)} onApproval={(approvalId, approved) => resolveToolApproval(activeId, approvalId, approved)} onWorkspace={() => activeSession && setWorkspaceSession(activeSession)} onRename={() => activeSession && renameSession(activeSession)} onSend={sendPrompt} onAbort={() => abort(activeId)} />}
    </div>
    {workspaceSession && <WorkspacePicker session={workspaceSession} onClose={() => setWorkspaceSession(null)} onSelect={(cwd) => switchSessionCwd(workspaceSession, cwd)} />}
    </>
  )
}

function SessionCard({ session, state, model, permissionMode, availableModels, onModelChange, onPermissionChange, onApproval, onWorkspace, onOpen, onRename, onSend, onAbort }) {
  const [value, setValue] = useState('')
  const selection = useAttachmentSelection()
  const messages = (state?.messages || EMPTY_LIST).slice(-GRID_MESSAGE_PAGE_SIZE)
  const tools = state?.tools || EMPTY_LIST
  const streaming = Boolean(state?.streaming)
  const lastMessage = messages[messages.length - 1]
  const liveVersion = `${session.id}:${lastMessage?.id || ''}:${lastMessage?.text?.length || 0}:${lastMessage?.attachments?.length || 0}:${tools.map((tool) => `${tool.id}:${tool.status}`).join('|')}:${state?.error || ''}`
  const { scrollRef: liveRef, onScroll: onLiveScroll, scrollToBottom } = useAutoScroll(liveVersion)
  const submit = (event) => {
    event.preventDefault()
    if ((!value.trim() && !selection.attachments.length) || streaming) return
    onSend(value, selection.attachments)
    scrollToBottom('smooth')
    setValue('')
    selection.clearAttachments()
  }
  return (
    <Panel className="session-card">
      <div className="card-head"><button className="session-title-button" onClick={onOpen}><h3 title={session.name}>{session.name}</h3><span className={streaming ? 'success' : ''}>{streaming ? 'Agent 运行中' : `${session.messageCount || messages.length} 条消息`} · {relativeTime(session.modified)}</span><small className="workspace-summary" title={state?.cwd || session.cwd}><FolderOpen size={10} />{workspaceName(state?.cwd || session.cwd)}</small></button><div className="card-head-actions"><button className="icon-button" title="设置工作目录" onClick={onWorkspace} disabled={streaming || state?.switchingCwd}><FolderOpen size={14} /></button><button className="icon-button" title="重命名会话" onClick={onRename}><Pencil size={14} /></button>{streaming ? <button className="button danger tiny" onClick={onAbort}><Square size={11} />停止</button> : <button className="icon-button" onClick={onOpen}><MoreHorizontal size={17} /></button>}</div></div>
      <div className="session-live-body" ref={liveRef} onScroll={onLiveScroll}>
        {state?.loading && !messages.length ? <div className="session-live-empty"><RefreshCw className="spin" size={16} />加载消息…</div> : !messages.length ? <button className="session-live-empty" onClick={onOpen}><Bot size={17} />开始一个新的编码任务</button> : messages.map((message) => <div className={`mini-message ${message.role}`} key={message.id}><span>{message.role === 'agent' ? 'Vesper' : 'You'}</span><div className="mini-message-content"><MarkdownMessage>{message.text || (message.streaming ? '正在思考…' : '')}</MarkdownMessage>{message.attachments?.length > 0 && <MessageAttachments attachments={message.attachments} compact />}</div></div>)}
        {tools.some((tool) => tool.status === 'running') && <div className="mini-tool-status"><Wrench size={11} />{tools.filter((tool) => tool.status === 'running').map((tool) => tool.name).join('、')} 运行中</div>}
        {state?.error && <div className="mini-session-error"><AlertTriangle size={11} />{state.error}</div>}
      </div>
      <form className="mini-composer-shell" onSubmit={submit}>
        <ToolApproval approvals={state?.approvals || EMPTY_LIST} onResolve={onApproval} compact />
        <AttachmentTray attachments={selection.attachments} onRemove={selection.removeAttachment} compact />
        {selection.attachmentError && <span className="attachment-error">{selection.attachmentError}</span>}
        <div className="mini-composer"><button type="button" className="attach-trigger" title="添加附件" aria-label="添加附件" onClick={() => selection.inputRef.current?.click()} disabled={streaming}><Paperclip size={14} />{selection.attachments.length > 0 && <i>{selection.attachments.length}</i>}</button><input ref={selection.inputRef} className="sr-only" type="file" multiple accept="image/*,.txt,.md,.json,.js,.jsx,.ts,.tsx,.css,.html,.xml,.yaml,.yml,.csv,.log,.py,.java,.go,.rs,.sh,.ps1,.toml,.sql,.pdf,.docx,.pptx,.xlsx,.odt,.odp,.ods,.rtf,.epub" onChange={selection.chooseFiles} /><input value={value} onChange={(event) => setValue(event.target.value)} placeholder={streaming ? 'Agent 正在运行…' : '输入 prompt 或添加附件...'} disabled={streaming} /><SessionModelSelect value={model} models={availableModels} onChange={onModelChange} disabled={streaming || state?.switchingModel} compact /><PermissionModeSelect value={permissionMode} onChange={onPermissionChange} disabled={state?.switchingPermission} compact />{streaming ? <button type="button" className="send-mini stop" title="停止运行" aria-label="停止运行" onClick={onAbort}><Square size={12} /></button> : <button className="send-mini" title="发送消息" aria-label="发送消息" disabled={!value.trim() && !selection.attachments.length}><Send size={13} /></button>}</div>
      </form>
    </Panel>
  )
}

function SessionModelSelect({ value, models, onChange, disabled, compact = false }) {
  const currentModel = models.find((model) => model.key === value)
  const hasCurrentModel = Boolean(currentModel)
  const currentLabel = currentModel ? `${currentModel.providerName} · ${currentModel.label}` : value.split('/').at(-1)
  return (
    <label className={`session-model-select icon-only ${compact ? 'compact' : ''}`} title={disabled ? `当前模型：${currentLabel}（运行期间不可切换）` : `当前模型：${currentLabel}，点击切换`}>
      <Bot size={compact ? 11 : 14} />
      <select value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled || models.length === 0} aria-label="当前会话模型">
        {!hasCurrentModel && <option value={value}>{value.split('/').at(-1)}</option>}
        {models.map((model) => <option key={model.key} value={model.key}>{model.providerName} · {model.label}</option>)}
      </select>
    </label>
  )
}

const WELCOME_CHIPS = [
  { label: '解释代码', prompt: '解释这段代码的工作原理：' },
  { label: '写单测', prompt: '为以下代码编写单元测试：' },
  { label: '重构', prompt: '重构这段代码并说明改进点：' },
  { label: '查 bug', prompt: '帮我定位并修复这个 bug：' },
]

const PERMISSION_OPTIONS = [
  ['ask', '询问', '敏感工具执行前需要确认'],
  ['auto', '自动', '自动执行，危险操作仍会询问'],
  ['ignore', '忽略', '跳过额外审批，仅受已启用工具限制'],
]

function PermissionModeSelect({ value, onChange, disabled, compact = false }) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef(null)
  const current = PERMISSION_OPTIONS.find((item) => item[0] === value) || PERMISSION_OPTIONS[1]
  useEffect(() => {
    if (!open) return undefined
    const close = (event) => { if (!rootRef.current?.contains(event.target)) setOpen(false) }
    const escape = (event) => { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', escape) }
  }, [open])
  return <div ref={rootRef} className={`permission-mode-select icon-only ${compact ? 'compact' : ''} ${open ? 'open' : ''}`}><button type="button" className={`permission-mode-trigger icon-only mode-${current[0]}`} title={`权限模式：${current[1]}——${current[2]}`} disabled={disabled} aria-haspopup="menu" aria-expanded={open} aria-label={`权限模式：${current[1]}`} onClick={() => setOpen((visible) => !visible)}><ShieldCheck size={compact ? 11 : 14} /></button>{open && <div className="permission-mode-menu" role="menu">{PERMISSION_OPTIONS.map(([mode, label, description]) => <button type="button" role="menuitemradio" aria-checked={mode === current[0]} className={mode === current[0] ? 'active' : ''} onClick={() => { onChange(mode); setOpen(false) }} key={mode}><span className={`permission-level level-${mode}`}><ShieldCheck size={13} /></span><span><strong>{label}</strong><small>{description}</small></span>{mode === current[0] && <Check size={13} />}</button>)}</div>}</div>
}

function ToolApproval({ approvals, onResolve, compact = false }) {
  const [resolving, setResolving] = useState(false)
  const approval = approvals[0]
  if (!approval) return null
  const resolve = async (approved) => {
    setResolving(true)
    try { await onResolve(approval.id, approved) } finally { setResolving(false) }
  }
  return <div className={`tool-approval ${compact ? 'compact' : ''}`}><div><ShieldCheck size={compact ? 12 : 15} /><span><strong>{approval.toolName} 请求授权</strong><small>{approval.reason}{approvals.length > 1 ? ` · 另有 ${approvals.length - 1} 项等待` : ''}</small></span></div>{!compact && <details><summary>查看调用参数</summary><pre>{JSON.stringify(approval.args, null, 2)}</pre></details>}<div className="tool-approval-actions"><button type="button" className="button secondary" disabled={resolving} onClick={() => resolve(false)}>拒绝</button><button type="button" className="button primary" disabled={resolving} onClick={() => resolve(true)}>{resolving ? <RefreshCw className="spin" size={12} /> : <Check size={12} />}允许</button></div></div>
}

function WorkspacePicker({ session, onClose, onSelect }) {
  const [path, setPath] = useState(session.cwd || '')
  const [listing, setListing] = useState(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const browse = useCallback(async (target) => {
    setLoading(true)
    setError('')
    try {
      const data = await apiJson(`/api/directories?path=${encodeURIComponent(target || '')}`)
      setPath(data.path)
      setListing(data)
    } catch (caught) {
      setError(caught.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    browse(session.cwd || '')
  }, [browse, session.cwd])

  const choose = async () => {
    setSaving(true)
    setError('')
    try {
      await onSelect(path)
    } catch (caught) {
      setError(caught.message)
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section className="modal workspace-modal" role="dialog" aria-modal="true" aria-label="设置会话工作目录">
        <div className="card-head"><div><h2>设置工作目录</h2><p>{session.name} 的工具和 Agent 将在此目录运行</p></div><button className="icon-button" onClick={onClose}><X size={17} /></button></div>
        <form className="workspace-path-form" onSubmit={(event) => { event.preventDefault(); browse(path) }}>
          <FolderOpen size={15} />
          <input value={path} onChange={(event) => setPath(event.target.value)} placeholder="输入项目的绝对路径" autoFocus />
          <button className="button secondary" disabled={loading}>{loading ? <RefreshCw className="spin" size={13} /> : '转到'}</button>
        </form>
        <div className="directory-browser">
          {listing?.parent && <button onClick={() => browse(listing.parent)}><FolderOpen size={14} /><span>..</span><small>上级目录</small></button>}
          {listing?.directories.map((directory) => <button key={directory.path} onClick={() => browse(directory.path)}><FolderOpen size={14} /><span>{directory.name}</span><ChevronRight size={13} /></button>)}
          {!loading && listing && !listing.directories.length && <div className="directory-empty">此目录没有子文件夹</div>}
          {loading && <div className="directory-empty"><RefreshCw className="spin" size={16} />正在读取目录…</div>}
        </div>
        {error && <div className="config-error"><AlertTriangle size={13} />{error}</div>}
        <div className="modal-actions"><button className="button secondary" onClick={onClose}>取消</button><button className="button primary" onClick={choose} disabled={saving || loading || !path.trim()}>{saving ? <RefreshCw className="spin" size={14} /> : <Check size={14} />}{saving ? '切换中…' : '选择此目录'}</button></div>
      </section>
    </div>
  )
}

function FocusSession({ session, messages, messageStart, hasOlder, loadingOlder, olderError, model, permissionMode, cwd, availableModels, switchingModel, switchingCwd, switchingPermission, streaming, tools, approvals, error, pendingAsset, onAssetConsumed, onLoadOlder, onModelChange, onPermissionChange, onApproval, onWorkspace, onRename, onSend, onAbort }) {
  const [value, setValue] = useState('')
  const selection = useAttachmentSelection()
  const addSelectedAttachments = selection.addAttachments
  const promptRef = useRef(null)
  const prependSnapshot = useRef(null)
  const lastMessage = messages[messages.length - 1]
  const transcriptVersion = `${session?.id || ''}:${lastMessage?.id || ''}:${lastMessage?.text?.length || 0}:${lastMessage?.attachments?.length || 0}:${tools.map((tool) => `${tool.id}:${tool.status}`).join('|')}:${error || ''}`
  const { scrollRef: transcriptRef, onScroll: onTranscriptScroll, hasUnread, scrollToBottom } = useAutoScroll(transcriptVersion)
  const loadOlder = useCallback(async () => {
    const node = transcriptRef.current
    if (!node || !hasOlder || loadingOlder || prependSnapshot.current) return
    prependSnapshot.current = { scrollHeight: node.scrollHeight, scrollTop: node.scrollTop }
    const loaded = await onLoadOlder?.()
    if (!loaded) prependSnapshot.current = null
  }, [hasOlder, loadingOlder, onLoadOlder, transcriptRef])
  const handleTranscriptScroll = useCallback((event) => {
    onTranscriptScroll(event)
    if (event.currentTarget.scrollTop <= 96) void loadOlder()
  }, [loadOlder, onTranscriptScroll])
  useLayoutEffect(() => {
    const snapshot = prependSnapshot.current
    const node = transcriptRef.current
    if (!snapshot || !node) return
    node.scrollTop = snapshot.scrollTop + node.scrollHeight - snapshot.scrollHeight
    prependSnapshot.current = null
  }, [messageStart, transcriptRef])
  useEffect(() => {
    if (!pendingAsset) return
    addSelectedAttachments([pendingAsset])
    onAssetConsumed?.()
  }, [pendingAsset, onAssetConsumed, addSelectedAttachments])
  const applyWelcomeChip = (prompt) => {
    setValue(prompt)
    requestAnimationFrame(() => {
      const el = promptRef.current
      if (!el) return
      el.focus()
      el.style.height = 'auto'
      el.style.height = `${Math.min(el.scrollHeight, 220)}px`
    })
  }
  const submit = (event) => {
    event.preventDefault()
    if (!value.trim() && !selection.attachments.length) return
    onSend(value, undefined, selection.attachments)
    scrollToBottom('smooth')
    setValue('')
    if (promptRef.current) promptRef.current.style.height = 'auto'
    selection.clearAttachments()
  }
  return (
    <Panel className="focus-session">
      <div className="card-head"><div><div className="editable-session-title"><h3 title={session?.name}>{session?.name || '新会话'}</h3><button className="icon-button" title="重命名会话" onClick={onRename}><Pencil size={13} /></button></div><div className="session-runtime-meta"><span className={streaming ? 'success' : ''}>{streaming ? 'Agent 运行中' : '等待输入'}</span><button className="workspace-chip" title={cwd} onClick={onWorkspace} disabled={streaming || switchingCwd}><FolderOpen size={11} />{workspaceName(cwd)}</button></div></div>{streaming ? <button className="button danger tiny" onClick={onAbort}><Square size={12} />停止</button> : <MoreHorizontal size={17} />}</div>
      <div className="transcript" ref={transcriptRef} onScroll={handleTranscriptScroll}>
        {(hasOlder || loadingOlder || olderError) && <div className="history-page-loader">{olderError ? <button type="button" className="button secondary" onClick={loadOlder}><RefreshCw size={13} />重试加载更早消息</button> : loadingOlder ? <><RefreshCw className="spin" size={14} />正在加载更早消息…</> : <button type="button" className="button secondary" onClick={loadOlder}><ArrowDown className="history-up-arrow" size={14} />加载更早消息</button>}</div>}
        {!messages.length && <div className="agent-welcome"><BrandLogo size={44} className="welcome-logo" /><h2>准备好开始编码</h2><p>Agent 可以读取当前工作区、搜索代码并持续处理任务。默认使用只读工具权限。</p><div className="welcome-chips">{WELCOME_CHIPS.map((chip) => <button type="button" key={chip.label} onClick={() => applyWelcomeChip(chip.prompt)}>{chip.label}</button>)}</div></div>}
        {messages.map((message) => <div key={message.id} className={`message ${message.role} ${message.error ? 'has-error' : ''}`}><span>{message.role === 'agent' ? <span className="role-brand"><BrandLogo size={13} /> Vesper</span> : 'You'}</span><div className="message-content"><MarkdownMessage>{message.text || (message.streaming ? '正在思考…' : '')}</MarkdownMessage>{message.attachments?.length > 0 && <MessageAttachments attachments={message.attachments} />}{message.streaming && <i className="typing-dot" />}</div></div>)}
        {tools.length > 0 && <div className="tool-trace"><strong>工具执行</strong>{tools.map((tool) => <span key={tool.id} className={tool.status}><Wrench size={12} />{tool.name}<em>{tool.status === 'running' ? '运行中' : tool.status === 'done' ? '完成' : '失败'}</em></span>)}</div>}
        {error && <div className="chat-error"><AlertTriangle size={14} />{error}</div>}
      </div>
      {hasUnread && <button type="button" className="button secondary jump-to-latest" onClick={() => scrollToBottom('smooth')}><ArrowDown size={14} />有新内容</button>}
      <form className="focus-composer-shell" onSubmit={submit}><ToolApproval approvals={approvals} onResolve={onApproval} /><AttachmentTray attachments={selection.attachments} onRemove={selection.removeAttachment} />{selection.attachmentError && <span className="attachment-error">{selection.attachmentError}</span>}<div className="focus-composer"><button type="button" className="attach-trigger" title="添加附件" aria-label="添加附件" onClick={() => selection.inputRef.current?.click()} disabled={streaming}><Paperclip size={17} />{selection.attachments.length > 0 && <i>{selection.attachments.length}</i>}</button><input ref={selection.inputRef} className="sr-only" type="file" multiple accept="image/*,.txt,.md,.json,.js,.jsx,.ts,.tsx,.css,.html,.xml,.yaml,.yml,.csv,.log,.py,.java,.go,.rs,.sh,.ps1,.toml,.sql,.pdf,.docx,.pptx,.xlsx,.odt,.odp,.ods,.rtf,.epub" onChange={selection.chooseFiles} /><SessionModelSelect value={model} models={availableModels} onChange={onModelChange} disabled={streaming || switchingModel} /><PermissionModeSelect value={permissionMode} onChange={onPermissionChange} disabled={switchingPermission} /><textarea ref={promptRef} rows="1" value={value} onChange={(event) => { setValue(event.target.value); event.currentTarget.style.height = 'auto'; event.currentTarget.style.height = `${Math.min(event.currentTarget.scrollHeight, 220)}px` }} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit() } }} placeholder={streaming ? 'Agent 正在运行，可停止后继续输入' : '输入消息，Shift + Enter 换行'} disabled={streaming} /><button className="send-button" title="发送消息" aria-label="发送消息" disabled={(!value.trim() && !selection.attachments.length) || streaming}><Send size={18} /></button></div></form>
    </Panel>
  )
}

function QuickCreate({ type, close, notify }) {
  const titles = { chat: '新建会话', assets: '导出资产', channels: '连接渠道', schedules: '新建定时任务', config: '添加 Provider', plugins: '保存插件策略', memory: '新建记忆节点', mcp: '添加 MCP 服务', skills: '安装技能' }
  return <div className="modal-backdrop" onMouseDown={close}><form className="modal" onMouseDown={(e) => e.stopPropagation()} onSubmit={(e) => { e.preventDefault(); notify(`${titles[type]}成功`); close() }}><div className="card-head"><div><h2>{titles[type]}</h2><p>填写基本信息后即可继续配置。</p></div><button type="button" className="icon-button" onClick={close}><X size={17} /></button></div><InputLabel label="名称" value="" placeholder="输入名称" /><InputLabel label="描述" value="" placeholder="补充简短描述" /><SelectLabel label="类型" options={['默认', '自定义', '从模板创建']} /><div className="modal-actions"><button type="button" className="button secondary" onClick={close}>取消</button><button className="button primary"><Plus size={14} />确认创建</button></div></form></div>
}

function MarkdownMessage({ children }) {
  return <Suspense fallback={<div className="markdown-body markdown-loading">{children}</div>}><LazyMarkdownMessage>{children}</LazyMarkdownMessage></Suspense>
}

function AttachmentTray({ attachments, onRemove, compact = false }) {
  if (!attachments.length) return null
  return <div className={`attachment-tray ${compact ? 'compact' : ''}`}>{attachments.map((attachment) => <div className="attachment-chip" key={attachment.id}>{attachment.kind === 'image' ? <img src={`data:${attachment.mimeType};base64,${attachment.data}`} alt="" /> : <span className="attachment-icon"><File size={13} /></span>}<span><strong>{attachment.name}</strong><small>{attachment.kind === 'image' ? '图片' : attachment.kind === 'document' ? '文档' : '文本'} · {formatFileSize(attachment.size)}{attachment.truncated ? ' · 已截断' : ''}</small></span><button type="button" aria-label={`移除 ${attachment.name}`} onClick={() => onRemove(attachment.id)}><X size={12} /></button></div>)}</div>
}

function MessageAttachments({ attachments, compact = false }) {
  const [preview, setPreview] = useState(null)
  return <><div className={`message-attachments ${compact ? 'compact' : ''}`}>{attachments.map((attachment, index) => {
    const key = attachment.id || index
    const source = attachment.url || (attachment.data ? `data:${attachment.mimeType};base64,${attachment.data}` : '')
    if (attachment.kind === 'image' && source) return <button type="button" className="generated-media" onClick={() => setPreview({ attachment, source })} title="点击大屏查看" key={key}><img src={source} alt={attachment.name || '图片附件'} /><small>{attachment.name || '生成图片'}</small></button>
    if (attachment.kind === 'video' && source) return <div className="generated-media video" key={key}><video controls preload="metadata" src={source} /><small>{attachment.name || '生成视频'}</small></div>
    return <a className="message-file-attachment" href={attachment.downloadUrl || undefined} key={key}><File size={12} />{attachment.name || '文件附件'}</a>
  })}</div>{preview && <ImageLightbox attachment={preview.attachment} source={preview.source} onClose={() => setPreview(null)} />}</>
}

function ImageLightbox({ attachment, source, onClose }) {
  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    const onKeyDown = (event) => { if (event.key === 'Escape') onClose() }
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', onKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [onClose])
  return <div className="image-lightbox" role="dialog" aria-modal="true" aria-label="图片大屏预览" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><div className="image-lightbox-toolbar"><span title={attachment.name}>{attachment.name || '生成图片'}</span><div><a className="button secondary" href={attachment.downloadUrl || source} download={attachment.name || 'generated-image'}><Download size={14} />下载原图</a><button type="button" className="icon-button" aria-label="关闭预览" onClick={onClose}><X size={18} /></button></div></div><img src={source} alt={attachment.name || '生成图片'} /></div>
}

function TiledEmptyState({ hasQuery }) { return <Panel className="empty-state"><StarOrbit size={48} /><h2>{hasQuery ? '没有匹配的平铺会话' : '尚未选择平铺会话'}</h2><p>{hasQuery ? '更换搜索关键词，或从历史会话中加入其他会话。' : '点击历史会话右侧的平铺图标，把需要并行关注的会话加入这里。'}</p></Panel> }

export default App
