import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Bot, CircleDot, Eye, FileCode2, FolderOpen, Globe2, Image, Pencil, Plug, RefreshCw, Save, Search, Server, ShieldCheck } from 'lucide-react'
import { Badge, Panel, SectionTitle, Segmented, Toggle } from '../../components/ui.jsx'
import { useI18n } from '../../app/use-i18n.js'
import { apiJson } from '../../lib/api.js'
import { relativeTime } from '../../lib/format.js'
import { usePagePrimaryAction } from '../../hooks/usePagePrimaryAction.js'

const FILTERS = ['全部', '文件系统', '搜索', '终端', '视觉', '高风险', '已禁用']
const PRESETS = {
  'read-only': ['read', 'grep', 'find', 'ls', 'web_search', 'browser_automation', 'memory_search', 'memory_remember', 'spawn_agent', 'list_agents', 'send_message', 'followup_task', 'wait_agent', 'interrupt_agent', 'mcp_list', 'mcp_manage'],
  workspace: ['read', 'grep', 'find', 'ls', 'edit', 'write', 'web_search', 'browser_automation', 'memory_search', 'memory_remember', 'spawn_agent', 'list_agents', 'send_message', 'followup_task', 'wait_agent', 'interrupt_agent', 'mcp_list', 'mcp_manage'],
  full: ['read', 'grep', 'find', 'ls', 'edit', 'write', 'bash', 'web_search', 'browser_automation', 'generate_visual', 'memory_search', 'memory_remember', 'spawn_agent', 'list_agents', 'send_message', 'followup_task', 'wait_agent', 'interrupt_agent', 'mcp_list', 'mcp_manage'],
}
const TOOL_ICONS = {
  read: Eye,
  ls: FolderOpen,
  grep: Search,
  find: Search,
  edit: Pencil,
  write: FileCode2,
  bash: Server,
  web_search: Globe2,
  generate_visual: Image,
  spawn_agent: Bot,
  list_agents: Bot,
  send_message: Bot,
  followup_task: Bot,
  wait_agent: Bot,
  interrupt_agent: Bot,
}

function pluginStatus(tools) {
  return { enabled: tools.filter((tool) => tool.enabled).length, total: tools.length }
}

