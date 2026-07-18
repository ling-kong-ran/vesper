import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import {
  AlertTriangle,
  Bell,
  Bot,
  Brain,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleDot,
  Clock3,
  Code2,
  Copy,
  Download,
  Eye,
  ExternalLink,
  File,
  FileCode2,
  FileImage,
  FileVideo,
  FolderOpen,
  GitBranch,
  Grid2X2,
  Image,
  KeyRound,
  Link2,
  Menu,
  MessageSquare,
  MoreHorizontal,
  Network,
  Package,
  Paperclip,
  Pencil,
  Play,
  Plus,
  RefreshCw,
  Rocket,
  Save,
  Search,
  Send,
  Server,
  ShieldCheck,
  Sparkles,
  Square,
  Trash2,
  Upload,
  Wrench,
  X,
  Zap,
} from 'lucide-react'
import { NAV_ITEMS, PAGE_META } from './app/navigation.jsx'
import { Badge, InputLabel, Metric, Panel, SectionTitle, Segmented, SelectLabel, Toggle } from './components/ui.jsx'
import { useAttachmentSelection } from './features/chat/attachments.js'
import { PluginsPage } from './features/plugins/PluginsPage.jsx'
import { ChannelsPage } from './features/channels/ChannelsPage.jsx'
import { NotificationSettings } from './features/config/NotificationSettings.jsx'
import { MemoryPage } from './features/memory/MemoryPage.jsx'
import { SchedulesPage } from './features/schedules/SchedulesPage.jsx'
import { apiJson, consumeEventStream } from './lib/api.js'
import { formatFileSize, formatTokenCount, relativeTime, workspaceName } from './lib/format.js'

const toolRows = [
  ['get_editor_state', 'Pencil · 读取画布状态', '低风险', true],
  ['batch_design', 'Pencil · 修改 .pen 文件', '高风险', true],
  ['read_file', 'Filesystem · 读取工作区文件', '中风险', true],
  ['write_file', 'Filesystem · 写入文件', '高风险', true],
  ['create_issue', 'GitHub · 创建 issue', '中风险', false],
  ['search_docs', 'Hermes Docs · 搜索文档', '低风险', true],
  ['query_table', 'Database · 读取数据表', '高风险', false],
]

const skillInstalled = [
  ['imagegen', '生成或编辑位图视觉资产', Image, true],
  ['openai-docs', '官方 OpenAI 文档查询', FileCode2, true],
  ['plugin-creator', '创建 Codex 插件结构', Package, true],
  ['skill-creator', '创建和维护技能', Wrench, true],
  ['skill-installer', '从市场安装技能', Upload, false],
]

const EMPTY_LIST = []

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

function App() {
  const initialPage = window.location.hash.slice(1)
  const [page, setPage] = useState(PAGE_META[initialPage] ? initialPage : 'chat')
  const [chatMode, setChatModeState] = useState(() => localStorage.getItem('pi-coder-chat-mode') || 'focus')
  const [query, setQuery] = useState('')
  const [mobileNav, setMobileNav] = useState(false)
  const [toast, setToast] = useState('')
  const [modal, setModal] = useState(null)
  const [chatCreateSignal, setChatCreateSignal] = useState(0)
  const [configCreateSignal, setConfigCreateSignal] = useState(0)
  const [configSection, setConfigSection] = useState('models')
  const [assetUploadSignal, setAssetUploadSignal] = useState(0)
  const [pluginSaveSignal, setPluginSaveSignal] = useState(0)
  const [channelCreateSignal, setChannelCreateSignal] = useState(0)
  const [scheduleCreateSignal, setScheduleCreateSignal] = useState(0)
  const [memoryCreateSignal, setMemoryCreateSignal] = useState(0)
  const [pendingAsset, setPendingAsset] = useState(null)
  const [usage, setUsage] = useState(null)
  const [pluginStats, setPluginStats] = useState(null)
  const [startupReady, setStartupReady] = useState(false)
  const [notificationSettings, setNotificationSettings] = useState({ browser: { enabled: false }, templates: [] })
  const browserEventCursor = useRef('')

  const refreshUsage = useCallback(async () => {
    try {
      setUsage(await apiJson('/api/usage/today'))
    } catch {
      // The agent can still run when usage aggregation is temporarily unavailable.
    }
  }, [])

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
    localStorage.setItem('pi-coder-chat-mode', nextMode)
  }

  const notify = (message) => {
    setToast(message)
    window.clearTimeout(notify.timer)
    notify.timer = window.setTimeout(() => setToast(''), 2400)
  }

  const showBrowserNotification = useCallback((title, body, { force = false } = {}) => {
    if (!notificationSettings.browser?.enabled || !('Notification' in window) || window.Notification.permission !== 'granted') return
    if (!force && document.visibilityState === 'visible' && document.hasFocus()) return
    const item = new window.Notification(title, { body, tag: `pi-coder-${title}` })
    item.onclick = () => { window.focus(); item.close() }
  }, [notificationSettings.browser?.enabled])

  const browserNotify = useCallback((event, data, options) => {
    const template = notificationSettings.templates?.find((item) => item.id === event)
    const content = template?.channels?.browser?.content
    if (!template?.enabled || !content) return
    showBrowserNotification(template.name, renderNotificationContent(content, data), options)
  }, [notificationSettings.templates, showBrowserNotification])

  const navigate = (next) => {
    setPage(next)
    window.location.hash = next
    setQuery('')
    setMobileNav(false)
  }

  useEffect(() => {
    let active = true
    apiJson('/api/config')
      .then((config) => {
        if (!active) return
        if (!hasUsableProvider(config)) {
          setPage('config')
          window.location.hash = 'config'
          setConfigCreateSignal((value) => value + 1)
        }
      })
      .catch(() => {})
      .finally(() => active && setStartupReady(true))
    return () => { active = false }
  }, [])

  useEffect(() => {
    const syncHash = () => {
      const next = window.location.hash.slice(1)
      if (PAGE_META[next]) setPage(next)
    }
    window.addEventListener('hashchange', syncHash)
    return () => window.removeEventListener('hashchange', syncHash)
  }, [])

  useEffect(() => {
    refreshUsage()
    const timer = window.setInterval(refreshUsage, 15_000)
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') refreshUsage()
    }
    document.addEventListener('visibilitychange', refreshWhenVisible)
    return () => {
      window.clearInterval(timer)
      document.removeEventListener('visibilitychange', refreshWhenVisible)
    }
  }, [refreshUsage])

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

  if (!startupReady) return <div className="app-startup"><span className="brand-logo">P</span><RefreshCw className="spin" size={19} /><strong>正在检查 Agent 配置…</strong></div>

  return (
    <div className="app-shell">
      <DesktopTitlebar />
      <div className="app-body">
        <Sidebar page={page} navigate={navigate} open={mobileNav} onClose={() => setMobileNav(false)} usage={usage} pluginStats={pluginStats} />
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
            onPrimary={() => {
              if (page === 'chat') setChatCreateSignal((value) => value + 1)
              else if (page === 'config' && configSection === 'models') setConfigCreateSignal((value) => value + 1)
              else if (page === 'assets') setAssetUploadSignal((value) => value + 1)
              else if (page === 'plugins') setPluginSaveSignal((value) => value + 1)
              else if (page === 'channels') setChannelCreateSignal((value) => value + 1)
              else if (page === 'schedules') setScheduleCreateSignal((value) => value + 1)
              else if (page === 'memory') setMemoryCreateSignal((value) => value + 1)
              else if (page === 'workflows') navigate('workflowCreate')
              else if (page === 'workflowCreate') notify('工作流已发布')
              else setModal(page)
            }}
            notify={notify}
          />
          <div className={`page-content page-${page}`}>
            {page === 'chat' && <ChatPage mode={chatMode} setMode={setChatMode} query={query} notify={notify} browserNotify={browserNotify} createSignal={chatCreateSignal} onUsageChange={refreshUsage} pendingAsset={pendingAsset} onAssetConsumed={() => setPendingAsset(null)} />}
            {page === 'assets' && <AssetsPage query={query} notify={notify} createSignal={assetUploadSignal} onUse={(asset) => { setPendingAsset(asset); setChatMode('focus'); navigate('chat') }} />}
            {page === 'channels' && <ChannelsPage notify={notify} createSignal={channelCreateSignal} />}
            {page === 'schedules' && <SchedulesPage notify={notify} createSignal={scheduleCreateSignal} openNotificationSettings={() => { setConfigSection('notifications'); navigate('config') }} />}
            {page === 'config' && <ConfigPage notify={notify} createSignal={configCreateSignal} section={configSection} setSection={setConfigSection} onBrowserNotificationChange={setNotificationSettings} />}
            {page === 'plugins' && <PluginsPage query={query} notify={notify} saveSignal={pluginSaveSignal} onStatusChange={setPluginStats} />}
            {page === 'memory' && <MemoryPage query={query} notify={notify} createSignal={memoryCreateSignal} />}
            {page === 'mcp' && <McpPage notify={notify} />}
            {page === 'skills' && <SkillsPage notify={notify} />}
            {page === 'workflows' && <WorkflowsPage navigate={navigate} notify={notify} />}
            {page === 'workflowCreate' && <WorkflowBuilder notify={notify} />}
          </div>
        </main>
      </div>
      {toast && <div className="toast"><CheckCircle2 size={17} />{toast}</div>}
      {modal && <QuickCreate type={modal} close={() => setModal(null)} notify={notify} />}
    </div>
  )
}

