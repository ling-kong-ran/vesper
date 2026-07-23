import { Suspense, lazy, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Navigate, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { createPortal } from 'react-dom'
import {
  AlertTriangle,
  ArrowDown,
  Bot,
  Check,
  Circle,
  ChevronRight,
  Download,
  ExternalLink,
  File,
  FolderOpen,
  Grid2X2,
  Link2,
  ListChecks,
  Menu,
  MessageSquare,
  Monitor,
  Moon,
  MoreHorizontal,
  PanelLeftClose,
  PanelLeftOpen,
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
  Target,
  X,
} from 'lucide-react'
import { APP_NAME } from './app/brand.js'
import { createPrimaryActionRegistry } from './app/primary-action.js'
import { STORAGE_KEYS } from './app/storage.js'
import { getNavigation, getPageMeta } from './app/navigation.jsx'
import { PAGE_IDS, PAGE_PATHS, pageFromPath, pagePath } from './app/routes.js'
import { useI18n } from './app/use-i18n.js'
import { BrandLogo } from './components/BrandLogo.jsx'
import { StarOrbit } from './components/StarOrbit.jsx'
import { AppDialog, InputLabel, Panel, Segmented, SelectLabel, Toast, Toggle } from './components/ui.jsx'
import { useAttachmentSelection } from './features/chat/attachments.js'
import { ChatHistoryPage } from './features/chat/ChatHistoryPage.jsx'
import { ACTIVE_SESSION_CHANGED_EVENT, SESSION_SELECTED_EVENT, SESSIONS_UPDATED_EVENT, announceActiveSession, announceSessionsUpdated, requestSessionSelection } from './features/chat/events.js'
import { FocusChatMessage, MiniChatMessage } from './features/chat/ChatMessage.jsx'
import AgentRunActivity from './features/chat/AgentRunActivity.jsx'
import { mergeSessionLists, toggleTiledSession } from './features/chat/session-list.js'
import { settleToolCalls } from './features/chat/run-activity.js'
import { useAutoScroll } from './hooks/useAutoScroll.js'
import { usePagePrimaryAction } from './hooks/usePagePrimaryAction.js'
import { apiJson, applyTextPatch, consumeEventStream } from './lib/api.js'
import { applySessionUpdate, DEFAULT_SESSION_STATE } from './lib/session-state.js'
import { createStreamingTextScheduler, createToolUpdateScheduler } from './lib/streaming-ui.js'
import { formatFileSize, formatTokenCount, relativeTime, workspaceName } from './lib/format.js'
import { useAppDialog } from './hooks/useAppDialog.js'
import { useAppUpdate } from './features/updates/useAppUpdate.js'

const PluginsPage = lazy(() => import('./features/plugins/PluginsPage.jsx').then((module) => ({ default: module.PluginsPage })))
const ChannelsPage = lazy(() => import('./features/channels/ChannelsPage.jsx').then((module) => ({ default: module.ChannelsPage })))
const ConfigPage = lazy(() => import('./features/config/ConfigPage.jsx').then((module) => ({ default: module.ConfigPage })))
const MemoryPage = lazy(() => import('./features/memory/MemoryPage.jsx').then((module) => ({ default: module.MemoryPage })))
const SchedulesPage = lazy(() => import('./features/schedules/SchedulesPage.jsx').then((module) => ({ default: module.SchedulesPage })))
const AssetsPage = lazy(() => import('./features/assets/AssetsPage.jsx').then((module) => ({ default: module.AssetsPage })))
const McpPage = lazy(() => import('./features/workflows/PreviewPages.jsx').then((module) => ({ default: module.McpPage })))
const SkillsPage = lazy(() => import('./features/skills/SkillsPage.jsx').then((module) => ({ default: module.SkillsPage })))
const WorkflowsPage = lazy(() => import('./features/workflows/WorkflowsPage.jsx').then((module) => ({ default: module.WorkflowsPage })))
const WorkflowBuilder = lazy(() => import('./features/workflows/WorkflowsPage.jsx').then((module) => ({ default: module.WorkflowBuilder })))
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
  system: Monitor,
  light: Sun,
  dark: Moon,
}

function resolveDark(mode) {
  return mode === 'dark' || (mode === 'system' && window.matchMedia('(prefers-color-scheme: dark)').matches)
}

function isEditableTarget(target) {
  return target instanceof HTMLElement && (target.matches('input, textarea, select') || target.isContentEditable)
}

function App() {
  const { t } = useI18n()
  const location = useLocation()
  const routerNavigate = useNavigate()
  const navigation = useMemo(() => getNavigation(t), [t])
  const pageMeta = useMemo(() => getPageMeta(t), [t])
  const page = pageFromPath(location.pathname) || 'chat'
  const [chatMode, setChatModeState] = useState(() => localStorage.getItem(STORAGE_KEYS.chatMode) || 'focus')
  const [query, setQuery] = useState('')
  const [mobileNav, setMobileNav] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => localStorage.getItem(STORAGE_KEYS.sidebarCollapsed) === '1')
  const [toast, setToast] = useState(null)
  const [modal, setModal] = useState(null)
  const [configSection, setConfigSection] = useState('models')
  const [pendingAsset, setPendingAsset] = useState(null)
  const [pluginStats, setPluginStats] = useState(null)
  const [startupReady, setStartupReady] = useState(false)
  const [notificationSettings, setNotificationSettings] = useState({ browser: { enabled: false }, templates: [] })
  const [workflowActions, setWorkflowActions] = useState(null)
  const browserEventCursor = useRef('')
  const [primaryActions] = useState(createPrimaryActionRegistry)
  const searchInputRef = useRef(null)
  const toastTimer = useRef(null)
  const appDialog = useAppDialog()
  const appUpdate = useAppUpdate()
  const [theme, setTheme] = useState(() => {
    const stored = localStorage.getItem(STORAGE_KEYS.theme)
    return THEME_SEQUENCE.includes(stored) ? stored : 'system'
  })

  useLayoutEffect(() => {
    document.documentElement.dataset.density = localStorage.getItem(STORAGE_KEYS.density) === 'compact' ? 'compact' : 'comfortable'
  }, [])

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

  const toggleSidebarCollapsed = () => setSidebarCollapsed((current) => {
    const next = !current
    localStorage.setItem(STORAGE_KEYS.sidebarCollapsed, next ? '1' : '0')
    return next
  })

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

  const showSystemNotification = useCallback((title, body, { force = false } = {}) => {
    if (!notificationSettings.browser?.enabled) return
    if (!force && document.visibilityState === 'visible' && document.hasFocus()) return
    if (window.vesperDesktop?.showNotification) {
      void window.vesperDesktop.showNotification({ title, body }).catch(() => {})
      return
    }
    if (!('Notification' in window) || window.Notification.permission !== 'granted') return
    const item = new window.Notification(title, { body, tag: `vesper-${title}` })
    item.onclick = () => { window.focus(); item.close() }
  }, [notificationSettings.browser?.enabled])

  const browserNotify = useCallback((event, data, options) => {
    const template = notificationSettings.templates?.find((item) => item.id === event)
    const content = template?.channels?.browser?.content
    if (!template?.enabled || !content) return
    showSystemNotification(template.name, renderNotificationContent(content, data), options)
  }, [notificationSettings.templates, showSystemNotification])

  const registerPrimaryAction = useCallback((action) => {
    return primaryActions.register(action)
  }, [primaryActions])

  const invokePrimaryAction = useCallback(() => {
    primaryActions.invoke()
  }, [primaryActions])

  const registerWorkflowActions = useCallback((actions) => {
    setWorkflowActions(actions)
    return () => setWorkflowActions((current) => current === actions ? null : current)
  }, [])

  const navigate = useCallback((next, options) => {
    if (!PAGE_IDS.has(next)) return
    routerNavigate(pagePath(next), options)
    setQuery('')
    setMobileNav(false)
  }, [routerNavigate])

  const openUpdateSettings = useCallback(() => {
    setConfigSection('updates')
    navigate('config')
  }, [navigate])

  const handlePrimary = useCallback(() => {
    if (page === 'config' && configSection !== 'models') return
    if (['chat', 'config', 'assets', 'plugins', 'channels', 'schedules', 'memory', 'mcp', 'skills', 'workflowCreate'].includes(page)) invokePrimaryAction()
    else if (page === 'chatHistory') { navigate('chat'); invokePrimaryAction() }
    else if (page === 'workflows') navigate('workflowCreate')
    else setModal(page)
  }, [configSection, invokePrimaryAction, navigate, page])

  useEffect(() => {
    const focusSearch = () => {
      if (page === 'chat' && chatMode === 'focus') {
        navigate('chatHistory')
        requestAnimationFrame(() => requestAnimationFrame(() => searchInputRef.current?.focus()))
      } else searchInputRef.current?.focus()
    }
    const onKeyDown = (event) => {
      const modifier = event.metaKey || event.ctrlKey
      if (modifier && event.key.toLowerCase() === 'k' && !appDialog.dialog && !modal) {
        event.preventDefault()
        setPaletteOpen(true)
      } else if (modifier && event.key.toLowerCase() === 'n' && !isEditableTarget(event.target)) {
        event.preventDefault()
        handlePrimary()
      } else if (event.key === '/' && !modifier && !event.altKey && !isEditableTarget(event.target)) {
        event.preventDefault()
        focusSearch()
      } else if (event.key === 'Escape' && !appDialog.dialog) {
        if (paletteOpen) setPaletteOpen(false)
        else if (modal) setModal(null)
        else if (mobileNav) setMobileNav(false)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [appDialog.dialog, chatMode, handlePrimary, modal, mobileNav, navigate, page, paletteOpen])

  useEffect(() => {
    let active = true
    apiJson('/api/config')
      .then((config) => {
        if (!active) return
        if (!hasUsableProvider(config)) {
          primaryActions.clear()
          primaryActions.invoke()
          navigate('config', { replace: true })
        }
      })
      .catch(() => {})
      .finally(() => active && setStartupReady(true))
    return () => { active = false }
  }, [navigate, primaryActions])

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
        for (const event of result.events || []) showSystemNotification(event.title, event.body, { force: true })
        browserEventCursor.current = result.latestId || browserEventCursor.current
      } catch {}
    }
    poll()
    const timer = window.setInterval(poll, 3000)
    return () => { active = false; window.clearInterval(timer) }
  }, [showSystemNotification])

  const activeMeta = page === 'chat' && chatMode === 'focus'
    ? [t('会话'), '']
    : pageMeta[page]

  if (!startupReady) return <div className="app-startup"><BrandLogo size={30} className="startup-logo" /><strong>{t('正在唤醒 Vesper…')}</strong></div>

  return (
    <div className="app-shell">
      <div className="app-body">
        <Sidebar page={page} navigation={navigation} navigate={navigate} setChatMode={setChatMode} open={mobileNav} onClose={() => setMobileNav(false)} collapsed={sidebarCollapsed} onToggleCollapse={toggleSidebarCollapsed} update={appUpdate} onOpenUpdates={openUpdateSettings} />
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
            searchInputRef={searchInputRef}
            theme={theme}
            onCycleTheme={cycleTheme}
            workflowActions={workflowActions}
            desktopPlatform={window.vesperDesktop?.platform || ''}
          />
          <div className={`page-content page-${page}`} key={page}>
            <Routes>
              <Route path={PAGE_PATHS.chat} element={<ChatPage mode={chatMode} setMode={setChatMode} query={query} notify={notify} browserNotify={browserNotify} registerPrimaryAction={registerPrimaryAction} pendingAsset={pendingAsset} onAssetConsumed={() => setPendingAsset(null)} requestText={appDialog.prompt} />} />
              <Route path={PAGE_PATHS.chatHistory} element={<ChatHistoryPage query={query} navigate={navigate} setChatMode={setChatMode} notify={notify} requestConfirm={appDialog.confirm} requestText={appDialog.prompt} />} />
              <Route path={PAGE_PATHS.assets} element={<Suspense fallback={<PageLoader />}><AssetsPage query={query} notify={notify} registerPrimaryAction={registerPrimaryAction} requestConfirm={appDialog.confirm} onUse={(asset) => { setPendingAsset(asset); setChatMode('focus'); navigate('chat') }} /></Suspense>} />
              <Route path={PAGE_PATHS.channels} element={<Suspense fallback={<PageLoader />}><ChannelsPage notify={notify} registerPrimaryAction={registerPrimaryAction} requestConfirm={appDialog.confirm} /></Suspense>} />
              <Route path={PAGE_PATHS.schedules} element={<Suspense fallback={<PageLoader />}><SchedulesPage notify={notify} registerPrimaryAction={registerPrimaryAction} requestConfirm={appDialog.confirm} openNotificationSettings={() => { setConfigSection('notifications'); navigate('config') }} /></Suspense>} />
              <Route path={PAGE_PATHS.config} element={<Suspense fallback={<PageLoader />}><ConfigPage notify={notify} registerPrimaryAction={registerPrimaryAction} section={configSection} setSection={setConfigSection} onBrowserNotificationChange={setNotificationSettings} requestConfirm={appDialog.confirm} update={appUpdate} /></Suspense>} />
              <Route path={PAGE_PATHS.plugins} element={<Suspense fallback={<PageLoader />}><PluginsPage query={query} notify={notify} registerPrimaryAction={registerPrimaryAction} onStatusChange={setPluginStats} /></Suspense>} />
              <Route path={PAGE_PATHS.memory} element={<Suspense fallback={<PageLoader />}><MemoryPage query={query} notify={notify} registerPrimaryAction={registerPrimaryAction} requestConfirm={appDialog.confirm} /></Suspense>} />
              <Route path={PAGE_PATHS.mcp} element={<Suspense fallback={<PageLoader />}><McpPage query={query} notify={notify} registerPrimaryAction={registerPrimaryAction} requestText={appDialog.prompt} requestConfirm={appDialog.confirm} /></Suspense>} />
              <Route path={PAGE_PATHS.skills} element={<Suspense fallback={<PageLoader />}><SkillsPage query={query} notify={notify} registerPrimaryAction={registerPrimaryAction} requestText={appDialog.prompt} requestConfirm={appDialog.confirm} /></Suspense>} />
              <Route path={PAGE_PATHS.workflows} element={<Suspense fallback={<PageLoader />}><WorkflowsPage query={query} notify={notify} requestConfirm={appDialog.confirm} /></Suspense>} />
              <Route path={PAGE_PATHS.workflowCreate} element={<Suspense fallback={<PageLoader />}><WorkflowBuilder notify={notify} registerPrimaryAction={registerPrimaryAction} registerWorkflowActions={registerWorkflowActions} /></Suspense>} />
              <Route path="/workflows/:workflowId" element={<Suspense fallback={<PageLoader />}><WorkflowBuilder notify={notify} registerPrimaryAction={registerPrimaryAction} registerWorkflowActions={registerWorkflowActions} /></Suspense>} />
              <Route path="*" element={<Navigate to={PAGE_PATHS.chat} replace />} />
            </Routes>
          </div>
        </main>
      </div>
      <StatusBar page={page} pluginStats={pluginStats} />
      {toast && <Toast message={toast.message} tone={toast.tone} />}
      <AppDialog dialog={appDialog.dialog} onClose={appDialog.close} onFinish={appDialog.finish} />
      {paletteOpen && <CommandPalette navigation={navigation} onClose={() => setPaletteOpen(false)} onNavigate={navigate} onOpenSession={(id) => { setChatMode('focus'); requestSessionSelection(id); navigate('chat') }} onNewChat={() => { setChatMode('focus'); navigate('chat'); requestAnimationFrame(() => requestAnimationFrame(invokePrimaryAction)) }} />}
      {modal && <QuickCreate type={modal} close={() => setModal(null)} notify={notify} />}
    </div>
  )
}