export function PluginsPage({ query, notify, registerPrimaryAction, onStatusChange }) {
  const { t, language } = useI18n()
  const [data, setData] = useState(null)
  const [draft, setDraft] = useState([])
  const [selectedId, setSelectedId] = useState('read')
  const [tab, setTab] = useState('全部')
  const [saving, setSaving] = useState(false)
  const [testingSearch, setTestingSearch] = useState(false)
  const [webSearch, setWebSearch] = useState({ provider: 'bing', language: 'auto', safeSearch: 1, maxResults: 8 })
  const [error, setError] = useState('')

  useEffect(() => {
    apiJson('/api/plugins').then((result) => {
      setData(result)
      setDraft(result.tools)
      setWebSearch(result.webSearch)
      setSelectedId(result.tools[0]?.id || '')
      onStatusChange(pluginStatus(result.tools))
    }).catch((caught) => setError(caught.message))
  }, [onStatusChange])

  const dirty = Boolean(data) && (
    draft.some((tool) => tool.enabled !== data.tools.find((item) => item.id === tool.id)?.enabled)
    || JSON.stringify(webSearch) !== JSON.stringify(data.webSearch)
  )
  const save = useCallback(async () => {
    if (!data || !dirty) {
      if (data) notify(t('插件策略没有变化'))
      return
    }
    setSaving(true)
    setError('')
    try {
      const updated = await apiJson('/api/plugins', {
        method: 'PUT',
        body: JSON.stringify({ enabledTools: draft.filter((tool) => tool.enabled).map((tool) => tool.id), webSearch }),
      })
      setData(updated)
      setDraft(updated.tools)
      setWebSearch(updated.webSearch)
      onStatusChange(pluginStatus(updated.tools))
      notify(t('插件策略已保存，Agent 运行时已更新'))
    } catch (caught) {
      setError(caught.message)
    } finally {
      setSaving(false)
    }
  }, [data, dirty, draft, notify, onStatusChange, t, webSearch])

  const testWebSearch = async () => {
    setTestingSearch(true)
    setError('')
    try {
      const result = await apiJson('/api/plugins/web-search/test', { method: 'POST', body: JSON.stringify(webSearch) })
      notify(t('Bing 搜索可用，返回 {count} 条结果', { count: result.count }))
    } catch (caught) {
      setError(caught.message)
      notify(caught.message, 'error')
    } finally {
      setTestingSearch(false)
    }
  }

  usePagePrimaryAction(registerPrimaryAction, save)

  if (!data) return <Panel className="empty-state"><RefreshCw className="spin" size={24} /><h2>{t('正在加载工具插件')}</h2><p>{t('读取 Agent 当前注册工具与权限…')}</p>{error && <div className="config-error"><AlertTriangle size={13} />{error}</div>}</Panel>

  const selected = draft.find((tool) => tool.id === selectedId) || draft[0]
  const filtered = draft.filter((tool) => {
    if (tab === '高风险' && tool.risk !== '高风险') return false
    if (tab === '已禁用' && tool.enabled) return false
    if (!['全部', '高风险', '已禁用'].includes(tab) && tool.category !== tab) return false
    return `${tool.name} ${tool.id} ${tool.description}`.toLowerCase().includes(query.toLowerCase())
  })
  const applyPreset = (preset) => {
    const tools = PRESETS[preset]
    setDraft((current) => current.map((tool) => ({ ...tool, enabled: tools.includes(tool.id) })))
  }
  const enabledHighRisk = draft.filter((tool) => tool.enabled && tool.risk === '高风险')

  return (
    <div className="plugins-page">
      <div className="plugin-toolbar"><Segmented options={FILTERS.map(t)} value={t(tab)} onChange={(label) => setTab(FILTERS.find((source) => t(source) === label) || '全部')} /><div className="plugin-presets"><span>{t('预设')}</span><button className={data.preset === 'read-only' && !dirty ? 'active' : ''} onClick={() => applyPreset('read-only')}>{t('只读')}</button><button className={data.preset === 'workspace' && !dirty ? 'active' : ''} onClick={() => applyPreset('workspace')}>{t('工作区')}</button><button className={data.preset === 'full' && !dirty ? 'active' : ''} onClick={() => applyPreset('full')}>{t('完整')}</button></div></div>
      <div className="two-one-grid plugin-layout"><Panel><div className="card-head"><SectionTitle title={`${t('工具插件')} · ${draft.filter((tool) => tool.enabled).length}/${draft.length}`} />{dirty && <Badge tone="amber">{t('未保存')}</Badge>}</div>{filtered.length ? filtered.map((tool) => { const Icon = TOOL_ICONS[tool.id] || Plug; return <div className={`plugin-row ${selectedId === tool.id ? 'selected' : ''}`} key={tool.id}><button className="plugin-select" onClick={() => setSelectedId(tool.id)}><span className="list-icon"><Icon size={15} /></span><span><strong>{tool.name} <Badge tone={tool.risk === '高风险' ? 'red' : tool.risk === '中风险' ? 'amber' : 'green'}>{t(tool.risk)}</Badge></strong><small>{t(tool.description)}</small></span></button><em>{t(tool.enabled ? '启用' : '禁用')}</em><Toggle value={tool.enabled} onChange={(enabled) => setDraft((current) => current.map((item) => item.id === tool.id ? { ...item, enabled } : item))} /></div> }) : <div className="plugin-empty">{t('没有匹配的工具')}</div>}</Panel><div className="detail-stack"><Panel><div className="card-head"><SectionTitle title={t('{name} 插件策略', { name: selected.name })} /><Badge tone={selected.enabled ? 'green' : 'gray'}>{t(selected.enabled ? '已启用' : '已禁用')}</Badge></div><p className="muted-copy">{t(selected.description)}</p>{selected.id === 'web_search' && <div className="mb-3 grid gap-3 rounded-[10px] border border-[var(--stroke)] bg-[var(--surface-muted)] p-3"><div className="flex items-center gap-3 rounded-lg border border-[var(--stroke)] bg-[var(--solid)] p-3"><span className="grid size-9 shrink-0 place-items-center rounded-lg bg-[var(--surface-muted)] text-[var(--text-soft)]"><Globe2 size={17} /></span><span className="grid gap-0.5"><strong className="text-[13px] text-[var(--text)]">Bing</strong><small className="text-[12px] text-[var(--muted)]">{t('无需安装、无需 API Key，保存后即可由 Agent 使用。')}</small></span></div><div className="grid grid-cols-1 gap-2 sm:grid-cols-3"><label className="grid gap-1.5 text-[12px] font-semibold text-[var(--text-soft)]">{t('默认语言')}<select className="h-10 rounded-lg border border-[var(--stroke)] bg-[var(--solid)] px-2 text-[13px] text-[var(--text)]" value={webSearch.language} onChange={(event) => setWebSearch((current) => ({ ...current, language: event.target.value }))}><option value="auto">Auto</option><option value="zh-CN">简体中文</option><option value="en-US">English</option></select></label><label className="grid gap-1.5 text-[12px] font-semibold text-[var(--text-soft)]">{t('安全搜索')}<select className="h-10 rounded-lg border border-[var(--stroke)] bg-[var(--solid)] px-2 text-[13px] text-[var(--text)]" value={webSearch.safeSearch} onChange={(event) => setWebSearch((current) => ({ ...current, safeSearch: Number(event.target.value) }))}><option value={0}>{t('关闭')}</option><option value={1}>{t('适中')}</option><option value={2}>{t('严格')}</option></select></label><label className="grid gap-1.5 text-[12px] font-semibold text-[var(--text-soft)]">{t('结果数量')}<input type="number" min="1" max="12" className="h-10 rounded-lg border border-[var(--stroke)] bg-[var(--solid)] px-2 text-[13px] text-[var(--text)]" value={webSearch.maxResults} onChange={(event) => setWebSearch((current) => ({ ...current, maxResults: Number(event.target.value) }))} /></label></div><div className="flex items-center justify-between gap-3"><span className="text-[12px] leading-5 text-[var(--muted)]">{t('搜索词会发送到 Bing，请勿在查询中包含密钥或隐私数据。')}</span><button type="button" className="button secondary shrink-0" disabled={testingSearch} onClick={testWebSearch}>{testingSearch ? <RefreshCw className="spin" size={14} /> : <Globe2 size={14} />}{t(testingSearch ? '测试中…' : '测试连接')}</button></div></div>}{[[t('工具 ID'), selected.id], [t('来源'), t(selected.source === 'app' ? 'Pi Coder 应用工具' : 'Pi 内置工具')], [t('分类'), t(selected.category)], [t('风险等级'), t(selected.risk)], [t('路径范围'), t(selected.scope)], [t('能力'), t(selected.capability)], [t('生效时间'), t('保存后下一次 Agent 请求')]].map((row) => <div className="key-value" key={row[0]}><span>{row[0]}</span><strong className={row[1] === t('高风险') ? 'danger' : ''}>{row[1]}</strong></div>)}<button className={`button wide ${selected.enabled ? 'danger' : 'primary'}`} onClick={() => setDraft((current) => current.map((item) => item.id === selected.id ? { ...item, enabled: !item.enabled } : item))}>{t(selected.enabled ? '禁用此工具' : '启用此工具')}</button></Panel><Panel><SectionTitle title={t('最近变更')} />{data.changes.length ? data.changes.slice(0, 6).map((change, index) => <div className="activity-row" key={`${change.timestamp}-${change.tool}-${index}`}><CircleDot size={14} /><span><strong>{t(change.enabled ? '启用' : '禁用')} {change.name}</strong><small>{relativeTime(change.timestamp, language)}</small></span></div>) : <div className="plugin-empty compact">{t('尚无权限变更记录')}</div>}</Panel><div className={`security-summary ${enabledHighRisk.length ? 'warning' : ''}`}><ShieldCheck size={18} /><div><strong>{t('安全摘要')}</strong><p>{enabledHighRisk.length ? t('{count} 个高风险工具已启用：{tools}。所有路径均绑定当前会话工作目录。', { count: enabledHighRisk.length, tools: enabledHighRisk.map((tool) => tool.name).join(language === 'en-US' ? ', ' : '、') }) : t('当前没有启用高风险工具，Agent 仅拥有读取和搜索能力。')}</p></div></div></div></div>
      <button className="floating-save" disabled={!dirty || saving} onClick={save}>{saving ? <RefreshCw className="spin" size={15} /> : <Save size={15} />}{t(saving ? '保存中…' : dirty ? '保存策略' : '策略已保存')}</button>
      {error && <div className="config-error floating-error"><AlertTriangle size={13} />{error}</div>}
    </div>
  )
}