function DesktopTitlebar() {
  return (
    <div className="desktop-titlebar">
      <span>Pi Coder</span>
      <div className="window-controls" aria-hidden="true"><button>−</button><button>□</button><button className="window-close">×</button></div>
    </div>
  )
}

function Sidebar({ page, navigate, open, onClose, usage, pluginStats }) {
  const active = page === 'workflowCreate' ? 'workflows' : page
  const usageTitle = usage
    ? `输入 ${usage.input.toLocaleString()} · 输出 ${usage.output.toLocaleString()} · 推理 ${usage.reasoning.toLocaleString()} · 缓存读取 ${usage.cacheRead.toLocaleString()}`
    : '正在统计今日 Token 消耗'
  return (
    <>
      {open && <button className="nav-scrim" aria-label="关闭导航" onClick={onClose} />}
      <aside className={`sidebar ${open ? 'is-open' : ''}`}>
        <div className="brand"><span className="brand-logo">P</span><strong>Pi Coder</strong><button className="mobile-close" onClick={onClose}><X size={18} /></button></div>
        <nav className="nav-list" aria-label="主导航">
          {NAV_ITEMS.map(([id, label, Icon]) => (
            <button key={id} className={active === id ? 'active' : ''} onClick={() => navigate(id)}>
              <Icon size={16} /><span>{label}</span>
            </button>
          ))}
        </nav>
        <div className="sidebar-status">
          <span>{page === 'workflowCreate' ? '当前草稿' : page === 'skills' ? '技能状态' : page === 'mcp' ? '连接状态' : page === 'plugins' ? '插件状态' : '运行状态'}</span>
          {page === 'workflowCreate' ? <><b>节点 <em>7</em></b><b>分支 <em>2</em></b><b>未配置 <em className="amber">1</em></b></> : <b>{page === 'skills' ? '已启用 12 / 18' : page === 'mcp' ? '在线服务 6 / 8' : page === 'plugins' ? `已启用 ${pluginStats?.enabled ?? '—'} / ${pluginStats?.total ?? '—'}` : <>今日 tokens <em title={usageTitle}>{usage ? formatTokenCount(usage.totalTokens) : '—'}</em></>}</b>}
        </div>
      </aside>
    </>
  )
}

function PageHeader({ meta, page, query, setQuery, chatMode, setChatMode, configSection, onMenu, onPrimary, notify }) {
  const primary = page === 'config' && configSection !== 'models' ? null : ({
    chat: ['新会话', Plus], assets: ['添加链接', Link2], channels: ['连接渠道', Plus], schedules: ['新建任务', Plus],
    config: ['添加 Provider', Plus], plugins: ['保存策略', Save], memory: ['新建节点', Plus], mcp: ['添加服务', Plus],
    skills: ['安装技能', Plus], workflows: ['新建工作流', Plus], workflowCreate: ['发布', Rocket],
  }[page])
  const PrimaryIcon = primary?.[1]
  return (
    <header className="page-header">
      <button className="mobile-menu" onClick={onMenu}><Menu size={19} /></button>
      <div className="title-block"><h1>{meta[0]}</h1><p>{meta[1]}</p></div>
      <div className="header-actions">
        {page === 'chat' && <Segmented options={['平铺', '聚集']} value={chatMode === 'grid' ? '平铺' : '聚集'} onChange={(v) => setChatMode(v === '平铺' ? 'grid' : 'focus')} compact />}
        {page === 'workflowCreate' ? (
          <>
            <button className="button secondary" onClick={() => notify('草稿已保存')}><Save size={15} />保存草稿</button>
            <button className="button dark" onClick={() => notify('试运行已开始')}><Play size={15} />试运行</button>
          </>
        ) : (
          <label className="search-box"><Search size={15} /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={page === 'chat' ? '搜索会话' : page === 'mcp' ? '搜索服务或工具' : page === 'memory' ? '搜索节点或文件' : `搜索${meta[0]}`} /></label>
        )}
        {primary && <button className="button primary" onClick={onPrimary}><PrimaryIcon size={15} />{primary[0]}</button>}
      </div>
    </header>
  )
}