function StatusBar({ page, pluginStats }) {
  const { t, language } = useI18n()
  const [usage, setUsage] = useState(null)
  const [modelLabel, setModelLabel] = useState('')
  const modelRequest = useRef(0)

  const refreshUsage = useCallback(async () => {
    try { setUsage(await apiJson('/api/usage/today')) } catch {}
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

  const refreshModel = useCallback(async (sessionId = localStorage.getItem(STORAGE_KEYS.activeSession) || '') => {
    const request = ++modelRequest.current
    try {
      const [config, sessionData] = await Promise.all([apiJson('/api/config'), apiJson('/api/sessions')])
      if (request !== modelRequest.current) return
      const session = sessionData.sessions?.find((item) => item.id === sessionId)
      setModelLabel(session?.model || (config.model ? `${config.provider}/${config.model}` : ''))
    } catch {}
  }, [])

  useEffect(() => {
    const syncModel = (event) => {
      const sessionId = event.detail?.id || localStorage.getItem(STORAGE_KEYS.activeSession) || ''
      if (event.detail?.model) {
        modelRequest.current += 1
        setModelLabel(event.detail.model)
      } else {
        void refreshModel(sessionId)
      }
    }
    const refreshFromSessions = () => { void refreshModel() }
    void refreshModel()
    window.addEventListener(ACTIVE_SESSION_CHANGED_EVENT, syncModel)
    window.addEventListener(SESSIONS_UPDATED_EVENT, refreshFromSessions)
    return () => {
      window.removeEventListener(ACTIVE_SESSION_CHANGED_EVENT, syncModel)
      window.removeEventListener(SESSIONS_UPDATED_EVENT, refreshFromSessions)
    }
  }, [refreshModel])

  const usageTitle = usage
    ? t('输入 {input} · 输出 {output} · 推理 {reasoning} · 缓存读取 {cacheRead}', {
        input: usage.input.toLocaleString(language),
        output: usage.output.toLocaleString(language),
        reasoning: usage.reasoning.toLocaleString(language),
        cacheRead: usage.cacheRead.toLocaleString(language),
      })
    : t('正在统计今日 Token 消耗')

  return <footer className="status-bar">
    <span className="status-model"><Bot size={12} />{modelLabel || t('未配置模型')}</span>
    <span className="status-usage">{['skills', 'mcp', 'workflows', 'workflowCreate'].includes(page)
      ? <>{t('原生运行时')} <em>{t('已接入')}</em></>
      : page === 'plugins'
        ? t('已启用 {enabled} / {total}', { enabled: pluginStats?.enabled ?? '—', total: pluginStats?.total ?? '—' })
        : <>{t('今日 tokens')} <em title={usageTitle}>{usage ? formatTokenCount(usage.totalTokens) : '—'}</em></>}</span>
  </footer>
}

function PageLoader() {
  const { t } = useI18n()
  return <Panel className="empty-state"><RefreshCw className="spin" size={24} /><h2>{t('正在点亮此页')}</h2><p>{t('所需能力正在依次就位…')}</p></Panel>
}

function Sidebar({ page, navigation, navigate, setChatMode, open, onClose, collapsed, onToggleCollapse, update, onOpenUpdates }) {
  const { t, language } = useI18n()
  const [sessions, setSessions] = useState([])
  const [historyExpanded, setHistoryExpanded] = useState(true)
  const [activeSessionId, setActiveSessionId] = useState(() => localStorage.getItem(STORAGE_KEYS.activeSession) || '')
  const active = page === 'workflowCreate' ? 'workflows' : page === 'chatHistory' ? 'chat' : page

  const refreshSessions = useCallback(async () => {
    try {
      const data = await apiJson('/api/sessions')
      setSessions([...(data.sessions || [])].sort((a, b) => Date.parse(b.modified) - Date.parse(a.modified)))
    } catch {}
  }, [])

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

  return (
    <>
      {open && <button className="nav-scrim" aria-label={t('关闭导航')} onClick={onClose} />}
      <aside className={`sidebar ${open ? 'is-open' : ''} ${collapsed ? 'collapsed' : ''}`}>
        <div className="brand"><BrandLogo size={22} /><strong>{APP_NAME}</strong><button className="mobile-close" onClick={onClose}><X size={18} /></button></div>
        <div className="nav-list">
          <nav className="nav-primary" aria-label={t('主导航')}>
            {navigation.map(([group, items]) => (
              <div className="nav-group" key={group}>
                <span className="nav-group-label">{group}</span>
                {items.map(([id, label, Icon]) => <button className={`nav-main ${active === id ? 'active' : ''}`} key={id} title={label} onClick={() => navigate(id)}><Icon size={16} /><span>{label}</span></button>)}
              </div>
            ))}
          </nav>
          <section className={`nav-history-section ${historyExpanded ? 'is-expanded' : ''}`} aria-label={t('最近会话')}>
            <div className="nav-history-section-head">
              <button className="nav-history-heading" aria-controls="sidebar-recent-sessions" aria-expanded={historyExpanded} onClick={() => setHistoryExpanded((value) => !value)}><span>{t('最近会话')}</span><ChevronRight className={historyExpanded ? 'is-open' : ''} size={14} /></button>
              <button className="nav-history-view-all" aria-label={t('查看全部历史会话，共 {count} 个', { count: sessions.length })} onClick={() => navigate('chatHistory')}>{t('查看全部')}</button>
            </div>
            {historyExpanded && <div className="nav-history-list" id="sidebar-recent-sessions">
              {sessions.slice(0, 4).map((session) => <button className={`nav-history-item ${session.id === activeSessionId ? 'active-session' : ''}`} aria-current={session.id === activeSessionId ? 'page' : undefined} title={`${session.name || t('未命名会话')} · ${relativeTime(session.modified, language)}`} onClick={() => openRecentSession(session.id)} key={session.id}><span>{session.name || t('未命名会话')}</span></button>)}
              {!sessions.length && <span className="nav-history-empty">{t('暂无历史会话')}</span>}
            </div>}
          </section>
        </div>
        <div className="mt-auto grid gap-2">
          <SidebarUpdateStatus update={update} collapsed={collapsed} onOpen={onOpenUpdates} />
          <button className="sidebar-collapse !mt-0" title={t(collapsed ? '展开侧栏' : '收起侧栏')} aria-label={t(collapsed ? '展开侧栏' : '收起侧栏')} onClick={onToggleCollapse}>{collapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}<span>{t(collapsed ? '展开侧栏' : '收起侧栏')}</span></button>
        </div>
      </aside>
    </>
  )
}

function SidebarUpdateStatus({ update, collapsed, onOpen }) {
  const { t } = useI18n()
  const status = update?.status || { state: 'idle' }
  const desktop = Boolean(update?.info?.desktop)
  if (!['available', 'downloading', 'downloaded'].includes(status.state)) return null
  const downloading = status.state === 'downloading'
  const downloaded = status.state === 'downloaded'
  const label = t(downloaded ? '等待重启安装' : downloading ? '正在下载' : desktop ? '发现新版本' : '发现代码更新')
  const detail = downloading
    ? `${Math.round(status.percent || 0)}%`
    : desktop && status.availableVersion
      ? `v${status.availableVersion}`
      : status.behindBy
        ? t('落后 {branch} {count} 个提交', { branch: status.branch || 'main', count: status.behindBy })
        : status.availableCommit
          ? status.availableCommit.slice(0, 7)
          : t('点击查看更新')
  const Icon = downloaded ? Rocket : downloading ? RefreshCw : desktop ? Download : ExternalLink
  return <button type="button" className={`flex min-h-11 w-full items-center rounded-[var(--r-sm)] border border-[var(--stroke)] bg-[var(--accent-soft)] text-[var(--text)] transition-colors hover:bg-[var(--surface-hover)] ${collapsed ? 'justify-center px-0' : 'gap-2.5 px-3 text-left'}`} title={`${label} · ${detail}`} aria-label={`${label} · ${detail}`} onClick={onOpen}>
    <Icon className={downloading ? 'spin shrink-0' : 'shrink-0'} size={16} />
    {!collapsed && <span className="min-w-0"><strong className="block truncate text-[12px]">{label}</strong><small className="mt-0.5 block truncate text-[11px] text-[var(--muted)]">{detail}</small></span>}
  </button>
}

function PageHeader({ meta, page, query, setQuery, chatMode, setChatMode, configSection, onMenu, onPrimary, theme, onCycleTheme, searchInputRef, workflowActions, desktopPlatform }) {
  const { t } = useI18n()
  const primary = page === 'config' && configSection !== 'models' ? null : ({
    chat: [t('新会话'), Plus], chatHistory: [t('新会话'), Plus], assets: [t('添加链接'), Link2], channels: [t('连接渠道'), Plus], schedules: [t('新建任务'), Plus],
    config: [t('添加 Provider'), Plus], plugins: [t('保存策略'), Save], memory: [t('点亮星辰'), Plus], mcp: [t('添加服务'), Plus],
    skills: [t('安装技能'), Plus], workflows: [t('新建工作流'), Plus], workflowCreate: [t('发布'), Rocket],
  }[page])
  const PrimaryIcon = primary?.[1]
  const ThemeIcon = THEME_META[theme] || THEME_META.system
  const themeLabel = t(theme === 'light' ? '浅色' : theme === 'dark' ? '深色' : '跟随系统')
  const gridLabel = t('平铺')
  const focusLabel = t('聚集')
  const desktop = Boolean(desktopPlatform)
  return (
    <header className={`page-header ${desktop ? '[-webkit-app-region:drag]' : ''} ${desktopPlatform === 'darwin' ? 'pl-[74px]' : ''}`}>
      <button className={`mobile-menu ${desktop ? '[-webkit-app-region:no-drag]' : ''}`} onClick={onMenu}><Menu size={19} /></button>
      <div className="title-block"><h1>{meta[0]}</h1><p>{meta[1]}</p></div>
      <div className={`header-actions ${desktop ? '[-webkit-app-region:no-drag]' : ''} ${desktopPlatform && desktopPlatform !== 'darwin' ? 'pr-[138px]' : ''}`}>
        {page === 'chat' && <Segmented options={[gridLabel, focusLabel]} value={chatMode === 'grid' ? gridLabel : focusLabel} onChange={(value) => setChatMode(value === gridLabel ? 'grid' : 'focus')} compact />}
        {page === 'workflowCreate' ? (
          <>
            <button className="button secondary" disabled={!workflowActions || workflowActions.busy || workflowActions.running} onClick={() => workflowActions?.save()}><Save size={15} />{t('保存草稿')}</button>
            <button className="button dark" disabled={!workflowActions || workflowActions.busy} onClick={() => workflowActions?.run()}>{workflowActions?.running ? <Square size={15} /> : <Play size={15} />}{t(workflowActions?.running ? '停止' : '试运行')}</button>
          </>
        ) : page === 'chat' && chatMode === 'focus' ? null : (
          <label className="search-box" title={t('搜索（/）')}><Search size={15} /><input ref={searchInputRef} value={query} onChange={(e) => setQuery(e.target.value)} placeholder={page === 'chat' ? t('搜索平铺会话') : page === 'mcp' ? t('搜索服务或工具') : page === 'memory' ? t('搜索星辰或文件') : t('搜索{page}', { page: meta[0] })} /></label>
        )}
        {primary && <button className="button primary" title={t('{action}（Ctrl/⌘ N）', { action: primary[0] })} onClick={onPrimary}><PrimaryIcon size={15} />{primary[0]}</button>}
        <button className="icon-button theme-toggle" title={t('主题：{theme}（点击切换）', { theme: themeLabel })} aria-label={t('主题：{theme}，点击切换主题', { theme: themeLabel })} onClick={onCycleTheme}><ThemeIcon size={16} /></button>
      </div>
    </header>
  )
}

function ChatPage({ mode, setMode, query, notify, browserNotify, registerPrimaryAction, pendingAsset, onAssetConsumed, requestText }) {
  const { t } = useI18n()
  const [remoteSessions, setRemoteSessions] = useState([])
  const [activeId, setActiveId] = useState(() => localStorage.getItem(STORAGE_KEYS.activeSession) || '')
  const [sessionStates, setSessionStates] = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [model, setModel] = useState(() => t('等待配置'))
  const [availableModels, setAvailableModels] = useState([])
  const [workspaceSession, setWorkspaceSession] = useState(null)
  const [tiledSessionIds, setTiledSessionIds] = useState(() => readStoredArray(STORAGE_KEYS.tiledSessions))
  const [railOpen, setRailOpenState] = useState(() => localStorage.getItem(STORAGE_KEYS.sessionRail) !== '0')
  const setRailOpen = useCallback((open) => {
    setRailOpenState(open)
    localStorage.setItem(STORAGE_KEYS.sessionRail, open ? '1' : '0')
  }, [])
  const tiledStorageWasEmpty = useRef(localStorage.getItem(STORAGE_KEYS.tiledSessions) === null)
  const creatingSessionRef = useRef(null)
  const sessionStatesRef = useRef(sessionStates)

  useEffect(() => {
    sessionStatesRef.current = sessionStates
  }, [sessionStates])

  const updateSessionState = useCallback((id, update) => {
    if (!id) return
    const current = sessionStatesRef.current
    const previous = current[id] || DEFAULT_SESSION_STATE
    const next = applySessionUpdate(previous, update)
    if (next === previous) return
    const states = { ...current, [id]: next }
    sessionStatesRef.current = states
    setSessionStates(states)
  }, [])

  const syncLiveSession = useCallback(async (id) => {
    if (!id) return
    try {
      const data = await apiJson(`/api/sessions/${encodeURIComponent(id)}/live`)
      updateSessionState(id, (current) => {
        const finishedAt = data.finishedAt || current.runFinishedAt || new Date().toISOString()
        return {
          ...current,
          ...latestPageState(current, data),
          tools: data.streaming ? (data.tools || []) : settleToolCalls(data.tools || [], { finishedAt, error: data.error || '' }),
          streaming: data.streaming,
          recovering: data.streaming,
          runStartedAt: data.startedAt || current.runStartedAt || null,
          lastActivityAt: data.lastActivityAt || current.lastActivityAt || data.startedAt || null,
          runFinishedAt: data.streaming ? null : finishedAt,
          runNotice: data.streaming ? current.runNotice || '' : '',
          loaded: true,
          loading: false,
          error: data.error || '',
          model: data.model || current.model,
          cwd: data.cwd || current.cwd,
          permissionMode: data.permissionMode || current.permissionMode,
          goal: data.goal ?? current.goal ?? null,
          taskList: data.taskList ?? current.taskList ?? null,
          approvals: data.approvals || [],
        }
      })
      setRemoteSessions((current) => current.map((session) => session.id === id ? { ...session, streaming: data.streaming, model: data.model || session.model, cwd: data.cwd || session.cwd, permissionMode: data.permissionMode || session.permissionMode, goal: data.goal ?? session.goal ?? null, taskList: data.taskList ?? session.taskList ?? null } : session))
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

  const createSession = () => {
    if (creatingSessionRef.current) return creatingSessionRef.current
    const request = (async () => {
      try {
        setError('')
        const created = await apiJson('/api/sessions', { method: 'POST', body: JSON.stringify({ name: t('新会话') }) })
        setActiveId(created.id)
        setRemoteSessions((current) => mergeSessionLists(current, [created]))
        updateSessionState(created.id, { messages: [], tools: [], approvals: [], permissionMode: created.permissionMode || 'auto', goal: created.goal || null, taskList: created.taskList || null, streaming: false, error: '', loaded: true, pageSize: FOCUS_MESSAGE_PAGE_SIZE, messageStart: 0, hasOlder: false, olderCursor: null, runStartedAt: null, lastActivityAt: null, runFinishedAt: null, runStopped: false, runNotice: '' })
        setTiledSessionIds((current) => current.includes(created.id) ? current : [...current, created.id])
        setMode('focus')
        try {
          await refreshSessions(created.id)
        } catch (caught) {
          setError(t('会话已创建，但刷新列表失败：{error}', { error: caught.message }))
        }
        notify(t('新会话已创建'))
        return created.id
      } catch (caught) {
        setError(caught.message)
        return ''
      }
    })()
    creatingSessionRef.current = request
    void request.finally(() => {
      if (creatingSessionRef.current === request) creatingSessionRef.current = null
    })
    return request
  }
  usePagePrimaryAction(registerPrimaryAction, createSession)

  useEffect(() => {
    let active = true
    Promise.all([apiJson('/api/sessions'), apiJson('/api/config')])
      .then(async ([sessionData, configData]) => {
        if (!active) return
        setModel(configData.model ? `${configData.provider}/${configData.model}` : t('未配置模型'))
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
        if (!list.length && (creatingSessionRef.current || Object.keys(sessionStatesRef.current).length)) {
          await creatingSessionRef.current
          if (!active) return
          list = (await apiJson('/api/sessions')).sessions
        }
        if (!list.length) {
          const created = await apiJson('/api/sessions', { method: 'POST', body: JSON.stringify({ name: t('新会话') }) })
          list = [created]
        }
        if (!active) return
        setRemoteSessions((current) => mergeSessionLists(current, list))
        announceSessionsUpdated()
        for (const session of list) {
          if (session.streaming) updateSessionState(session.id, { streaming: true, recovering: true, loaded: false, error: '' })
        }
        const storedId = localStorage.getItem(STORAGE_KEYS.activeSession)
        const knownIds = new Set([...list.map((session) => session.id), ...Object.keys(sessionStatesRef.current)])
        setActiveId((current) => knownIds.has(current) ? current : (knownIds.has(storedId) ? storedId : (list[0]?.id || '')))
        setTiledSessionIds((current) => {
          const valid = current.filter((id) => knownIds.has(id))
          if (tiledStorageWasEmpty.current) {
            tiledStorageWasEmpty.current = false
            return [...knownIds].slice(0, 4)
          }
          return valid
        })
      })
      .catch((caught) => active && setError(caught.message))
      .finally(() => active && setLoading(false))
    return () => { active = false }
  }, [t, updateSessionState])

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
      for (const [id, state] of Object.entries(sessionStatesRef.current)) {
        if (state.recovering || state.approvals?.length) void syncLiveSession(id)
      }
    }
    poll()
    const timer = window.setInterval(poll, 800)
    return () => { active = false; window.clearInterval(timer) }
  }, [syncLiveSession])

  const sendPrompt = async (text, requestedSessionId = activeId, attachments = [], goalMode = false) => {
    const prompt = text.trim() || (attachments.length ? t('请分析这些附件。') : '')
    if (!prompt) return
    let sessionId = requestedSessionId
    if (!sessionId) sessionId = await createSession()
    if (!sessionId) return
    if (sessionStatesRef.current[sessionId]?.streaming) return
    setActiveId(sessionId)
    setError('')
    const userMessage = { id: `user-${Date.now()}`, role: 'user', text: prompt, attachments: attachments.map(({ id, kind, name, mimeType, size, data }) => ({ id, kind, name, mimeType, size, data: kind === 'image' ? data : undefined })) }
    const agentId = `agent-${Date.now()}`
    const runStartedAt = new Date().toISOString()
    let responseText = ''
    const textScheduler = createStreamingTextScheduler((text, activityAt) => {
      updateSessionState(sessionId, (current) => ({
        ...current,
        lastActivityAt: activityAt || current.lastActivityAt,
        runNotice: '',
        messages: current.messages.map((item) => item.id === agentId ? { ...item, text } : item),
      }))
    })
    const toolScheduler = createToolUpdateScheduler((batch, activityAt) => {
      updateSessionState(sessionId, (current) => ({
        ...current,
        lastActivityAt: activityAt || current.lastActivityAt,
        tools: current.tools.map((item) => {
          const patch = batch.get(item.id)
          return patch ? { ...item, ...patch } : item
        }),
      }))
    })
    updateSessionState(sessionId, (current) => ({ ...current, messages: [...current.messages, userMessage, { id: agentId, role: 'agent', text: '', streaming: true }], tools: [], approvals: [], error: '', streaming: true, loaded: true, runStartedAt, lastActivityAt: runStartedAt, runFinishedAt: null, runStopped: false, runNotice: '' }))
    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, message: prompt, attachments, goalMode }),
      })
      await consumeEventStream(response, (event, data) => {
        const eventAt = new Date().toISOString()
        if (event === 'meta') {
          updateSessionState(sessionId, (current) => ({ ...current, model: data.model, cwd: data.cwd, permissionMode: data.permissionMode, goal: data.goal ?? null, taskList: data.taskList ?? current.taskList ?? null, runStartedAt: data.startedAt || current.runStartedAt, lastActivityAt: data.lastActivityAt || eventAt }))
          if (data.cwd || data.permissionMode || data.goal !== undefined || data.taskList !== undefined) setRemoteSessions((current) => current.map((session) => session.id === sessionId ? { ...session, cwd: data.cwd || session.cwd, permissionMode: data.permissionMode || session.permissionMode, goal: data.goal ?? session.goal ?? null, taskList: data.taskList ?? session.taskList ?? null } : session))
        } else if (event === 'text_patch') {
          responseText = applyTextPatch(responseText, data)
          textScheduler.push(responseText, eventAt)
        } else if (event === 'text_delta') {
          responseText += data.delta || ''
          textScheduler.push(responseText, eventAt)
        } else if (event === 'thinking_delta') {
          // Thinking tokens are high-frequency and only used for inactivity UI; ignore to avoid re-renders.
        } else if (event === 'tool_start') {
          textScheduler.flush()
          toolScheduler.flush()
          updateSessionState(sessionId, (current) => ({ ...current, lastActivityAt: eventAt, runNotice: '', tools: [...current.tools, { id: data.id, name: data.name, status: 'running', startedAt: data.startedAt || eventAt, updatedAt: eventAt }] }))
        } else if (event === 'tool_update') {
          toolScheduler.push(data.id, {
            message: data.message || '',
            updatedAt: data.updatedAt || eventAt,
            ...(data.agent ? { agent: data.agent } : {}),
          }, data.updatedAt || eventAt)
        } else if (event === 'tool_end') {
          toolScheduler.flush()
          updateSessionState(sessionId, (current) => ({
            ...current,
            lastActivityAt: data.finishedAt || eventAt,
            tools: current.tools.map((item) => item.id === data.id ? { ...item, status: data.error ? 'error' : 'done', message: data.message || '', updatedAt: data.finishedAt || eventAt, finishedAt: data.finishedAt || eventAt } : item),
          }))
        } else if (event === 'permission_request') {
          textScheduler.flush()
          toolScheduler.flush()
          updateSessionState(sessionId, (current) => ({ ...current, lastActivityAt: eventAt, approvals: [...(current.approvals || []).filter((item) => item.id !== data.id), data] }))
        } else if (event === 'permission_resolved') {
          updateSessionState(sessionId, (current) => ({ ...current, lastActivityAt: eventAt, approvals: (current.approvals || []).filter((item) => item.id !== data.id) }))
        } else if (event === 'generated_asset') {
          updateSessionState(sessionId, (current) => ({
            ...current,
            lastActivityAt: eventAt,
            messages: current.messages.map((item) => item.id === agentId
              ? { ...item, attachments: [...(item.attachments || []).filter((attachment) => attachment.id !== data.id), data] }
              : item),
          }))
        } else if (event === 'goal_update') {
          updateSessionState(sessionId, { goal: data.goal ?? null })
          setRemoteSessions((current) => current.map((session) => session.id === sessionId ? { ...session, goal: data.goal ?? null } : session))
        } else if (event === 'task_list_update') {
          textScheduler.flush()
          toolScheduler.flush()
          updateSessionState(sessionId, (current) => ({
            ...current,
            lastActivityAt: eventAt,
            taskList: data.taskList ?? current.taskList ?? null,
          }))
          setRemoteSessions((current) => current.map((session) => session.id === sessionId ? { ...session, taskList: data.taskList ?? session.taskList ?? null } : session))
        } else if (event === 'session_title') {
          setRemoteSessions((current) => current.map((session) => session.id === sessionId ? { ...session, name: data.name } : session))
        } else if (event === 'retry') {
          updateSessionState(sessionId, { runNotice: t('正在重试 {attempt}/{maxAttempts}：{message}', { attempt: data.attempt, maxAttempts: data.maxAttempts, message: data.message }), lastActivityAt: eventAt })
        } else if (event === 'done') {
          const finishedAt = data.finishedAt || eventAt
          if (typeof data.text === 'string') responseText = data.text
          textScheduler.cancel()
          toolScheduler.cancel()
          updateSessionState(sessionId, (current) => ({
            ...current,
            streaming: false,
            runFinishedAt: finishedAt,
            lastActivityAt: finishedAt,
            runNotice: '',
            goal: data.goal ?? current.goal ?? null,
            taskList: data.taskList ?? current.taskList ?? null,
            approvals: data.approvals || [],
            tools: settleToolCalls(data.tools || current.tools, { finishedAt }),
            messages: current.messages.map((item) => item.id === agentId ? {
              ...item,
              text: typeof data.text === 'string' ? data.text : responseText || item.text,
              streaming: false,
              ...(data.assets?.length ? { attachments: data.assets } : {}),
            } : item),
          }))
          setRemoteSessions((current) => current.map((session) => session.id === sessionId ? { ...session, streaming: false, goal: data.goal ?? session.goal ?? null, taskList: data.taskList ?? session.taskList ?? null } : session))
          return false
        } else if (event === 'error') {
          const finishedAt = data.finishedAt || eventAt
          if (typeof data.text === 'string') responseText = data.text
          textScheduler.cancel()
          toolScheduler.cancel()
          updateSessionState(sessionId, (current) => ({
            ...current,
            streaming: false,
            runFinishedAt: finishedAt,
            lastActivityAt: finishedAt,
            approvals: [],
            tools: settleToolCalls(data.tools || current.tools, { finishedAt, error: data.message }),
            messages: current.messages.map((item) => item.id === agentId ? { ...item, text: typeof data.text === 'string' ? data.text : responseText || item.text, streaming: false } : item),
          }))
          throw new Error(data.message)
        }
      })
      textScheduler.flush()
      toolScheduler.flush()
      const fallbackFinishedAt = new Date().toISOString()
      const stillStreaming = Boolean(sessionStatesRef.current[sessionId]?.streaming)
      if (stillStreaming) {
        updateSessionState(sessionId, (current) => {
          const runFinishedAt = current.runFinishedAt || fallbackFinishedAt
          return { ...current, streaming: false, runFinishedAt, lastActivityAt: runFinishedAt, runNotice: '', approvals: [], tools: settleToolCalls(current.tools, { finishedAt: runFinishedAt }), messages: current.messages.map((item) => item.id === agentId ? { ...item, streaming: false, text: responseText || item.text } : item) }
        })
      }
      // Avoid a full message reload after every run — done already carries authoritative text/tools.
      // Only reload when goal state may have changed server-side history pagination.
      if (goalMode || sessionStatesRef.current[sessionId]?.goal) {
        await loadSessionMessages(sessionId, { force: true })
      }
      let completed
      try {
        const sessions = await refreshSessions()
        completed = sessions.find((session) => session.id === sessionId)
      } catch {
        void syncLiveSession(sessionId)
      }
      browserNotify?.('chat.completed', { chat: { title: completed?.name || t('{app} 对话', { app: APP_NAME }), summary: responseText.trim().slice(0, 260) || t('Agent 已完成回复。'), model: sessionStatesRef.current[sessionId]?.model || model } })
    } catch (caught) {
      textScheduler.cancel()
      toolScheduler.cancel()
      const runFinishedAt = new Date().toISOString()
      updateSessionState(sessionId, (current) => ({ ...current, streaming: false, error: caught.message, runFinishedAt, lastActivityAt: runFinishedAt, runNotice: '', approvals: [], tools: settleToolCalls(current.tools, { finishedAt: runFinishedAt, error: caught.message }), messages: current.messages.map((item) => item.id === agentId ? { ...item, streaming: false, error: caught.message, text: item.text || responseText || caught.message } : item) }))
      setRemoteSessions((current) => current.map((session) => session.id === sessionId ? { ...session, streaming: false } : session))
    } finally {
      textScheduler.cancel()
      toolScheduler.cancel()
      updateSessionState(sessionId, { streaming: false })
      window.dispatchEvent(new Event(USAGE_UPDATED_EVENT))
    }
  }

  const abort = async (sessionId = activeId) => {
    if (!sessionId) return
    const result = await apiJson(`/api/sessions/${encodeURIComponent(sessionId)}/abort`, { method: 'POST', body: '{}' })
    const runFinishedAt = new Date().toISOString()
    updateSessionState(sessionId, (current) => ({ ...current, streaming: false, goal: result.goal ?? null, runFinishedAt, lastActivityAt: runFinishedAt, runStopped: true, runNotice: '', approvals: [], tools: settleToolCalls(current.tools, { finishedAt: runFinishedAt, error: t('已停止') }), messages: current.messages.map((item) => item.streaming ? { ...item, streaming: false } : item) }))
    setRemoteSessions((current) => current.map((session) => session.id === sessionId ? { ...session, streaming: false, goal: result.goal ?? session.goal ?? null } : session))
    notify(t('已停止当前运行'), 'info')
  }

  const pauseGoal = async (sessionId = activeId) => {
    if (!sessionId) return
    try {
      const result = await apiJson(`/api/sessions/${encodeURIComponent(sessionId)}/goal`, {
        method: 'PATCH', body: JSON.stringify({ action: 'pause' }),
      })
      updateSessionState(sessionId, { goal: result.goal || null })
      setRemoteSessions((current) => current.map((session) => session.id === sessionId ? { ...session, goal: result.goal || null } : session))
      notify(t('Goal 已暂停'), 'info')
    } catch (caught) {
      updateSessionState(sessionId, { error: caught.message })
    }
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
      notify(t('已切换至 {model}', { model: selected.label }))
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
      notify(t('权限模式已切换为{mode}', { mode: t(updated.permissionMode === 'ask' ? '询问' : updated.permissionMode === 'ignore' ? '忽略' : '自动') }))
    } catch (caught) {
      updateSessionState(sessionId, { switchingPermission: false, error: caught.message })
    }
  }

  const resolveToolApproval = async (sessionId, approvalId, approved) => {
    updateSessionState(sessionId, (current) => ({ ...current, approvals: (current.approvals || []).filter((item) => item.id !== approvalId), error: '' }))
    try {
      const resolution = await apiJson(`/api/sessions/${encodeURIComponent(sessionId)}/approvals/${encodeURIComponent(approvalId)}`, {
        method: 'POST', body: JSON.stringify({ approved }),
      })
      if (resolution.alreadyResolved) void syncLiveSession(sessionId)
    } catch (caught) {
      await syncLiveSession(sessionId)
      if (caught.status === 404) {
        notify(t('授权状态已更新'), 'info')
        return
      }
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
      notify(t('工作目录已切换至 {workspace}', { workspace: workspaceName(updated.cwd) }))
    } catch (caught) {
      updateSessionState(session.id, { switchingCwd: false, error: caught.message })
      throw caught
    }
  }

  const renameSession = async (session) => {
    const name = await requestText({ title: t('重命名会话'), inputLabel: t('会话标题'), value: session.name, confirmLabel: t('保存') })
    if (name === null || name === session.name) return
    try {
      const updated = await apiJson(`/api/sessions/${encodeURIComponent(session.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ name }),
      })
      setRemoteSessions((current) => current.map((item) => item.id === session.id ? { ...item, name: updated.name } : item))
      announceSessionsUpdated()
      notify(t('会话标题已更新'))
    } catch (caught) {
      setError(caught.message)
    }
  }

  const visible = useMemo(() => remoteSessions.filter((session) =>
    tiledSessionIds.includes(session.id) && `${session.name} ${session.firstMessage}`.toLowerCase().includes(query.toLowerCase()),
  ), [remoteSessions, query, tiledSessionIds])
  const toggleTiled = useCallback((session) => {
    setTiledSessionIds((current) => {
      const selected = current.includes(session.id)
      const next = toggleTiledSession(current, session.id)
      notify(t(selected ? '已将「{name}」移出平铺' : '已将「{name}」加入平铺', { name: session.name }), 'info')
      return next
    })
  }, [notify, t])
  const activeSession = remoteSessions.find((session) => session.id === activeId)
  const activeState = sessionStates[activeId] || { messages: [], tools: [], approvals: [], taskList: null, streaming: false, error: '', loading: false, switchingModel: false, switchingCwd: false, switchingPermission: false, messageStart: null, hasOlder: false, olderCursor: null }
  const activeModel = activeState.model || activeSession?.model || model
  const announcedModel = activeState.model || activeSession?.model || ''

  useEffect(() => {
    announceActiveSession(activeId, announcedModel)
  }, [activeId, announcedModel])

  useEffect(() => {
    document.title = activeSession?.name ? `${activeSession.name} · ${APP_NAME}` : APP_NAME
    return () => { document.title = APP_NAME }
  }, [activeSession?.name])

  return (
    <>
    <div className={`chat-layout mode-${mode} ${mode === 'focus' && railOpen ? 'rail-open' : ''}`}>
      {loading ? <Panel className="empty-state"><RefreshCw className="spin" size={24} /><h2>{t('正在唤醒 Agent')}</h2><p>{t('模型、会话与上下文正在依次归位…')}</p></Panel> : mode === 'grid' ? (
        <div className="session-grid">
          {visible.length ? visible.map((session) => <SessionCard key={session.id} session={session} state={sessionStates[session.id]} model={sessionStates[session.id]?.model || session.model || model} permissionMode={sessionStates[session.id]?.permissionMode || session.permissionMode || 'auto'} availableModels={availableModels} onModelChange={(nextModel) => switchSessionModel(session.id, nextModel)} onPermissionChange={(nextMode) => switchSessionPermission(session.id, nextMode)} onApproval={(approvalId, approved) => resolveToolApproval(session.id, approvalId, approved)} onWorkspace={() => setWorkspaceSession(session)} onOpen={() => { setActiveId(session.id); setMode('focus') }} onRename={() => renameSession(session)} onRemoveFromTiled={() => toggleTiled(session)} onSend={(value, attachments) => sendPrompt(value, session.id, attachments)} onAbort={() => abort(session.id)} />) : <TiledEmptyState hasQuery={Boolean(query)} />}
        </div>
      ) : (<>
        {railOpen && <SessionRail sessions={remoteSessions} states={sessionStates} activeId={activeId} onSelect={setActiveId} onCreate={createSession} onClose={() => setRailOpen(false)} />}
        <FocusSession session={activeSession} messages={activeState.messages} messageStart={activeState.messageStart} hasOlder={activeState.hasOlder} loadingOlder={activeState.loadingOlder} olderError={activeState.olderError} model={activeModel} permissionMode={activeState.permissionMode || activeSession?.permissionMode || 'auto'} goal={activeState.goal ?? activeSession?.goal ?? null} taskList={activeState.taskList ?? activeSession?.taskList ?? null} cwd={activeState.cwd || activeSession?.cwd} availableModels={availableModels} switchingModel={activeState.switchingModel} switchingCwd={activeState.switchingCwd} switchingPermission={activeState.switchingPermission} streaming={activeState.streaming} tools={activeState.tools} runStartedAt={activeState.runStartedAt} lastActivityAt={activeState.lastActivityAt} runFinishedAt={activeState.runFinishedAt} runStopped={activeState.runStopped} runNotice={activeState.runNotice} approvals={activeState.approvals || []} error={activeState.error || error} pendingAsset={pendingAsset} tiled={Boolean(activeSession && tiledSessionIds.includes(activeSession.id))} onAssetConsumed={onAssetConsumed} onLoadOlder={() => loadOlderMessages(activeId)} onModelChange={(nextModel) => switchSessionModel(activeId, nextModel)} onPermissionChange={(nextMode) => switchSessionPermission(activeId, nextMode)} onGoalPause={() => pauseGoal(activeId)} onApproval={(approvalId, approved) => resolveToolApproval(activeId, approvalId, approved)} onWorkspace={() => activeSession && setWorkspaceSession(activeSession)} onRename={() => activeSession && renameSession(activeSession)} onToggleTiled={() => activeSession && toggleTiled(activeSession)} onSend={sendPrompt} onAbort={() => abort(activeId)} onOpenRail={railOpen ? null : () => setRailOpen(true)} /></>)}
    </div>
    {workspaceSession && <WorkspacePicker session={workspaceSession} onClose={() => setWorkspaceSession(null)} onSelect={(cwd) => switchSessionCwd(workspaceSession, cwd)} />}
    </>
  )
}

function SessionRail({ sessions, states, activeId, onSelect, onCreate, onClose }) {
  const { t, language } = useI18n()
  const [railQuery, setRailQuery] = useState('')
  const filtered = useMemo(() => {
    const keyword = railQuery.trim().toLowerCase()
    return [...sessions]
      .sort((a, b) => Date.parse(b.modified) - Date.parse(a.modified))
      .filter((session) => !keyword || `${session.name} ${session.firstMessage || ''}`.toLowerCase().includes(keyword))
  }, [sessions, railQuery])
  return (
    <aside className="session-rail" aria-label={t('会话列表')}>
      <div className="session-rail-head">
        <strong>{t('会话')}</strong>
        <button className="icon-button" title={t('新会话')} aria-label={t('新会话')} onClick={onCreate}><Plus size={15} /></button>
        <button className="icon-button" title={t('收起会话列表')} aria-label={t('收起会话列表')} onClick={onClose}><PanelLeftClose size={15} /></button>
      </div>
      <label className="session-rail-search"><Search size={13} /><input value={railQuery} onChange={(event) => setRailQuery(event.target.value)} placeholder={t('搜索会话')} /></label>
      <div className="session-rail-list">
        {filtered.map((session) => {
          const streaming = Boolean(states[session.id]?.streaming)
          return <button className={`session-rail-item ${session.id === activeId ? 'active' : ''}`} key={session.id} onClick={() => onSelect(session.id)}>
            <span className="session-rail-item-name">{streaming && <i className="session-rail-live" />}{session.name || t('未命名会话')}</span>
            <span className="session-rail-item-meta">{streaming ? t('Agent 运行中') : t('{count} 条消息', { count: session.messageCount || 0 })} · {relativeTime(session.modified, language)}</span>
          </button>
        })}
        {!filtered.length && <span className="session-rail-empty">{t(railQuery.trim() ? '没有匹配的会话' : '暂无历史会话')}</span>}
      </div>
    </aside>
  )
}

function TaskListPanel({ taskList, compact = false }) {
  const { t } = useI18n()
  const [expanded, setExpanded] = useState(!compact)
  const items = taskList?.items || EMPTY_LIST
  if (!items.length) return null
  const visibleItems = compact ? items.slice(0, 3) : items
  const completed = taskList?.counts?.completed ?? items.filter((item) => item.status === 'completed').length
  const statusMeta = {
    pending: { label: t('待处理'), icon: <Circle size={compact ? 11 : 13} />, tone: 'text-[var(--muted)]' },
    in_progress: { label: t('进行中'), icon: <RefreshCw className="spin" size={compact ? 11 : 13} />, tone: 'text-[var(--accent-strong)]' },
    completed: { label: t('已完成'), icon: <Check size={compact ? 11 : 13} />, tone: 'text-[var(--success)]' },
    blocked: { label: t('已阻塞'), icon: <AlertTriangle size={compact ? 11 : 13} />, tone: 'text-[var(--danger)]' },
  }
  return <section className={`task-list-panel ${compact ? 'compact' : ''}`} aria-label={t('任务清单')}>
    <button type="button" className="task-list-panel-summary" onClick={() => setExpanded((value) => !value)} aria-expanded={expanded}>
      <ListChecks size={14} className="shrink-0 text-[var(--muted)]" />
      <strong className="min-w-0 flex-1 truncate">{t('任务清单')}</strong>
      <small className="text-[11px] text-[var(--muted)]">{t('{completed}/{total} 已完成', { completed, total: items.length })}</small>
      <ChevronRight size={13} className={`text-[var(--muted)] transition-transform ${expanded ? 'rotate-90' : ''}`} />
    </button>
    {expanded && <div className={`task-list-panel-body ${compact ? 'compact' : ''}`}>
      {visibleItems.map((item) => {
        const meta = statusMeta[item.status] || statusMeta.pending
        return <div className="task-list-item" key={item.id}>
          <span className={`task-list-item-status ${meta.tone}`} title={meta.label}>{meta.icon}</span>
          <span className={`task-list-item-title ${item.status === 'completed' ? 'is-completed' : ''}`} title={item.note || item.title}>{item.title}</span>
        </div>
      })}
      {compact && items.length > visibleItems.length && <small className="task-list-more">{t('还有 {count} 项', { count: items.length - visibleItems.length })}</small>}
    </div>}
  </section>
}

function SessionCard({ session, state, model, permissionMode, availableModels, onModelChange, onPermissionChange, onApproval, onWorkspace, onOpen, onRename, onRemoveFromTiled, onSend, onAbort }) {
  const { t, language } = useI18n()
  const [value, setValue] = useState('')
  const selection = useAttachmentSelection()
  const messages = (state?.messages || EMPTY_LIST).slice(-GRID_MESSAGE_PAGE_SIZE)
  const tools = state?.tools || EMPTY_LIST
  const taskList = state?.taskList ?? session.taskList ?? null
  const streaming = Boolean(state?.streaming)
  const lastMessage = messages[messages.length - 1]
  const liveTextBucket = Math.floor((lastMessage?.text?.length || 0) / 64)
  const liveVersion = `${session.id}:${lastMessage?.id || ''}:${liveTextBucket}:${lastMessage?.attachments?.length || 0}:${tools.map((tool) => `${tool.id}:${tool.status}`).join('|')}:${taskList?.updatedAt || ''}:${state?.error || ''}:${streaming ? '1' : '0'}`
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
      <div className="card-head"><button className="session-title-button" onClick={onOpen}><h3 title={session.name}>{session.name}</h3><span className={streaming ? 'success' : ''}>{streaming ? t('Agent 运行中') : t('{count} 条消息', { count: session.messageCount || messages.length })} · {relativeTime(session.modified, language)}</span><small className="workspace-summary" title={state?.cwd || session.cwd}><FolderOpen size={10} />{workspaceName(state?.cwd || session.cwd, language)}</small></button><div className="card-head-actions"><button className="icon-button" title={t('设置工作目录')} onClick={onWorkspace} disabled={streaming || state?.switchingCwd}><FolderOpen size={14} /></button><button className="icon-button" title={t('重命名会话')} onClick={onRename}><Pencil size={14} /></button><button className="icon-button" title={t('移出平铺')} aria-label={t('将 {name} 移出平铺', { name: session.name })} onClick={onRemoveFromTiled}><X size={14} /></button>{streaming ? <button className="button danger tiny" onClick={onAbort}><Square size={11} />{t('停止')}</button> : <button className="icon-button" onClick={onOpen}><MoreHorizontal size={17} /></button>}</div></div>
      <TaskListPanel taskList={taskList} compact />
      <div className="session-live-body" ref={liveRef} onScroll={onLiveScroll}>
        {state?.loading && !messages.length ? <div className="session-live-empty"><RefreshCw className="spin" size={16} />{t('加载消息…')}</div> : !messages.length ? <button className="session-live-empty" onClick={onOpen}><Bot size={17} />{t('从一束新的想法开始')}</button> : messages.map((message) => <MiniChatMessage key={message.id} message={message} />)}
        {(streaming || state?.runStartedAt) && <AgentRunActivity compact streaming={streaming} text={lastMessage?.role === 'agent' ? lastMessage.text : ''} tools={tools} error={state?.error} stopped={state?.runStopped} notice={state?.runNotice} startedAt={state?.runStartedAt} lastActivityAt={state?.lastActivityAt} finishedAt={state?.runFinishedAt} />}
        {state?.error && <div className="mini-session-error"><AlertTriangle size={11} />{state.error}</div>}
      </div>
      <form className="mini-composer-shell" onSubmit={submit}>
        <ToolApproval approvals={state?.approvals || EMPTY_LIST} onResolve={onApproval} compact />
        <AttachmentTray attachments={selection.attachments} onRemove={selection.removeAttachment} compact />
        {selection.attachmentError && <span className="attachment-error">{selection.attachmentError}</span>}
        <div className="mini-composer"><button type="button" className="attach-trigger" title={t('添加附件')} aria-label={t('添加附件')} onClick={() => selection.inputRef.current?.click()} disabled={streaming}><Paperclip size={14} />{selection.attachments.length > 0 && <i>{selection.attachments.length}</i>}</button><input ref={selection.inputRef} className="sr-only" type="file" multiple accept="image/*,.txt,.md,.json,.js,.jsx,.ts,.tsx,.css,.html,.xml,.yaml,.yml,.csv,.log,.py,.java,.go,.rs,.sh,.ps1,.toml,.sql,.pdf,.docx,.pptx,.xlsx,.odt,.odp,.ods,.rtf,.epub" onChange={selection.chooseFiles} /><input value={value} onChange={(event) => setValue(event.target.value)} onPaste={selection.pasteImages} placeholder={t(streaming ? 'Agent 正在运行…' : '写下你的想法，或带上一份附件…')} disabled={streaming} /><SessionModelSelect value={model} models={availableModels} onChange={onModelChange} disabled={streaming || state?.switchingModel} compact /><PermissionModeSelect value={permissionMode} onChange={onPermissionChange} disabled={state?.switchingPermission} compact />{streaming ? <button type="button" className="send-mini stop" title={t('停止运行')} aria-label={t('停止运行')} onClick={onAbort}><Square size={12} /></button> : <button className="send-mini" title={t('发送消息')} aria-label={t('发送消息')} disabled={!value.trim() && !selection.attachments.length}><Send size={13} /></button>}</div>
      </form>
    </Panel>
  )
}

function SessionModelSelect({ value, models, onChange, disabled, compact = false }) {
  const { t } = useI18n()
  const currentModel = models.find((model) => model.key === value)
  const hasCurrentModel = Boolean(currentModel)
  const currentLabel = currentModel ? `${currentModel.providerName} · ${currentModel.label}` : value.split('/').at(-1)
  return (
    <label className={`session-model-select icon-only ${compact ? 'compact' : ''}`} title={t(disabled ? '当前模型：{model}（运行期间不可切换）' : '当前模型：{model}，点击切换', { model: currentLabel })}>
      <Bot size={compact ? 11 : 14} />
      <select value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled || models.length === 0} aria-label={t('当前会话模型')}>
        {!hasCurrentModel && <option value={value}>{value.split('/').at(-1)}</option>}
        {models.map((model) => <option key={model.key} value={model.key}>{model.providerName} · {model.label}</option>)}
      </select>
    </label>
  )
}

function welcomeChips(t) {
  return [
    { label: t('解释代码'), prompt: t('解释这段代码的工作原理：') },
    { label: t('写单测'), prompt: t('为以下代码编写单元测试：') },
    { label: t('重构'), prompt: t('重构这段代码并说明改进点：') },
    { label: t('查 bug'), prompt: t('帮我定位并修复这个 bug：') },
  ]
}

function permissionOptions(t) {
  return [
    ['ask', t('询问'), t('敏感工具执行前需要确认')],
    ['auto', t('自动'), t('自动执行，危险操作仍会询问')],
    ['ignore', t('忽略'), t('跳过额外审批，仅受已启用工具限制')],
  ]
}

function PermissionModeSelect({ value, onChange, disabled, compact = false }) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const [menuPosition, setMenuPosition] = useState({ left: 0, top: 0, width: 250 })
  const rootRef = useRef(null)
  const menuRef = useRef(null)
  const options = permissionOptions(t)
  const current = options.find((item) => item[0] === value) || options[1]
  const positionMenu = useCallback(() => {
    const trigger = rootRef.current?.querySelector('button')
    if (!trigger) return
    const rect = trigger.getBoundingClientRect()
    const edge = 8
    const gap = 8
    const width = Math.min(250, window.innerWidth - edge * 2)
    const height = menuRef.current?.offsetHeight || 180
    const left = Math.max(edge, Math.min(rect.right - width, window.innerWidth - width - edge))
    const top = rect.top >= height + gap + edge
      ? rect.top - height - gap
      : Math.min(rect.bottom + gap, window.innerHeight - height - edge)
    setMenuPosition({ left, top: Math.max(edge, top), width })
  }, [])
  useLayoutEffect(() => {
    if (!open) return undefined
    positionMenu()
    window.addEventListener('resize', positionMenu)
    window.addEventListener('scroll', positionMenu, true)
    return () => {
      window.removeEventListener('resize', positionMenu)
      window.removeEventListener('scroll', positionMenu, true)
    }
  }, [open, positionMenu])
  useEffect(() => {
    if (!open) return undefined
    const close = (event) => {
      if (!rootRef.current?.contains(event.target) && !menuRef.current?.contains(event.target)) setOpen(false)
    }
    const escape = (event) => { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', escape)
    return () => { document.removeEventListener('mousedown', close); document.removeEventListener('keydown', escape) }
  }, [open])
  const menu = open && createPortal(<div ref={menuRef} className="permission-mode-menu !fixed !right-auto !bottom-auto z-[80]" style={menuPosition} role="menu">{options.map(([mode, label, description]) => <button type="button" role="menuitemradio" aria-checked={mode === current[0]} className={mode === current[0] ? 'active' : ''} onClick={() => { onChange(mode); setOpen(false) }} key={mode}><span className={`permission-level level-${mode}`}><ShieldCheck size={13} /></span><span><strong>{label}</strong><small>{description}</small></span>{mode === current[0] && <Check size={13} />}</button>)}</div>, document.body)
  return <><div ref={rootRef} className={`permission-mode-select icon-only ${compact ? 'compact' : ''} ${open ? 'open' : ''}`}><button type="button" className={`permission-mode-trigger icon-only mode-${current[0]}`} title={t('权限模式：{mode}——{description}', { mode: current[1], description: current[2] })} disabled={disabled} aria-haspopup="menu" aria-expanded={open} aria-label={t('权限模式：{mode}', { mode: current[1] })} onClick={() => setOpen((visible) => !visible)}><ShieldCheck size={compact ? 11 : 14} /></button></div>{menu}</>
}

function ToolApproval({ approvals, onResolve, compact = false }) {
  const { t } = useI18n()
  const [resolving, setResolving] = useState(false)
  const resolvingRef = useRef(false)
  const approval = approvals[0]
  if (!approval) return null
  const resolve = async (approved) => {
    if (resolvingRef.current) return
    resolvingRef.current = true
    setResolving(true)
    try { await onResolve(approval.id, approved) } finally { resolvingRef.current = false; setResolving(false) }
  }
  return <div className={`tool-approval ${compact ? 'compact' : ''}`}><div><ShieldCheck size={compact ? 12 : 15} /><span><strong>{t('{tool} 请求授权', { tool: approval.toolName })}</strong><small>{approval.reason}{approvals.length > 1 ? ` · ${t('另有 {count} 项等待', { count: approvals.length - 1 })}` : ''}</small></span></div>{!compact && <details><summary>{t('查看调用参数')}</summary><pre>{JSON.stringify(approval.args, null, 2)}</pre></details>}<div className="tool-approval-actions"><button type="button" className="button secondary" disabled={resolving} onClick={() => resolve(false)}>{t('拒绝')}</button><button type="button" className="button primary" disabled={resolving} onClick={() => resolve(true)}>{resolving ? <RefreshCw className="spin" size={12} /> : <Check size={12} />}{t('允许')}</button></div></div>
}

function WorkspacePicker({ session, onClose, onSelect }) {
  const { t } = useI18n()
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
      <section className="modal workspace-modal" role="dialog" aria-modal="true" aria-label={t('设置会话工作目录')}>
        <div className="card-head"><div><h2>{t('设置工作目录')}</h2><p>{t('{name} 的工具和 Agent 将在此目录运行', { name: session.name })}</p></div><button className="icon-button" aria-label={t('关闭对话框')} onClick={onClose}><X size={17} /></button></div>
        <form className="workspace-path-form" onSubmit={(event) => { event.preventDefault(); browse(path) }}>
          <FolderOpen size={15} />
          <input value={path} onChange={(event) => setPath(event.target.value)} placeholder={t('输入项目的绝对路径')} autoFocus />
          <button className="button secondary" disabled={loading}>{loading ? <RefreshCw className="spin" size={13} /> : t('转到')}</button>
        </form>
        <div className="directory-browser">
          {listing?.parent && <button onClick={() => browse(listing.parent)}><FolderOpen size={14} /><span>..</span><small>{t('上级目录')}</small></button>}
          {listing?.directories.map((directory) => <button key={directory.path} onClick={() => browse(directory.path)}><FolderOpen size={14} /><span>{directory.name}</span><ChevronRight size={13} /></button>)}
          {!loading && listing && !listing.directories.length && <div className="directory-empty">{t('此目录没有子文件夹')}</div>}
          {loading && <div className="directory-empty"><RefreshCw className="spin" size={16} />{t('正在读取目录…')}</div>}
        </div>
        {error && <div className="config-error"><AlertTriangle size={13} />{error}</div>}
        <div className="modal-actions"><button className="button secondary" onClick={onClose}>{t('取消')}</button><button className="button primary" onClick={choose} disabled={saving || loading || !path.trim()}>{saving ? <RefreshCw className="spin" size={14} /> : <Check size={14} />}{t(saving ? '切换中…' : '选择此目录')}</button></div>
      </section>
    </div>
  )
}

function FocusSession({ session, messages, messageStart, hasOlder, loadingOlder, olderError, model, permissionMode, goal, taskList, cwd, availableModels, switchingModel, switchingCwd, switchingPermission, streaming, tools, runStartedAt, lastActivityAt, runFinishedAt, runStopped, runNotice, approvals, error, pendingAsset, tiled, onAssetConsumed, onLoadOlder, onModelChange, onPermissionChange, onGoalPause, onApproval, onWorkspace, onRename, onToggleTiled, onSend, onAbort, onOpenRail }) {
  const { t, language } = useI18n()
  const [value, setValue] = useState('')
  const [goalArmed, setGoalArmed] = useState(false)
  const selection = useAttachmentSelection()
  const addSelectedAttachments = selection.addAttachments
  const promptRef = useRef(null)
  const prependSnapshot = useRef(null)
  const lastMessage = messages[messages.length - 1]
  // Bucket streaming text length so auto-scroll does not fire on every token.
  const textScrollBucket = Math.floor((lastMessage?.text?.length || 0) / 64)
  const toolsVersion = tools.map((tool) => `${tool.id}:${tool.status}`).join('|')
  const transcriptVersion = `${session?.id || ''}:${lastMessage?.id || ''}:${textScrollBucket}:${lastMessage?.attachments?.length || 0}:${toolsVersion}:${taskList?.updatedAt || ''}:${goal?.status || ''}:${goal?.tokensUsed || 0}:${error || ''}:${streaming ? '1' : '0'}`
  const { scrollRef: transcriptRef, onScroll: onTranscriptScroll, hasUnread, scrollToBottom } = useAutoScroll(transcriptVersion)
  const latestRunProps = useMemo(() => ({
    streaming,
    text: lastMessage?.role === 'agent' ? lastMessage.text : '',
    tools,
    error: error || (lastMessage?.role === 'agent' ? lastMessage.error : ''),
    stopped: runStopped,
    notice: runNotice,
    startedAt: runStartedAt,
    lastActivityAt,
    finishedAt: runFinishedAt,
  }), [streaming, lastMessage, tools, error, runStopped, runNotice, runStartedAt, lastActivityAt, runFinishedAt])
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
    setGoalArmed(false)
  }, [session?.id])
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
    onSend(value, undefined, selection.attachments, goalArmed)
    scrollToBottom('smooth')
    setValue('')
    setGoalArmed(false)
    if (promptRef.current) promptRef.current.style.height = 'auto'
    selection.clearAttachments()
  }
  return (
    <Panel className="focus-session">
      <div className="card-head"><div className="session-runtime-meta">{onOpenRail && <button className="icon-button session-rail-open-btn" title={t('展开会话列表')} aria-label={t('展开会话列表')} onClick={onOpenRail}><PanelLeftOpen size={15} /></button>}<span className={streaming ? 'success' : ''}>{t(streaming ? 'Agent 运行中' : '等待输入')}</span><button className="workspace-chip" title={cwd} onClick={onWorkspace} disabled={streaming || switchingCwd}><FolderOpen size={11} />{workspaceName(cwd, language)}</button></div><div className="focus-session-head-actions">{streaming && <button className="button danger tiny" onClick={onAbort}><Square size={12} />{t('停止')}</button>}<SessionActionsMenu session={session} tiled={tiled} streaming={streaming} switchingCwd={switchingCwd} onToggleTiled={onToggleTiled} onWorkspace={onWorkspace} onRename={onRename} /></div></div>
      {/* Keep the plan/task list outside the auto-scrolling transcript so it stays visible while tokens stream. */}
      <TaskListPanel taskList={taskList} />
      <div className="transcript" ref={transcriptRef} onScroll={handleTranscriptScroll}>
        {(hasOlder || loadingOlder || olderError) && <div className="history-page-loader">{olderError ? <button type="button" className="button secondary" onClick={loadOlder}><RefreshCw size={13} />{t('重试加载更早消息')}</button> : loadingOlder ? <><RefreshCw className="spin" size={14} />{t('正在加载更早消息…')}</> : <button type="button" className="button secondary" onClick={loadOlder}><ArrowDown className="history-up-arrow" size={14} />{t('加载更早消息')}</button>}</div>}
        {!messages.length && <div className="agent-welcome"><BrandLogo size={44} className="welcome-logo" /><h2>{t('让我们从一束想法开始')}</h2><p>{t('Vesper 已准备好读取当前工作区、搜索代码，并陪你把任务推进到完成。默认从只读权限开始。')}</p><div className="welcome-chips">{welcomeChips(t).map((chip) => <button type="button" key={chip.label} onClick={() => applyWelcomeChip(chip.prompt)}>{chip.label}</button>)}</div></div>}
        {messages.map((message, index) => {
          const isLatestAgent = message.role === 'agent' && index === messages.length - 1
          const agentState = message.streaming || (isLatestAgent && streaming) ? 'thinking' : isLatestAgent && !message.error ? 'waiting' : 'idle'
          const showRunActivity = isLatestAgent && (streaming || runStartedAt)
          return <FocusChatMessage
            key={message.id}
            message={message}
            agentState={agentState}
            showRunActivity={showRunActivity}
            runProps={showRunActivity ? latestRunProps : null}
          />
        })}
        {error && <div className="chat-error"><AlertTriangle size={14} />{error}</div>}
      </div>
      {hasUnread && <button type="button" className="button secondary jump-to-latest" onClick={() => scrollToBottom('smooth')}><ArrowDown size={14} />{t('有新内容')}</button>}
      <form className="focus-composer-shell" onSubmit={submit}><ToolApproval approvals={approvals} onResolve={onApproval} /><AttachmentTray attachments={selection.attachments} onRemove={selection.removeAttachment} />{selection.attachmentError && <span className="attachment-error">{selection.attachmentError}</span>}<div className="focus-composer"><button type="button" className="attach-trigger" title={t('添加附件')} aria-label={t('添加附件')} onClick={() => selection.inputRef.current?.click()} disabled={streaming}><Paperclip size={17} />{selection.attachments.length > 0 && <i>{selection.attachments.length}</i>}</button><input ref={selection.inputRef} className="sr-only" type="file" multiple accept="image/*,.txt,.md,.json,.js,.jsx,.ts,.tsx,.css,.html,.xml,.yaml,.yml,.csv,.log,.py,.java,.go,.rs,.sh,.ps1,.toml,.sql,.pdf,.docx,.pptx,.xlsx,.odt,.odp,.ods,.rtf,.epub" onChange={selection.chooseFiles} /><SessionModelSelect value={model} models={availableModels} onChange={onModelChange} disabled={streaming || switchingModel} /><PermissionModeSelect value={permissionMode} onChange={onPermissionChange} disabled={switchingPermission} /><GoalModeControl goal={goal} armed={goalArmed} onChange={(enabled) => { if (!enabled && goal?.status === 'active') void onGoalPause?.(); else setGoalArmed(enabled) }} /><textarea ref={promptRef} rows="1" value={value} onChange={(event) => { setValue(event.target.value); event.currentTarget.style.height = 'auto'; event.currentTarget.style.height = `${Math.min(event.currentTarget.scrollHeight, 220)}px` }} onPaste={selection.pasteImages} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit() } }} placeholder={t(streaming ? 'Agent 正在运行，可停止后继续输入' : '写下你想完成的事，Shift + Enter 换行')} disabled={streaming} /><button className="send-button" title={t('发送消息')} aria-label={t('发送消息')} disabled={(!value.trim() && !selection.attachments.length) || streaming}><Send size={18} /></button></div></form>
    </Panel>
  )
}

function GoalModeControl({ goal, armed, onChange }) {
  const { t } = useI18n()
  const [open, setOpen] = useState(false)
  const rootRef = useRef(null)
  const active = goal?.status === 'active'
  const enabled = active || armed
  const status = active
    ? t('正在自动执行')
    : armed
      ? t(goal?.status === 'paused' ? '下一条消息将继续 Goal' : '下一条消息将启动 Goal')
      : goal?.status === 'complete'
        ? t('Goal 已完成')
        : goal?.status === 'budget_limited'
          ? t('Goal 已达到预算')
          : goal?.status === 'paused'
            ? t('Goal 已暂停')
            : t('仅对下一条消息启用')
  const objective = String(goal?.objective || '').replace(/\s+/g, ' ').trim()
  const detail = armed ? status : objective || status
  const usage = active ? t('已用 {used}/{budget} tokens', { used: goal.tokensUsed || 0, budget: goal.tokenBudget || 0 }) : ''
  const label = [t('Goal 模式'), detail, usage].filter(Boolean).join(' · ')

  useEffect(() => {
    if (!open) return undefined
    const close = (event) => { if (!rootRef.current?.contains(event.target)) setOpen(false) }
    const escape = (event) => { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', escape)
    }
  }, [open])

  const change = (next) => {
    onChange(next)
    setOpen(false)
  }

  return <div ref={rootRef} className={`goal-mode-select ${open ? 'open' : ''} ${active || armed ? 'active' : ''}`}><button type="button" className="goal-mode-trigger" title={label} aria-label={label} aria-haspopup="dialog" aria-expanded={open} onClick={() => setOpen((visible) => !visible)}><Target size={14} /></button>{open && <div className="goal-mode-menu" role="dialog" aria-label={t('Goal 模式')}><div className="goal-mode-menu-row"><span className="goal-mode-menu-icon"><Target size={15} /></span><span><strong>{t('Goal 模式')}</strong><small title={detail}>{detail}</small></span><Toggle value={enabled} onChange={change} ariaLabel={label} title={label} /></div>{active && <p>{usage}</p>}</div>}</div>
}

function SessionActionsMenu({ session, tiled, streaming, switchingCwd, onToggleTiled, onWorkspace, onRename }) {
  const { t, language } = useI18n()
  const [open, setOpen] = useState(false)
  const rootRef = useRef(null)

  useEffect(() => {
    if (!open) return undefined
    const close = (event) => { if (!rootRef.current?.contains(event.target)) setOpen(false) }
    const escape = (event) => { if (event.key === 'Escape') setOpen(false) }
    document.addEventListener('mousedown', close)
    document.addEventListener('keydown', escape)
    return () => {
      document.removeEventListener('mousedown', close)
      document.removeEventListener('keydown', escape)
    }
  }, [open])

  const run = (action) => {
    setOpen(false)
    action?.()
  }

  return <div ref={rootRef} className="session-actions-menu-root"><button type="button" className="icon-button" title={t('会话操作')} aria-label={t('打开会话操作菜单')} aria-haspopup="menu" aria-expanded={open} disabled={!session} onClick={() => setOpen((visible) => !visible)}><MoreHorizontal size={17} /></button>{open && <div className="permission-mode-menu session-actions-menu" role="menu"><button type="button" role="menuitem" onClick={() => run(onToggleTiled)}><Grid2X2 size={15} /><span><strong>{t(tiled ? '移出平铺' : '加入平铺')}</strong><small>{t(tiled ? '保留历史记录，仅从平铺视图移除' : '在平铺模式中并行关注此会话')}</small></span>{tiled && <Check size={13} />}</button><button type="button" role="menuitem" disabled={streaming || switchingCwd} onClick={() => run(onWorkspace)}><FolderOpen size={15} /><span><strong>{t('设置工作目录')}</strong><small>{streaming ? t('Agent 运行期间不能切换') : workspaceName(session?.cwd, language)}</small></span></button><button type="button" role="menuitem" onClick={() => run(onRename)}><Pencil size={15} /><span><strong>{t('重命名会话')}</strong><small>{session?.name || t('新会话')}</small></span></button></div>}</div>
}

function CommandPalette({ navigation, onClose, onNavigate, onOpenSession, onNewChat }) {
  const { t, language } = useI18n()
  const [query, setQuery] = useState('')
  const [sessions, setSessions] = useState([])
  const [activeIndex, setActiveIndex] = useState(0)

  useEffect(() => {
    let active = true
    apiJson('/api/sessions')
      .then((data) => { if (active) setSessions(data.sessions || []) })
      .catch(() => {})
    return () => { active = false }
  }, [])

  const entries = useMemo(() => {
    const keyword = query.trim().toLocaleLowerCase(language)
    const matches = (...values) => !keyword || values.some((value) => String(value || '').toLocaleLowerCase(language).includes(keyword))
    const result = []
    const newChatLabel = t('新会话')
    if (matches(newChatLabel, t('操作'))) result.push({ id: 'action:new-chat', Icon: Plus, label: newChatLabel, hint: t('操作'), run: onNewChat })
    for (const [group, items] of navigation) {
      for (const [id, label, Icon] of items) {
        if (matches(label, group, id)) result.push({ id: `page:${id}`, Icon, label, hint: group, run: () => onNavigate(id) })
      }
    }
    for (const session of [...sessions].sort((a, b) => Date.parse(b.modified) - Date.parse(a.modified))) {
      if (!matches(session.name, session.firstMessage)) continue
      result.push({ id: `session:${session.id}`, Icon: MessageSquare, label: session.name || t('未命名会话'), hint: relativeTime(session.modified, language), run: () => onOpenSession(session.id) })
      if (result.filter((entry) => entry.id.startsWith('session:')).length >= 8) break
    }
    return result
  }, [language, navigation, onNavigate, onNewChat, onOpenSession, query, sessions, t])

  useEffect(() => { setActiveIndex(0) }, [query])
  const selectedIndex = Math.min(activeIndex, Math.max(0, entries.length - 1))
  const runEntry = (entry) => {
    if (!entry) return
    onClose()
    entry.run()
  }
  const onKeyDown = (event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActiveIndex((current) => entries.length ? (current + 1) % entries.length : 0)
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActiveIndex((current) => entries.length ? (current - 1 + entries.length) % entries.length : 0)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      runEntry(entries[selectedIndex])
    } else if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
    }
  }

  return <div className="modal-backdrop palette-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <section className="command-palette" role="dialog" aria-modal="true" aria-label={t('命令面板')}>
      <label className="palette-input"><Search size={16} /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} onKeyDown={onKeyDown} placeholder={t('搜索页面、会话或操作')} /><kbd>Esc</kbd></label>
      <div className="palette-list" role="listbox" aria-label={t('命令面板')}>
        {entries.map((entry, index) => <button type="button" className={`palette-item ${index === selectedIndex ? 'active' : ''}`} role="option" aria-selected={index === selectedIndex} onMouseEnter={() => setActiveIndex(index)} onClick={() => runEntry(entry)} key={entry.id}><entry.Icon size={15} /><span className="palette-item-label">{entry.label}</span><span className="palette-item-hint">{entry.hint}</span></button>)}
        {!entries.length && <div className="palette-empty">{t('无匹配结果')}</div>}
      </div>
    </section>
  </div>
}

function QuickCreate({ type, close, notify }) {
  const { t } = useI18n()
  const titles = { chat: t('新建会话'), assets: t('导出资产'), channels: t('连接渠道'), schedules: t('新建定时任务'), config: t('添加 Provider'), plugins: t('保存插件策略'), memory: t('点亮星辰'), mcp: t('添加 MCP 服务'), skills: t('安装技能') }
  return <div className="modal-backdrop" onMouseDown={close}><form className="modal" onMouseDown={(e) => e.stopPropagation()} onSubmit={(e) => { e.preventDefault(); notify(t('{action}成功', { action: titles[type] })); close() }}><div className="card-head"><div><h2>{titles[type]}</h2><p>{t('填写基本信息后即可继续配置。')}</p></div><button type="button" className="icon-button" aria-label={t('关闭对话框')} onClick={close}><X size={17} /></button></div><InputLabel label={t('名称')} value="" placeholder={t('输入名称')} /><InputLabel label={t('描述')} value="" placeholder={t('补充简短描述')} /><SelectLabel label={t('类型')} options={[t('默认'), t('自定义'), t('从模板创建')]} /><div className="modal-actions"><button type="button" className="button secondary" onClick={close}>{t('取消')}</button><button className="button primary"><Plus size={14} />{t('确认创建')}</button></div></form></div>
}

function AttachmentTray({ attachments, onRemove, compact = false }) {
  const { t } = useI18n()
  if (!attachments.length) return null
  return <div className={`attachment-tray ${compact ? 'compact' : ''}`}>{attachments.map((attachment) => <div className="attachment-chip" key={attachment.id}>{attachment.kind === 'image' ? <img src={`data:${attachment.mimeType};base64,${attachment.data}`} alt="" /> : <span className="attachment-icon"><File size={13} /></span>}<span><strong>{attachment.name}</strong><small>{t(attachment.kind === 'image' ? '图片' : attachment.kind === 'document' ? '文档' : '文本')} · {formatFileSize(attachment.size)}{attachment.truncated ? ` · ${t('已截断')}` : ''}</small></span><button type="button" aria-label={t('移除 {name}', { name: attachment.name })} onClick={() => onRemove(attachment.id)}><X size={12} /></button></div>)}</div>
}

function TiledEmptyState({ hasQuery }) { const { t } = useI18n(); return <Panel className="empty-state"><StarOrbit size={48} /><h2>{t(hasQuery ? '没有匹配的平铺会话' : '这片视野里还没有会话')}</h2><p>{t(hasQuery ? '更换搜索关键词，或从历史会话中加入其他会话。' : '从历史会话点亮「平铺」，让不同任务在同一片视野中并行前行。')}</p></Panel> }

export default App