function ChatPage({ mode, setMode, query, notify, browserNotify, createSignal, onUsageChange, pendingAsset, onAssetConsumed }) {
  const [remoteSessions, setRemoteSessions] = useState([])
  const [activeId, setActiveId] = useState(() => localStorage.getItem('pi-coder-active-session') || '')
  const [sessionStates, setSessionStates] = useState({})
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [model, setModel] = useState('等待配置')
  const [availableModels, setAvailableModels] = useState([])
  const [workspaceSession, setWorkspaceSession] = useState(null)
  const [tiledSessionIds, setTiledSessionIds] = useState(() => readStoredArray('pi-coder-tiled-sessions'))
  const tiledStorageWasEmpty = useRef(localStorage.getItem('pi-coder-tiled-sessions') === null)
  const createSessionRef = useRef(null)
  const handledCreateSignal = useRef(createSignal)
  const sessionStatesRef = useRef(sessionStates)

  useEffect(() => {
    sessionStatesRef.current = sessionStates
  }, [sessionStates])

  const updateSessionState = useCallback((id, update) => {
    if (!id) return
    const current = sessionStatesRef.current
    const previous = current[id] || { messages: [], tools: [], streaming: false, error: '', loaded: false }
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
        messages: data.messages,
        tools: data.tools || [],
        streaming: data.streaming,
        recovering: data.streaming,
        loaded: true,
        loading: false,
        error: data.error || '',
        model: data.model || current.model,
        cwd: data.cwd || current.cwd,
      }))
      setRemoteSessions((current) => current.map((session) => session.id === id ? { ...session, streaming: data.streaming, model: data.model || session.model, cwd: data.cwd || session.cwd } : session))
    } catch (caught) {
      updateSessionState(id, { recovering: false, loading: false, error: caught.message })
    }
  }, [updateSessionState])

  const loadSessionMessages = useCallback(async (id, force = false) => {
    if (!id) return
    const current = sessionStatesRef.current[id]
    if (current?.recovering) { await syncLiveSession(id); return }
    if (!force && (current?.loaded || current?.loading || current?.streaming)) return
    updateSessionState(id, { loading: true })
    try {
      const data = await apiJson(`/api/sessions/${encodeURIComponent(id)}/messages`)
      updateSessionState(id, (latest) => latest.streaming
        ? { ...latest, loaded: true, loading: false }
        : { ...latest, messages: data.messages, loaded: true, loading: false, error: '' })
    } catch (caught) {
      updateSessionState(id, { loading: false, error: caught.message })
    }
  }, [syncLiveSession, updateSessionState])

  useEffect(() => {
    if (activeId) localStorage.setItem('pi-coder-active-session', activeId)
  }, [activeId])

  useEffect(() => {
    localStorage.setItem('pi-coder-tiled-sessions', JSON.stringify(tiledSessionIds))
  }, [tiledSessionIds])

  const refreshSessions = async (preferredId) => {
    const data = await apiJson('/api/sessions')
    setRemoteSessions(data.sessions)
    if (preferredId) setActiveId(preferredId)
    else setActiveId((current) => data.sessions.some((session) => session.id === current) ? current : (data.sessions[0]?.id || ''))
    return data.sessions
  }

  const createSession = async () => {
    try {
      setError('')
      const created = await apiJson('/api/sessions', { method: 'POST', body: JSON.stringify({ name: '新会话' }) })
      setActiveId(created.id)
      updateSessionState(created.id, { messages: [], tools: [], streaming: false, error: '', loaded: true })
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
  createSessionRef.current = createSession

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
        for (const session of list) {
          if (session.streaming) updateSessionState(session.id, { streaming: true, recovering: true, loaded: false, error: '' })
        }
        const storedId = localStorage.getItem('pi-coder-active-session')
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
    if (createSignal > handledCreateSignal.current) createSessionRef.current?.()
    handledCreateSignal.current = createSignal
  }, [createSignal])

  useEffect(() => {
    loadSessionMessages(activeId)
  }, [activeId, loadSessionMessages])

  useEffect(() => {
    for (const id of tiledSessionIds) loadSessionMessages(id)
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
    updateSessionState(sessionId, (current) => ({ ...current, messages: [...current.messages, userMessage, { id: agentId, role: 'agent', text: '', streaming: true }], tools: [], error: '', streaming: true, loaded: true }))
    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, message: prompt, attachments }),
      })
      await consumeEventStream(response, (event, data) => {
        if (event === 'meta') {
          setModel(data.model)
          updateSessionState(sessionId, { model: data.model, cwd: data.cwd })
          if (data.cwd) setRemoteSessions((current) => current.map((session) => session.id === sessionId ? { ...session, cwd: data.cwd } : session))
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
      browserNotify?.('chat.completed', { chat: { title: completed?.name || 'Pi Coder 对话', summary: responseText.trim().slice(0, 260) || 'Agent 已完成回复。', model: sessionStatesRef.current[sessionId]?.model || model } })
    } catch (caught) {
      updateSessionState(sessionId, (current) => ({ ...current, error: caught.message, messages: current.messages.map((item) => item.id === agentId ? { ...item, streaming: false, error: caught.message, text: item.text || caught.message } : item) }))
    } finally {
      updateSessionState(sessionId, { streaming: false })
      onUsageChange?.()
    }
  }

  const abort = async (sessionId = activeId) => {
    if (!sessionId) return
    await apiJson(`/api/sessions/${encodeURIComponent(sessionId)}/abort`, { method: 'POST', body: '{}' })
    updateSessionState(sessionId, { streaming: false })
    notify('已停止当前运行')
  }

  const toggleTiledSession = (id) => {
    setTiledSessionIds((current) => current.includes(id) ? current.filter((item) => item !== id) : [...current, id])
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
    const name = window.prompt('输入新的会话标题', session.name)
    if (name === null || name.trim() === session.name) return
    try {
      const updated = await apiJson(`/api/sessions/${encodeURIComponent(session.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({ name: name.trim() }),
      })
      setRemoteSessions((current) => current.map((item) => item.id === session.id ? { ...item, name: updated.name } : item))
      notify('会话标题已更新')
    } catch (caught) {
      setError(caught.message)
    }
  }

  const deleteSession = async (session) => {
    if (!window.confirm(`确定删除会话「${session.name}」吗？此操作会删除本地历史记录。`)) return
    try {
      await apiJson(`/api/sessions/${encodeURIComponent(session.id)}`, { method: 'DELETE' })
      const remaining = remoteSessions.filter((item) => item.id !== session.id)
      setRemoteSessions(remaining)
      setTiledSessionIds((current) => current.filter((id) => id !== session.id))
      setSessionStates((current) => {
        const next = { ...current }
        delete next[session.id]
        return next
      })
      if (activeId === session.id) {
        setActiveId(remaining[0]?.id || '')
        if (remaining[0]?.id) localStorage.setItem('pi-coder-active-session', remaining[0].id)
        else localStorage.removeItem('pi-coder-active-session')
      }
      notify('会话已删除')
      if (!remaining.length) await createSession()
    } catch (caught) {
      setError(caught.message)
    }
  }

  const visible = useMemo(() => remoteSessions.filter((session) =>
    tiledSessionIds.includes(session.id) && `${session.name} ${session.firstMessage}`.toLowerCase().includes(query.toLowerCase()),
  ), [remoteSessions, query, tiledSessionIds])
  const activeSession = remoteSessions.find((session) => session.id === activeId)
  const activeState = sessionStates[activeId] || { messages: [], tools: [], streaming: false, error: '', loading: false, switchingModel: false, switchingCwd: false }

  useEffect(() => {
    document.title = activeSession?.name ? `${activeSession.name} · Pi Coder` : 'Pi Coder'
    return () => { document.title = 'Pi Coder' }
  }, [activeSession?.name])

  return (
    <>
    <div className={`chat-layout mode-${mode}`}>
      <Panel className="history-panel">
        <div className="history-head"><SectionTitle title="历史对话" /><span>{tiledSessionIds.length} 个平铺</span></div>
        {remoteSessions.map((session) => <div className={`history-row ${activeId === session.id ? 'active' : ''}`} key={session.id}><button className="history-item" onClick={() => { setActiveId(session.id); setMode('focus') }}><strong title={session.name}>{session.name}</strong><span>{relativeTime(session.modified)} · {session.messageCount} messages</span></button><div className="history-actions"><button className={tiledSessionIds.includes(session.id) ? 'is-tiled' : ''} title={tiledSessionIds.includes(session.id) ? '移出平铺' : '加入平铺'} aria-label={tiledSessionIds.includes(session.id) ? '移出平铺' : '加入平铺'} onClick={() => toggleTiledSession(session.id)}>{tiledSessionIds.includes(session.id) ? <Check size={12} /> : <Grid2X2 size={12} />}</button><button title="重命名会话" aria-label="重命名会话" onClick={() => renameSession(session)}><Pencil size={12} /></button><button className="delete" title="删除会话" aria-label="删除会话" onClick={() => deleteSession(session)}><Trash2 size={12} /></button></div></div>)}
      </Panel>
      {loading ? <Panel className="empty-state"><RefreshCw className="spin" size={24} /><h2>正在启动 Agent</h2><p>加载模型目录与历史会话…</p></Panel> : mode === 'grid' ? (
        <div className="session-grid">
          {visible.length ? visible.map((session) => <SessionCard key={session.id} session={session} state={sessionStates[session.id]} model={sessionStates[session.id]?.model || session.model || model} availableModels={availableModels} onModelChange={(nextModel) => switchSessionModel(session.id, nextModel)} onWorkspace={() => setWorkspaceSession(session)} onOpen={() => { setActiveId(session.id); setMode('focus') }} onRename={() => renameSession(session)} onSend={(value, attachments) => sendPrompt(value, session.id, attachments)} onAbort={() => abort(session.id)} />) : <TiledEmptyState hasQuery={Boolean(query)} />}
        </div>
      ) : <FocusSession session={activeSession} messages={activeState.messages} model={activeState.model || activeSession?.model || model} cwd={activeState.cwd || activeSession?.cwd} availableModels={availableModels} switchingModel={activeState.switchingModel} switchingCwd={activeState.switchingCwd} streaming={activeState.streaming} tools={activeState.tools} error={activeState.error || error} pendingAsset={pendingAsset} onAssetConsumed={onAssetConsumed} onModelChange={(nextModel) => switchSessionModel(activeId, nextModel)} onWorkspace={() => activeSession && setWorkspaceSession(activeSession)} onRename={() => activeSession && renameSession(activeSession)} onSend={sendPrompt} onAbort={() => abort(activeId)} />}
    </div>
    {workspaceSession && <WorkspacePicker session={workspaceSession} onClose={() => setWorkspaceSession(null)} onSelect={(cwd) => switchSessionCwd(workspaceSession, cwd)} />}
    </>
  )
}

function SessionCard({ session, state, model, availableModels, onModelChange, onWorkspace, onOpen, onRename, onSend, onAbort }) {
  const [value, setValue] = useState('')
  const selection = useAttachmentSelection()
  const liveRef = useRef(null)
  const messages = state?.messages || EMPTY_LIST
  const tools = state?.tools || EMPTY_LIST
  const streaming = Boolean(state?.streaming)
  useEffect(() => {
    liveRef.current?.scrollTo({ top: liveRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, tools])
  const submit = (event) => {
    event.preventDefault()
    if ((!value.trim() && !selection.attachments.length) || streaming) return
    onSend(value, selection.attachments)
    setValue('')
    selection.clearAttachments()
  }
  return (
    <Panel className="session-card">
      <div className="card-head"><button className="session-title-button" onClick={onOpen}><h3 title={session.name}>{session.name}</h3><span className={streaming ? 'success' : ''}>{streaming ? 'Agent 运行中' : `${session.messageCount || messages.length} 条消息`} · {relativeTime(session.modified)}</span><small className="workspace-summary" title={state?.cwd || session.cwd}><FolderOpen size={10} />{workspaceName(state?.cwd || session.cwd)}</small></button><div className="card-head-actions"><button className="icon-button" title="设置工作目录" onClick={onWorkspace} disabled={streaming || state?.switchingCwd}><FolderOpen size={14} /></button><button className="icon-button" title="重命名会话" onClick={onRename}><Pencil size={14} /></button>{streaming ? <button className="button danger tiny" onClick={onAbort}><Square size={11} />停止</button> : <button className="icon-button" onClick={onOpen}><MoreHorizontal size={17} /></button>}</div></div>
      <div className="session-live-body" ref={liveRef}>
        {state?.loading && !messages.length ? <div className="session-live-empty"><RefreshCw className="spin" size={16} />加载消息…</div> : !messages.length ? <button className="session-live-empty" onClick={onOpen}><Bot size={17} />开始一个新的编码任务</button> : messages.map((message) => <div className={`mini-message ${message.role}`} key={message.id}><span>{message.role === 'agent' ? 'Agent' : 'You'}</span><div className="mini-message-content"><MarkdownMessage>{message.text || (message.streaming ? '正在思考…' : '')}</MarkdownMessage>{message.attachments?.length > 0 && <MessageAttachments attachments={message.attachments} compact />}</div></div>)}
        {tools.some((tool) => tool.status === 'running') && <div className="mini-tool-status"><Wrench size={11} />{tools.filter((tool) => tool.status === 'running').map((tool) => tool.name).join('、')} 运行中</div>}
        {state?.error && <div className="mini-session-error"><AlertTriangle size={11} />{state.error}</div>}
      </div>
      <form className="mini-composer-shell" onSubmit={submit}>
        <AttachmentTray attachments={selection.attachments} onRemove={selection.removeAttachment} compact />
        {selection.attachmentError && <span className="attachment-error">{selection.attachmentError}</span>}
        <div className="mini-composer"><button type="button" className="attach-trigger" onClick={() => selection.inputRef.current?.click()} disabled={streaming}><Paperclip size={14} />{selection.attachments.length > 0 && <i>{selection.attachments.length}</i>}</button><input ref={selection.inputRef} className="sr-only" type="file" multiple accept="image/*,.txt,.md,.json,.js,.jsx,.ts,.tsx,.css,.html,.xml,.yaml,.yml,.csv,.log,.py,.java,.go,.rs,.sh,.ps1,.toml,.sql,.pdf,.docx,.pptx,.xlsx,.odt,.odp,.ods,.rtf,.epub" onChange={selection.chooseFiles} /><input value={value} onChange={(event) => setValue(event.target.value)} placeholder={streaming ? 'Agent 正在运行…' : '输入 prompt 或添加附件...'} disabled={streaming} /><SessionModelSelect value={model} models={availableModels} onChange={onModelChange} disabled={streaming || state?.switchingModel} compact />{streaming ? <button type="button" className="send-mini stop" onClick={onAbort}><Square size={12} /></button> : <button className="send-mini" disabled={!value.trim() && !selection.attachments.length}><Send size={13} /></button>}</div>
      </form>
    </Panel>
  )
}

function SessionModelSelect({ value, models, onChange, disabled, compact = false }) {
  const hasCurrentModel = models.some((model) => model.key === value)
  return (
    <label className={`session-model-select ${compact ? 'compact' : ''}`} title={disabled ? '会话运行期间不能切换模型' : '切换当前会话模型'}>
      <select value={value} onChange={(event) => onChange(event.target.value)} disabled={disabled || models.length === 0} aria-label="当前会话模型">
        {!hasCurrentModel && <option value={value}>{value.split('/').at(-1)}</option>}
        {models.map((model) => <option key={model.key} value={model.key}>{model.providerName} · {model.label}</option>)}
      </select>
      <ChevronDown size={11} />
    </label>
  )
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

function FocusSession({ session, messages, model, cwd, availableModels, switchingModel, switchingCwd, streaming, tools, error, pendingAsset, onAssetConsumed, onModelChange, onWorkspace, onRename, onSend, onAbort }) {
  const [value, setValue] = useState('')
  const selection = useAttachmentSelection()
  const addSelectedAttachments = selection.addAttachments
  const transcriptRef = useRef(null)
  const promptRef = useRef(null)
  useEffect(() => {
    if (!pendingAsset) return
    addSelectedAttachments([pendingAsset])
    onAssetConsumed?.()
  }, [pendingAsset, onAssetConsumed, addSelectedAttachments])
  useEffect(() => {
    transcriptRef.current?.scrollTo({ top: transcriptRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, tools])
  const submit = (event) => {
    event.preventDefault()
    if (!value.trim() && !selection.attachments.length) return
    onSend(value, undefined, selection.attachments)
    setValue('')
    if (promptRef.current) promptRef.current.style.height = 'auto'
    selection.clearAttachments()
  }
  return (
    <Panel className="focus-session">
      <div className="card-head"><div><div className="editable-session-title"><h3 title={session?.name}>{session?.name || '新会话'}</h3><button className="icon-button" title="重命名会话" onClick={onRename}><Pencil size={13} /></button></div><div className="session-runtime-meta"><span className={streaming ? 'success' : ''}>{streaming ? 'Agent 运行中' : '等待输入'}</span><button className="workspace-chip" title={cwd} onClick={onWorkspace} disabled={streaming || switchingCwd}><FolderOpen size={11} />{workspaceName(cwd)}</button></div></div>{streaming ? <button className="button danger tiny" onClick={onAbort}><Square size={12} />停止</button> : <MoreHorizontal size={17} />}</div>
      <div className="transcript" ref={transcriptRef}>
        {!messages.length && <div className="agent-welcome"><Bot size={22} /><h2>准备好开始编码</h2><p>Agent 可以读取当前工作区、搜索代码并持续处理任务。默认使用只读工具权限。</p></div>}
        {messages.map((message) => <div key={message.id} className={`message ${message.role} ${message.error ? 'has-error' : ''}`}><span>{message.role === 'agent' ? 'Agent' : 'You'}</span><div className="message-content"><MarkdownMessage>{message.text || (message.streaming ? '正在思考…' : '')}</MarkdownMessage>{message.attachments?.length > 0 && <MessageAttachments attachments={message.attachments} />}{message.streaming && <i className="typing-dot" />}</div></div>)}
        {tools.length > 0 && <div className="tool-trace"><strong>工具执行</strong>{tools.map((tool) => <span key={tool.id} className={tool.status}><Wrench size={12} />{tool.name}<em>{tool.status === 'running' ? '运行中' : tool.status === 'done' ? '完成' : '失败'}</em></span>)}</div>}
        {error && <div className="chat-error"><AlertTriangle size={14} />{error}</div>}
      </div>
      <form className="focus-composer-shell" onSubmit={submit}><AttachmentTray attachments={selection.attachments} onRemove={selection.removeAttachment} />{selection.attachmentError && <span className="attachment-error">{selection.attachmentError}</span>}<div className="focus-composer"><button type="button" className="attach-trigger" onClick={() => selection.inputRef.current?.click()} disabled={streaming}><Paperclip size={17} />{selection.attachments.length > 0 && <i>{selection.attachments.length}</i>}</button><input ref={selection.inputRef} className="sr-only" type="file" multiple accept="image/*,.txt,.md,.json,.js,.jsx,.ts,.tsx,.css,.html,.xml,.yaml,.yml,.csv,.log,.py,.java,.go,.rs,.sh,.ps1,.toml,.sql,.pdf,.docx,.pptx,.xlsx,.odt,.odp,.ods,.rtf,.epub" onChange={selection.chooseFiles} /><SessionModelSelect value={model} models={availableModels} onChange={onModelChange} disabled={streaming || switchingModel} /><textarea ref={promptRef} rows="1" value={value} onChange={(event) => { setValue(event.target.value); event.currentTarget.style.height = 'auto'; event.currentTarget.style.height = `${Math.min(event.currentTarget.scrollHeight, 150)}px` }} onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); event.currentTarget.form?.requestSubmit() } }} placeholder={streaming ? 'Agent 正在运行，可停止后继续输入' : '输入消息，Shift + Enter 换行'} disabled={streaming} /><button className="send-button" disabled={(!value.trim() && !selection.attachments.length) || streaming}><Send size={16} /></button></div></form>
    </Panel>
  )
}

function AssetsPage({ query, notify, createSignal, onUse }) {
  const [tab, setTab] = useState('全部')
  const [assets, setAssets] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const handledCreateSignal = useRef(createSignal)
  const [preview, setPreview] = useState(null)
  const [linkModal, setLinkModal] = useState(false)

  const loadAssets = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const params = new URLSearchParams()
      if (query) params.set('query', query)
      if (tab === '图片') params.set('kind', 'image')
      if (tab === '文件') params.set('kind', 'file')
      if (tab === '链接') params.set('kind', 'link')
      if (tab === '来自当前会话') params.set('sessionId', localStorage.getItem('pi-coder-active-session') || '__none__')
      const data = await apiJson(`/api/assets?${params}`)
      setAssets(data.assets)
    } catch (caught) {
      setError(caught.message)
    } finally {
      setLoading(false)
    }
  }, [query, tab])

  useEffect(() => { loadAssets() }, [loadAssets])
  useEffect(() => { if (createSignal > handledCreateSignal.current) setLinkModal(true); handledCreateSignal.current = createSignal }, [createSignal])

  const deleteAsset = async (asset) => {
    if (!window.confirm(`确定删除资产「${asset.name}」吗？`)) return
    try {
      await apiJson(`/api/assets/${encodeURIComponent(asset.id)}`, { method: 'DELETE' })
      setAssets((current) => current.filter((item) => item.id !== asset.id))
      notify('资产已删除')
    } catch (caught) { setError(caught.message) }
  }

  const attachAsset = async (asset) => {
    try {
      const content = await apiJson(`/api/assets/${encodeURIComponent(asset.id)}/content`)
      onUse(content)
      notify(`${asset.name} 已加入对话`)
    } catch (caught) { setError(caught.message) }
  }

  const previewAsset = async (asset) => {
    let text = ''
    if (asset.kind === 'link') text = asset.url
    else if (asset.mimeType?.startsWith('text/') || ASSET_PREVIEW_TEXT_EXTENSIONS.has(fileExtension(asset.name))) {
      const content = await apiJson(`/api/assets/${encodeURIComponent(asset.id)}/content`)
      text = content.text || ''
    }
    setPreview({ ...asset, text })
  }

  return (
    <div className="asset-page">
      <div className="asset-toolbar"><Segmented options={['全部', '图片', '文件', '链接', '来自当前会话']} value={tab} onChange={setTab} /></div>
      <div className="asset-summary"><span><strong>{assets.length}</strong> 个资产</span><span>对话附件和 Agent 生成文件会自动归档</span></div>
      {error && <div className="config-error"><AlertTriangle size={13} />{error}</div>}
      {loading ? <Panel className="empty-state"><RefreshCw className="spin" size={23} /><h2>正在加载资产</h2></Panel> : assets.length ? <div className="asset-grid functional">{assets.map((asset) => {
        const isVideo = asset.mimeType?.startsWith('video/')
        const Icon = asset.kind === 'image' ? FileImage : isVideo ? FileVideo : asset.kind === 'link' ? Link2 : File
        return <Panel className="asset-card functional" key={asset.id}><button className={`asset-preview ${asset.kind} ${isVideo ? 'video' : ''}`} onClick={() => previewAsset(asset)}>{asset.kind === 'image' ? <img src={`/api/assets/${encodeURIComponent(asset.id)}/download?inline=1`} alt="" /> : isVideo ? <video src={`/api/assets/${encodeURIComponent(asset.id)}/download?inline=1`} muted preload="metadata" /> : <Icon size={38} />}</button><div className="asset-card-copy"><strong title={asset.name}>{asset.name}</strong><span>{asset.kind === 'link' ? new URL(asset.url).hostname : formatFileSize(asset.size)} · {asset.source === 'agent' ? 'Agent 产物' : asset.source === 'attachment' ? '对话附件' : '手动上传'}</span>{asset.sessionName && <small title={asset.sessionName}>来自：{asset.sessionName}</small>}</div><div className="asset-card-actions"><button className="button tiny" onClick={() => previewAsset(asset)}><Eye size={13} />预览</button>{asset.kind === 'link' ? <a className="button tiny" href={asset.url} target="_blank" rel="noreferrer"><ExternalLink size={13} />打开</a> : <a className="button tiny" href={`/api/assets/${encodeURIComponent(asset.id)}/download`}><Download size={13} />下载</a>}<button className="button tiny primary" onClick={() => attachAsset(asset)}><Paperclip size={13} />用于对话</button><button className="icon-button danger" title="删除资产" onClick={() => deleteAsset(asset)}><Trash2 size={13} /></button></div></Panel>
      })}</div> : <Panel className="empty-state"><FolderOpen size={25} /><h2>暂无资产</h2><p>添加链接，或在对话中使用附件后会自动出现在这里；Agent 生成文件也会自动登记。</p><button className="button primary" onClick={() => setLinkModal(true)}><Link2 size={14} />添加链接</button></Panel>}
      {preview && <AssetPreviewModal asset={preview} onClose={() => setPreview(null)} onUse={() => attachAsset(preview)} />}
      {linkModal && <AssetLinkModal onClose={() => setLinkModal(false)} onCreated={() => { setLinkModal(false); loadAssets(); notify('链接资产已添加') }} />}
    </div>
  )
}

const ASSET_PREVIEW_TEXT_EXTENSIONS = new Set(['txt', 'md', 'json', 'js', 'jsx', 'ts', 'tsx', 'css', 'html', 'xml', 'yaml', 'yml', 'csv', 'log', 'py', 'java', 'go', 'rs', 'sh', 'ps1', 'toml', 'sql'])

function AssetPreviewModal({ asset, onClose, onUse }) {
  const isVideo = asset.mimeType?.startsWith('video/')
  return <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className="modal asset-preview-modal"><div className="card-head"><div><h2>{asset.name}</h2><p>{asset.kind === 'link' ? asset.url : `${asset.mimeType} · ${formatFileSize(asset.size)}`}</p></div><button className="icon-button" onClick={onClose}><X size={17} /></button></div><div className="asset-modal-content">{asset.kind === 'image' ? <img src={`/api/assets/${encodeURIComponent(asset.id)}/download?inline=1`} alt={asset.name} /> : isVideo ? <video controls src={`/api/assets/${encodeURIComponent(asset.id)}/download?inline=1`} /> : asset.kind === 'link' ? <a href={asset.url} target="_blank" rel="noreferrer"><ExternalLink size={16} />{asset.url}</a> : asset.text ? <pre>{asset.text}</pre> : <div className="asset-file-preview"><File size={42} /><strong>{asset.name}</strong><span>此类型可下载，支持的文档也可以直接加入对话分析。</span></div>}</div><div className="modal-actions">{asset.kind !== 'link' && <a className="button secondary" href={`/api/assets/${encodeURIComponent(asset.id)}/download`}><Download size={14} />下载</a>}<button className="button primary" onClick={onUse}><Paperclip size={14} />用于对话</button></div></section></div>
}

function AssetLinkModal({ onClose, onCreated }) {
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const submit = async (event) => {
    event.preventDefault(); setSaving(true); setError('')
    try { await apiJson('/api/assets', { method: 'POST', body: JSON.stringify({ kind: 'link', name, url, source: 'upload' }) }); onCreated() }
    catch (caught) { setError(caught.message) } finally { setSaving(false) }
  }
  return <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><form className="modal" onSubmit={submit}><div className="card-head"><div><h2>添加链接资产</h2><p>链接可以归档、打开，也可以作为上下文加入对话。</p></div><button type="button" className="icon-button" onClick={onClose}><X size={17} /></button></div><label className="field-label">名称<input value={name} onChange={(event) => setName(event.target.value)} placeholder="例如 OpenAI API 文档" /></label><label className="field-label">URL<input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://example.com/docs" /></label>{error && <div className="config-error"><AlertTriangle size={13} />{error}</div>}<div className="modal-actions"><button type="button" className="button secondary" onClick={onClose}>取消</button><button className="button primary" disabled={saving || !url.trim()}>{saving ? <RefreshCw className="spin" size={14} /> : <Plus size={14} />}{saving ? '添加中…' : '添加链接'}</button></div></form></div>
}

function configDraft(data, provider, preferredModel) {
  const chatModels = provider?.models.filter((item) => item.kind === 'chat') || []
  const model = chatModels.find((item) => item.id === preferredModel) || chatModels[0]
  return {
    provider: provider?.id || 'openai',
    model: model?.id || '',
    apiKey: '',
    baseUrl: provider?.baseUrl || '',
    modelBaseUrl: model?.baseUrlOverride || '',
    organization: provider?.organization || '',
    thinkingLevel: data.thinkingLevel || 'medium',
    toolMode: data.toolMode || 'read-only',
  }
}

function ConfigPage({ notify, createSignal, section, setSection, onBrowserNotificationChange }) {
  const [config, setConfig] = useState(null)
  const [draft, setDraft] = useState(null)
  const [saving, setSaving] = useState(false)
  const [toggling, setToggling] = useState('')
  const [error, setError] = useState('')
  const [providerModal, setProviderModal] = useState(false)
  const [modelModal, setModelModal] = useState(false)
  const handledCreateSignal = useRef(createSignal)

  useEffect(() => {
    apiJson('/api/config')
      .then((data) => {
        setConfig(data)
        const provider = data.providers.find((item) => item.id === data.provider) || data.providers[0]
        setDraft(configDraft(data, provider, data.model))
      })
      .catch((caught) => setError(caught.message))
  }, [])

  useEffect(() => {
    if (createSignal > handledCreateSignal.current) setProviderModal(true)
    handledCreateSignal.current = createSignal
  }, [createSignal])

  const selectProvider = (provider) => {
    setDraft((current) => ({ ...configDraft(config, provider), thinkingLevel: current.thinkingLevel, toolMode: current.toolMode }))
  }

  const selectModel = (modelId) => {
    const provider = config.providers.find((item) => item.id === draft.provider)
    const selectedModel = provider?.models.find((item) => item.id === modelId)
    setDraft((current) => ({ ...current, model: modelId, modelBaseUrl: selectedModel?.baseUrlOverride || '' }))
  }

  const toggleProvider = async (provider, enabled) => {
    setToggling(provider.id)
    setError('')
    try {
      const updated = await apiJson(`/api/providers/${encodeURIComponent(provider.id)}/enabled`, { method: 'PUT', body: JSON.stringify({ enabled }) })
      setConfig(updated)
      notify(`${provider.name} 已${enabled ? '启用' : '停用'}`)
    } catch (caught) {
      setError(caught.message)
    } finally {
      setToggling('')
    }
  }

  const deleteProvider = async (provider) => {
    if (!window.confirm(`确定删除 Provider 连接「${provider.name}」吗？对应的模型配置和认证信息也会删除。`)) return
    setError('')
    try {
      const updated = await apiJson(`/api/providers/${encodeURIComponent(provider.id)}`, { method: 'DELETE' })
      setConfig(updated)
      const nextProvider = updated.providers.find((item) => item.id === updated.provider) || updated.providers[0]
      setDraft(configDraft(updated, nextProvider, updated.model))
      notify('Provider 连接已删除')
    } catch (caught) {
      setError(caught.message)
    }
  }

  const save = async () => {
    setSaving(true)
    setError('')
    try {
      const saved = await apiJson('/api/config', { method: 'PUT', body: JSON.stringify(draft) })
      setConfig(saved)
      const provider = saved.providers.find((item) => item.id === draft.provider) || saved.providers[0]
      setDraft((current) => ({ ...configDraft(saved, provider, current.model), thinkingLevel: current.thinkingLevel, toolMode: current.toolMode }))
      notify('Agent 配置已保存，新会话将使用该模型')
    } catch (caught) {
      setError(caught.message)
    } finally {
      setSaving(false)
    }
  }

  if (!config || !draft) return <Panel className="empty-state"><RefreshCw className="spin" size={24} /><h2>正在加载模型目录</h2><p>读取 Provider 与认证状态…</p></Panel>
  const selectedProvider = config.providers.find((item) => item.id === draft.provider) || config.providers[0]
  const selectedModel = selectedProvider.models.find((item) => item.id === draft.model)
  const chatModels = selectedProvider.models.filter((item) => item.kind === 'chat')
  const visualModels = selectedProvider.models.filter((item) => item.kind !== 'chat')
  const providerIcons = { openai: Bot, anthropic: Brain, google: Sparkles, deepseek: Code2, xai: Zap, openrouter: Network }
  return (
    <>
    <div className="config-subnav"><button className={section === 'models' ? 'active' : ''} onClick={() => setSection('models')}>模型配置</button><button className={section === 'notifications' ? 'active' : ''} onClick={() => setSection('notifications')}>通知设置</button></div>
    {section === 'notifications' ? <NotificationSettings notify={notify} onBrowserNotificationChange={onBrowserNotificationChange} /> : <>
    <div className="split-list-detail config-layout">
      <Panel className="selection-list"><div className="provider-list-heading"><SectionTitle title="Provider 连接" /><button className="icon-button" title="添加 Provider" onClick={() => setProviderModal(true)}><Plus size={15} /></button></div>{config.providers.map((provider) => { const Icon = providerIcons[provider.id] || Server; return <div className={`provider-list-item ${draft.provider === provider.id ? 'active' : ''} ${provider.enabled ? '' : 'disabled-provider'}`} key={provider.id}><button className="provider-select-main" onClick={() => selectProvider(provider)}><span className="list-icon"><Icon size={16} /></span><span><strong>{provider.name}</strong><small>{provider.id} · {provider.models.length} 个模型</small></span></button><div className="provider-list-control"><Badge tone={!provider.enabled ? 'gray' : provider.configured ? 'green' : 'amber'}>{!provider.enabled ? '已停用' : provider.configured ? '已配置' : '未认证'}</Badge><Toggle value={provider.enabled} disabled={!provider.configured || toggling === provider.id} onChange={(enabled) => toggleProvider(provider, enabled)} /></div></div> })}</Panel>
      <div className="detail-stack">
        <Panel>
          <div className="card-head"><div><h2>{selectedProvider.name}</h2><p>{selectedProvider.id} · {selectedProvider.api} · 每个连接独立保存认证与地址</p></div><div className="provider-header-status"><Badge tone={!selectedProvider.enabled ? 'gray' : selectedProvider.configured ? 'green' : 'amber'}>{!selectedProvider.enabled ? '已停用' : selectedProvider.configured ? '认证可用' : '需要 API Key'}</Badge><Toggle value={selectedProvider.enabled} disabled={!selectedProvider.configured || toggling === selectedProvider.id} onChange={(enabled) => toggleProvider(selectedProvider, enabled)} />{selectedProvider.custom && <button className="icon-button danger" title="删除 Provider" onClick={() => deleteProvider(selectedProvider)}><Trash2 size={14} /></button>}</div></div>
          <label className="field-label">API Key<span className="input-wrap"><input type="password" value={draft.apiKey} onChange={(event) => setDraft({ ...draft, apiKey: event.target.value })} placeholder={selectedProvider.configured ? '已配置；留空将保持现有密钥' : '输入 Provider API Key'} /><KeyRound size={14} /></span></label>
          <label className="field-label">Provider Base URL<input value={draft.baseUrl} onChange={(event) => setDraft({ ...draft, baseUrl: event.target.value })} placeholder="此连接下模型默认使用的地址" /></label>
          <label className="field-label">Organization<input value={draft.organization} onChange={(event) => setDraft({ ...draft, organization: event.target.value })} placeholder="可选，仅 OpenAI Organization 使用" /></label>
          <div className="model-config-heading"><SectionTitle title="模型配置" /><button className="button secondary tiny" onClick={() => setModelModal(true)}><Plus size={13} />添加模型</button></div>
          <label className="field-label">默认对话模型<span className="select-wrap"><select value={draft.model} onChange={(event) => selectModel(event.target.value)}>{chatModels.map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}</select><ChevronDown size={13} /></span></label>
          <label className="field-label">模型 Base URL<input value={draft.modelBaseUrl} onChange={(event) => setDraft({ ...draft, modelBaseUrl: event.target.value })} placeholder="可选；为当前模型覆盖 Provider Base URL" /></label>
          <div className="tag-field"><Badge>{draft.provider}</Badge><Badge>{selectedModel?.reasoning ? '支持推理' : '标准模型'}</Badge><Badge tone="gray">{selectedModel?.contextWindow ? `${Math.round(selectedModel.contextWindow / 1000)}K context` : '自动上下文'}</Badge>{selectedModel?.baseUrlOverride && <Badge tone="amber">独立 Base URL</Badge>}</div>
          {visualModels.length > 0 && <div className="visual-model-list"><span>视觉模型</span>{visualModels.map((model) => <Badge tone={model.kind === 'video' ? 'violet' : 'blue'} key={model.id}>{model.name} · {model.kind === 'video' ? '视频' : '图像'}</Badge>)}</div>}
        </Panel>
        <div className="config-bottom">
          <Panel><SectionTitle title="Agent 运行策略" /><label className="field-label">思考强度<span className="select-wrap"><select value={draft.thinkingLevel} onChange={(event) => setDraft({ ...draft, thinkingLevel: event.target.value })}>{['off', 'minimal', 'low', 'medium', 'high', 'xhigh'].map((level) => <option key={level}>{level}</option>)}</select><ChevronDown size={13} /></span></label><label className="field-label">工具权限<span className="select-wrap"><select value={draft.toolMode} onChange={(event) => setDraft({ ...draft, toolMode: event.target.value })}><option value="read-only">只读：read / grep / find / ls</option><option value="workspace">工作区：允许 edit / write</option><option value="full">完整：允许 bash</option><option value="custom">自定义：在插件页逐项管理</option></select><ChevronDown size={13} /></span></label><div className="permission-note"><ShieldCheck size={16} /><span><strong>权限在服务端生效</strong><small>切换配置后，现有运行时会释放，新会话按最新策略创建。</small></span></div></Panel>
          <Panel className="usage-card"><SectionTitle title="运行时状态" /><div className="usage-number"><span>Engine</span><strong>Pi 0.80</strong></div><div className="usage-number"><span>Provider</span><strong>{selectedProvider.name}</strong></div><div className="usage-number"><span>Models</span><strong>{selectedProvider.models.length}</strong></div><div className="usage-number"><span>状态</span><strong>{selectedProvider.enabled ? '启用' : '停用'}</strong></div>{error && <div className="config-error"><AlertTriangle size={13} />{error}</div>}<button className="button primary wide" disabled={saving || !draft.model || !selectedProvider.enabled} onClick={save}>{saving ? <RefreshCw className="spin" size={14} /> : <Save size={14} />}{saving ? '保存中…' : selectedProvider.enabled ? '保存并设为默认' : '启用后可保存'}</button></Panel>
        </div>
      </div>
    </div>
    {providerModal && <ProviderConfigModal onClose={() => setProviderModal(false)} onCreated={(data) => { const provider = data.providers.find((item) => item.id === data.createdProviderId); setConfig(data); setDraft(configDraft(data, provider)); setProviderModal(false); notify('Provider 连接已创建') }} />}
    {modelModal && <ProviderModelModal provider={selectedProvider} onClose={() => setModelModal(false)} onCreated={(data, modelId) => { const provider = data.providers.find((item) => item.id === selectedProvider.id); setConfig(data); setDraft((current) => ({ ...configDraft(data, provider, modelId), thinkingLevel: current.thinkingLevel, toolMode: current.toolMode })); setModelModal(false); notify('模型已添加') }} />}
    </>}
    </>
  )
}

const PROVIDER_APIS = [
  ['openai-responses', 'OpenAI Responses'],
  ['openai-completions', 'OpenAI Chat Completions'],
  ['anthropic-messages', 'Anthropic Messages'],
  ['google-generative-ai', 'Google Generative AI'],
]

function ProviderConfigModal({ onClose, onCreated }) {
  const [draft, setDraft] = useState({ name: '', id: '', api: 'openai-responses', baseUrl: '', apiKey: '', model: '', modelName: '', modelKind: 'auto', reasoning: true, enabled: true })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const updateName = (name) => setDraft((current) => ({ ...current, name, id: current.id || name.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') }))
  const submit = async (event) => {
    event.preventDefault()
    setSaving(true); setError('')
    try {
      onCreated(await apiJson('/api/providers', { method: 'POST', body: JSON.stringify(draft) }))
    } catch (caught) { setError(caught.message) } finally { setSaving(false) }
  }
  return <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><form className="modal provider-config-modal" onSubmit={submit}><div className="card-head"><div><h2>添加 Provider 连接</h2><p>同一种协议可创建多个连接，每个连接独立使用 Key 和 Base URL。</p></div><button type="button" className="icon-button" onClick={onClose}><X size={17} /></button></div><div className="form-grid"><label className="field-label">显示名称<input value={draft.name} onChange={(event) => updateName(event.target.value)} placeholder="例如 OpenAI 官方" /></label><label className="field-label">Provider ID<input value={draft.id} onChange={(event) => setDraft({ ...draft, id: event.target.value })} placeholder="openai-official" /></label></div><label className="field-label">API 协议<span className="select-wrap"><select value={draft.api} onChange={(event) => setDraft({ ...draft, api: event.target.value })}>{PROVIDER_APIS.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select><ChevronDown size={13} /></span></label><label className="field-label">Base URL<input value={draft.baseUrl} onChange={(event) => setDraft({ ...draft, baseUrl: event.target.value })} placeholder="https://api.openai.com/v1" /></label><label className="field-label">API Key<input type="password" value={draft.apiKey} onChange={(event) => setDraft({ ...draft, apiKey: event.target.value })} placeholder="输入此连接使用的 API Key" /></label><div className="form-grid"><label className="field-label">初始模型 ID<input value={draft.model} onChange={(event) => setDraft({ ...draft, model: event.target.value })} placeholder="gpt-5.4 或 gpt-image-1" /></label><label className="field-label">模型名称<input value={draft.modelName} onChange={(event) => setDraft({ ...draft, modelName: event.target.value })} placeholder="留空使用模型 ID" /></label></div><label className="field-label">模型用途<span className="select-wrap"><select value={draft.modelKind} onChange={(event) => setDraft({ ...draft, modelKind: event.target.value })}><option value="auto">自动识别</option><option value="chat">对话</option><option value="image">图像生成</option><option value="video">视频生成</option></select><ChevronDown size={13} /></span></label><div className="modal-toggle-row"><span><strong>创建后启用</strong><small>视觉模型由视觉生成工具自动选择，不会进入对话模型列表</small></span><Toggle value={draft.enabled} onChange={(enabled) => setDraft({ ...draft, enabled })} /></div>{error && <div className="config-error"><AlertTriangle size={13} />{error}</div>}<div className="modal-actions"><button type="button" className="button secondary" onClick={onClose}>取消</button><button className="button primary" disabled={saving}>{saving ? <RefreshCw className="spin" size={14} /> : <Plus size={14} />}{saving ? '创建中…' : '创建连接'}</button></div></form></div>
}

function ProviderModelModal({ provider, onClose, onCreated }) {
  const [draft, setDraft] = useState({ id: '', name: '', api: provider.api || 'openai-responses', baseUrl: '', kind: 'auto', reasoning: true })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const submit = async (event) => {
    event.preventDefault(); setSaving(true); setError('')
    try {
      const data = await apiJson(`/api/providers/${encodeURIComponent(provider.id)}/models`, { method: 'POST', body: JSON.stringify(draft) })
      onCreated(data, draft.id)
    } catch (caught) { setError(caught.message) } finally { setSaving(false) }
  }
  return <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><form className="modal" onSubmit={submit}><div className="card-head"><div><h2>添加模型</h2><p>添加到 {provider.name}，可单独覆盖 Base URL。</p></div><button type="button" className="icon-button" onClick={onClose}><X size={17} /></button></div><div className="form-grid"><label className="field-label">模型 ID<input value={draft.id} onChange={(event) => setDraft({ ...draft, id: event.target.value })} placeholder="gpt-5.4-mini、gpt-image-1 或 sora-2" /></label><label className="field-label">显示名称<input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="留空使用模型 ID" /></label></div><label className="field-label">模型 Base URL<input value={draft.baseUrl} onChange={(event) => setDraft({ ...draft, baseUrl: event.target.value })} placeholder="可选；留空继承 Provider Base URL" /></label><label className="field-label">API 协议<span className="select-wrap"><select value={draft.api} onChange={(event) => setDraft({ ...draft, api: event.target.value })}>{PROVIDER_APIS.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select><ChevronDown size={13} /></span></label><label className="field-label">模型用途<span className="select-wrap"><select value={draft.kind} onChange={(event) => setDraft({ ...draft, kind: event.target.value })}><option value="auto">自动识别</option><option value="chat">对话</option><option value="image">图像生成</option><option value="video">视频生成</option></select><ChevronDown size={13} /></span></label>{draft.kind !== 'image' && draft.kind !== 'video' && <div className="modal-toggle-row"><span><strong>推理模型</strong><small>启用 reasoning effort / thinking level</small></span><Toggle value={draft.reasoning} onChange={(reasoning) => setDraft({ ...draft, reasoning })} /></div>}{error && <div className="config-error"><AlertTriangle size={13} />{error}</div>}<div className="modal-actions"><button type="button" className="button secondary" onClick={onClose}>取消</button><button className="button primary" disabled={saving || !draft.id.trim()}>{saving ? <RefreshCw className="spin" size={14} /> : <Plus size={14} />}{saving ? '添加中…' : '添加模型'}</button></div></form></div>
}

function McpPage({ notify }) {
  const services = [['Pencil', 'mcp.pencil.local', '在线', 'green'], ['Filesystem', 'stdio://filesystem', '在线', 'green'], ['GitHub', 'https://mcp.github.com', '离线', 'red'], ['Browser', 'stdio://browser', '受限', 'amber'], ['Hermes Docs', 'https://mcp.hermesagent.org.cn/v1', '在线', 'green'], ['Database', 'stdio://postgres', '未授权', 'gray']]
  const [selected, setSelected] = useState(0)
  return (
    <div className="mcp-layout"><Panel className="selection-list"><SectionTitle title="服务" />{services.map((s, i) => <button className={`service-row ${selected === i ? 'active' : ''}`} onClick={() => setSelected(i)} key={s[0]}><span className="list-icon"><Server size={15} /></span><span><strong>{s[0]}</strong><small>{s[1]}</small></span><Badge tone={s[3]}>{s[2]}</Badge></button>)}</Panel><div className="mcp-center"><div className="metric-grid"><Metric value="6" label="在线服务" note="8 total" tone="blue" /><Metric value="38" label="可用工具" note="5 restricted" tone="green" /><Metric value="0.8%" label="错误率" note="24h" tone="amber" /></div><Panel><SectionTitle title="工具能力" />{toolRows.map((r) => <div className="tool-row" key={r[0]}><span className="list-icon"><Wrench size={15} /></span><span><strong>{r[0]}</strong><small>{r[1]}</small></span><Badge tone={r[2] === '高风险' ? 'red' : r[2] === '中风险' ? 'amber' : 'green'}>{r[2]}</Badge><Toggle defaultOn={r[3]} /></div>)}</Panel></div><div className="detail-stack"><Panel><SectionTitle title="当前服务" /><h2>{services[selected][0]}</h2><p className="muted-copy">用于读取、生成和验证 .pen 设计文件。当前连接稳定，允许设计编辑工具。</p>{[['Transport', 'Streamable HTTP'], ['Latency', '42 ms'], ['Last Ping', '12 seconds ago'], ['Auth', 'Local session']].map((r) => <div className="key-value" key={r[0]}><span>{r[0]}</span><strong>{r[1]}</strong></div>)}<button className="button secondary wide" onClick={() => notify('连接测试成功，延迟 42ms')}><RefreshCw size={14} />测试连接</button></Panel><Panel><SectionTitle title="最近调用" />{[['snapshot_layout', '14:28 · OK'], ['batch_design', '14:26 · OK'], ['get_screenshot', '14:22 · OK'], ['export_html', '14:18 · Skipped']].map((a) => <div className="activity-row" key={a[0]}><CircleDot size={14} /><span><strong>{a[0]}</strong><small>{a[1]}</small></span></div>)}</Panel></div></div>
  )
}

function SkillsPage({ notify }) {
  const [selected, setSelected] = useState(0)
  const [enabled, setEnabled] = useState(skillInstalled.map((x) => x[3]))
  return (
    <div className="skills-page"><Segmented options={['全部', '已安装', '可安装', '设计', '代码', '文档', '高权限']} value="全部" onChange={() => {}} /><div className="skills-layout"><Panel><SectionTitle title="已安装技能" />{skillInstalled.map((s, i) => { const Icon = s[2]; return <button className={`skill-row ${selected === i ? 'selected' : ''}`} onClick={() => setSelected(i)} key={s[0]}><span className="list-icon"><Icon size={15} /></span><span><strong>{s[0]}</strong><small>{s[1]}</small></span><Toggle value={enabled[i]} onChange={() => setEnabled(enabled.map((e, x) => x === i ? !e : e))} /></button>})}</Panel><Panel><div className="card-head"><SectionTitle title="技能市场" /><a>18 available</a></div>{[['browser-research', '网页调研、引用整理与资料归档', 'Research'], ['figma-import', '同步 Figma 组件并生成设计 token', 'Design'], ['db-admin', '读取 schema、生成安全 SQL 草案', 'Data'], ['release-writer', '根据 commits 生成 changelog 和发布说明', '已安装'], ['test-author', '为变更生成 focused tests', 'Code'], ['prompt-auditor', '检查系统 prompt 漏洞和冲突', 'Safety']].map((s) => <div className="market-row" key={s[0]}><span className="list-icon"><Sparkles size={15} /></span><span><strong>{s[0]}</strong><small>{s[1]}</small></span><Badge tone={s[2] === '已安装' ? 'green' : 'blue'}>{s[2]}</Badge></div>)}</Panel><div className="detail-stack"><Panel><SectionTitle title="选中技能" /><h2>{skillInstalled[selected][0]}</h2><p className="muted-copy">当任务需要 AI 生成位图、编辑图片、做贴图或视觉素材时自动触发。</p>{[['触发方式', '自动 + 手动'], ['权限', '生成图片'], ['版本', 'system / latest'], ['来源', '内置技能']].map((r) => <div className="key-value" key={r[0]}><span>{r[0]}</span><strong>{r[1]}</strong></div>)}<button className="button primary wide" onClick={() => notify('技能设置已更新')}><Save size={14} />保存设置</button></Panel><Panel><SectionTitle title="触发条件" />{['请求生成图片', '编辑已有图片', '需要 SVG 图标', '仅文本解释'].map((x, i) => <label className="check-row" key={x}><input type="checkbox" defaultChecked={i < 2} /><span>{x}</span></label>)}</Panel></div></div></div>
  )
}

function WorkflowsPage({ navigate, notify }) {
  const templates = [['代码审查', '读取 diff → 运行测试 → 生成 review', Code2], ['PR 修复', '定位失败 → 修改代码 → 回归测试', GitBranch], ['资料调研', '搜索资料 → 提取引用 → 写入记忆', Search], ['日报周报', '汇总会话 → 生成摘要 → 渠道通知', File], ['资产生成', '生成图片 → 存入资产库 → 通知验收', Image], ['发布准备', '版本检查 → changelog → 创建发布单', Rocket]]
  return (
    <div className="workflows-page"><Segmented options={['全部', '预设', '自定义', '运行中', '失败', '草稿']} value="全部" onChange={() => {}} /><div className="workflow-top"><Panel><div className="card-head"><SectionTitle title="常见预设" /><a>6 templates</a></div><div className="template-grid">{templates.map((t) => { const Icon = t[2]; return <button onClick={() => { navigate('workflowCreate'); notify(`已载入「${t[0]}」模板`) }} key={t[0]}><span className="list-icon"><Icon size={15} /></span><span><strong>{t[0]}</strong><small>{t[1]}</small></span><ChevronRight size={14} /></button>})}</div></Panel><Panel className="workflow-preview"><div className="card-head"><SectionTitle title="自定义工作流" /><button className="text-button" onClick={() => navigate('workflowCreate')}>空白创建</button></div><WorkflowMiniMap /></Panel></div><div className="workflow-bottom"><Panel><div className="card-head"><SectionTitle title="并行运行" /><a>3 running · 5 queued</a></div>{[['PR 修复 #284', '回归测试', 72, 'blue'], ['资料调研：MCP Auth', '整理引用', 46, 'violet'], ['资产生成：活动页', '等待验收', 88, 'green'], ['发布准备 v2.8', '生成 changelog', 31, 'amber']].map((r) => <div className="run-row" key={r[0]}><span><strong>{r[0]}</strong><small>{r[1]}</small></span><div className="run-progress"><i className={r[3]} style={{ width: `${r[2]}%` }} /></div><em>{r[2]}%</em><button onClick={() => notify(`${r[0]} 已停止`)}><Square size={12} />停止</button></div>)}</Panel><Panel><SectionTitle title="队列与限制" />{[['最大并发', '4', '当前 3 个运行'], ['失败重试', '2 次', '指数退避'], ['默认模型', 'GPT-5-Codex', '可按步骤覆盖'], ['完成推送', '已启用', '工作流结束后发送模板消息']].map((r) => <div className="setting-row" key={r[0]}><span><strong>{r[0]}</strong><small>{r[2]}</small></span><button>{r[1]} <ChevronDown size={12} /></button></div>)}</Panel></div></div>
  )
}

function WorkflowBuilder({ notify }) {
  const canvasRef = useRef(null)
  const [nodes, setNodes] = useState([
    { id: 1, label: 'Git push', type: '触发器', x: 65, y: 45 }, { id: 2, label: '读取 diff', type: '任务', x: 235, y: 45 },
    { id: 3, label: '是否需要测试', type: '判断', x: 405, y: 45 }, { id: 4, label: '测试 + lint', type: '并行', x: 235, y: 160 },
    { id: 5, label: '生成修复计划', type: '任务', x: 405, y: 160 }, { id: 6, label: '修改代码', type: '任务', x: 235, y: 280 },
    { id: 7, label: '人工确认', type: '审批', x: 405, y: 280 }, { id: 8, label: '发送结果', type: '通知', x: 320, y: 385 },
  ])
  const [selected, setSelected] = useState(6)
  const palette = [['Git Push', Zap], ['定时', Clock3], ['手动输入', Pencil], ['运行 Prompt', Bot], ['读写文件', FileCode2], ['调用 MCP', Server], ['发送通知', Bell], ['条件判断', GitBranch], ['并行分支', Network], ['等待审批', ShieldCheck]]
  const drop = (e) => {
    e.preventDefault()
    const data = JSON.parse(e.dataTransfer.getData('text/plain') || '{}')
    const box = canvasRef.current.getBoundingClientRect()
    const x = Math.max(10, e.clientX - box.left - 60)
    const y = Math.max(10, e.clientY - box.top - 25)
    if (data.id) setNodes(nodes.map((n) => n.id === data.id ? { ...n, x, y } : n))
    else if (data.label) { const id = Date.now(); setNodes([...nodes, { id, label: data.label, type: '节点', x, y }]); setSelected(id) }
  }
  const current = nodes.find((n) => n.id === selected) || nodes[0]
  return (
    <div className="builder-layout"><Panel className="node-library"><SectionTitle title="节点库" />{palette.map(([label, Icon], i) => <div key={label}><small>{[0, 3, 7].includes(i) ? ['触发', '动作', '控制'][[0, 3, 7].indexOf(i)] : ''}</small><button draggable onDragStart={(e) => e.dataTransfer.setData('text/plain', JSON.stringify({ label }))}><Icon size={15} />{label}<span>拖拽</span></button></div>)}</Panel><Panel className="builder-canvas" ref={canvasRef} onDragOver={(e) => e.preventDefault()} onDrop={drop}><div className="canvas-tools"><button><Plus size={14} /></button><button>−</button><button><Grid2X2 size={13} /></button></div><svg viewBox="0 0 620 520"><path d="M125 70 H235 M355 70 H405 M465 95 L465 160 M405 185 H355 M295 210 V280 M355 305 H405 M465 330 L380 385 M295 330 L320 385" /></svg>{nodes.map((n) => <button draggable onDragStart={(e) => e.dataTransfer.setData('text/plain', JSON.stringify({ id: n.id }))} onClick={() => setSelected(n.id)} className={`flow-node ${selected === n.id ? 'active' : ''} type-${n.type}`} style={{ left: n.x, top: n.y }} key={n.id}><small>{n.type}</small><strong>{n.label}</strong></button>)}</Panel><div className="detail-stack inspector"><Panel><SectionTitle title="完成后通知" /><div className="toggle-line"><span><MessageSquare size={15} />微信研发群</span><Toggle defaultOn /></div><div className="toggle-line"><span><Send size={15} />飞书 On-call</span><Toggle defaultOn /></div><label className="field-label">模板<textarea defaultValue="{{workflow.name}} 已完成，耗时 {{duration}}，产物 {{asset.count}} 个。" /></label></Panel><Panel><SectionTitle title="选中节点" /><h2>{current.label}</h2><p className="muted-copy">配置该步骤使用的模型、插件权限、输入输出和失败处理。</p><SelectLabel label="模型" options={['GPT-5-Codex', 'GPT-5', 'DeepSeek']} /><InputLabel label="插件" value="Read, Write, Grep" /><InputLabel label="超时" value="20 分钟" /><SelectLabel label="失败处理" options={['重试 2 次', '立即停止', '跳过']} /><label className="field-label">Prompt<textarea defaultValue="根据测试结果和 diff 修改代码，保留用户已有改动，不执行破坏性命令。" /></label><div className="button-row"><button className="button secondary" onClick={() => { const id = Date.now(); setNodes([...nodes, { ...current, id, x: current.x + 25, y: current.y + 25 }]); notify('节点已复制') }}><Copy size={14} />复制节点</button><button className="button danger" onClick={() => { setNodes(nodes.filter((n) => n.id !== selected)); setSelected(nodes[0]?.id); notify('节点已删除') }}><Trash2 size={14} />删除节点</button></div></Panel></div></div>
  )
}

function QuickCreate({ type, close, notify }) {
  const titles = { chat: '新建会话', assets: '导出资产', channels: '连接渠道', schedules: '新建定时任务', config: '添加 Provider', plugins: '保存插件策略', memory: '新建记忆节点', mcp: '添加 MCP 服务', skills: '安装技能' }
  return <div className="modal-backdrop" onMouseDown={close}><form className="modal" onMouseDown={(e) => e.stopPropagation()} onSubmit={(e) => { e.preventDefault(); notify(`${titles[type]}成功`); close() }}><div className="card-head"><div><h2>{titles[type]}</h2><p>填写基本信息后即可继续配置。</p></div><button type="button" className="icon-button" onClick={close}><X size={17} /></button></div><InputLabel label="名称" value="" placeholder="输入名称" /><InputLabel label="描述" value="" placeholder="补充简短描述" /><SelectLabel label="类型" options={['默认', '自定义', '从模板创建']} /><div className="modal-actions"><button type="button" className="button secondary" onClick={close}>取消</button><button className="button primary"><Plus size={14} />确认创建</button></div></form></div>
}

function WorkflowMiniMap() {
  return <div className="workflow-mini-map"><svg viewBox="0 0 520 170"><path d="M90 85 H190 M250 85 H330 M390 85 H460 M220 110 V142 H330" /></svg>{[['触发器', 'Git push'], ['任务', '运行测试'], ['判断', '测试通过?'], ['任务', '生成报告'], ['通知', '飞书 + 微信']].map((n, i) => <span className={`mini-node mn-${i}`} key={n[1]}><small>{n[0]}</small><strong>{n[1]}</strong></span>)}</div>
}

function MarkdownMessage({ children }) {
  return <div className="markdown-body"><ReactMarkdown remarkPlugins={[remarkGfm]} components={{
    a: ({ children: label, ...props }) => <a {...props} target="_blank" rel="noreferrer">{label}</a>,
    code: ({ children: code, className, ...props }) => <code className={className || ''} {...props}>{code}</code>,
  }}>{children}</ReactMarkdown></div>
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

function TiledEmptyState({ hasQuery }) { return <Panel className="empty-state"><Grid2X2 size={24} /><h2>{hasQuery ? '没有匹配的平铺会话' : '尚未选择平铺会话'}</h2><p>{hasQuery ? '更换搜索关键词，或从历史会话中加入其他会话。' : '点击历史会话右侧的平铺图标，把需要并行关注的会话加入这里。'}</p></Panel> }

export default App
