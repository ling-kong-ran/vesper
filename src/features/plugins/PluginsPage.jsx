import { useCallback, useEffect, useRef, useState } from 'react'
import { AlertTriangle, CircleDot, Eye, FileCode2, FolderOpen, Image, Pencil, Plug, RefreshCw, Save, Search, Server, ShieldCheck } from 'lucide-react'
import { Badge, Panel, SectionTitle, Segmented, Toggle } from '../../components/ui.jsx'
import { apiJson } from '../../lib/api.js'
import { relativeTime } from '../../lib/format.js'

const FILTERS = ['全部', '文件系统', '搜索', '终端', '视觉', '高风险', '已禁用']
const PRESETS = {
  'read-only': ['read', 'grep', 'find', 'ls'],
  workspace: ['read', 'grep', 'find', 'ls', 'edit', 'write'],
  full: ['read', 'grep', 'find', 'ls', 'edit', 'write', 'bash'],
}
const TOOL_ICONS = {
  read: Eye,
  ls: FolderOpen,
  grep: Search,
  find: Search,
  edit: Pencil,
  write: FileCode2,
  bash: Server,
  generate_visual: Image,
}

function pluginStatus(tools) {
  return { enabled: tools.filter((tool) => tool.enabled).length, total: tools.length }
}

export function PluginsPage({ query, notify, saveSignal, onStatusChange }) {
  const [data, setData] = useState(null)
  const [draft, setDraft] = useState([])
  const [selectedId, setSelectedId] = useState('read')
  const [tab, setTab] = useState('全部')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const handledSaveSignal = useRef(saveSignal)

  useEffect(() => {
    apiJson('/api/plugins').then((result) => {
      setData(result)
      setDraft(result.tools)
      setSelectedId(result.tools[0]?.id || '')
      onStatusChange(pluginStatus(result.tools))
    }).catch((caught) => setError(caught.message))
  }, [onStatusChange])

  const dirty = Boolean(data) && draft.some((tool) => tool.enabled !== data.tools.find((item) => item.id === tool.id)?.enabled)
  const save = useCallback(async () => {
    if (!data || !dirty) {
      if (data) notify('插件策略没有变化')
      return
    }
    setSaving(true)
    setError('')
    try {
      const updated = await apiJson('/api/plugins', {
        method: 'PUT',
        body: JSON.stringify({ enabledTools: draft.filter((tool) => tool.enabled).map((tool) => tool.id) }),
      })
      setData(updated)
      setDraft(updated.tools)
      onStatusChange(pluginStatus(updated.tools))
      notify('插件策略已保存，Agent 运行时已更新')
    } catch (caught) {
      setError(caught.message)
    } finally {
      setSaving(false)
    }
  }, [data, dirty, draft, notify, onStatusChange])

  useEffect(() => {
    if (saveSignal > 0 && saveSignal !== handledSaveSignal.current) {
      handledSaveSignal.current = saveSignal
      save()
    }
  }, [saveSignal, save])

  if (!data) return <Panel className="empty-state"><RefreshCw className="spin" size={24} /><h2>正在加载工具插件</h2><p>读取 Agent 当前注册工具与权限…</p>{error && <div className="config-error"><AlertTriangle size={13} />{error}</div>}</Panel>

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
      <div className="plugin-toolbar"><Segmented options={FILTERS} value={tab} onChange={setTab} /><div className="plugin-presets"><span>预设</span><button className={data.preset === 'read-only' && !dirty ? 'active' : ''} onClick={() => applyPreset('read-only')}>只读</button><button className={data.preset === 'workspace' && !dirty ? 'active' : ''} onClick={() => applyPreset('workspace')}>工作区</button><button className={data.preset === 'full' && !dirty ? 'active' : ''} onClick={() => applyPreset('full')}>完整</button></div></div>
      <div className="two-one-grid plugin-layout"><Panel><div className="card-head"><SectionTitle title={`工具插件 · ${draft.filter((tool) => tool.enabled).length}/${draft.length}`} />{dirty && <Badge tone="amber">未保存</Badge>}</div>{filtered.length ? filtered.map((tool) => { const Icon = TOOL_ICONS[tool.id] || Plug; return <div className={`plugin-row ${selectedId === tool.id ? 'selected' : ''}`} key={tool.id}><button className="plugin-select" onClick={() => setSelectedId(tool.id)}><span className="list-icon"><Icon size={15} /></span><span><strong>{tool.name} <Badge tone={tool.risk === '高风险' ? 'red' : 'green'}>{tool.risk}</Badge></strong><small>{tool.description}</small></span></button><em>{tool.enabled ? '启用' : '禁用'}</em><Toggle value={tool.enabled} onChange={(enabled) => setDraft((current) => current.map((item) => item.id === tool.id ? { ...item, enabled } : item))} /></div> }) : <div className="plugin-empty">没有匹配的工具</div>}</Panel><div className="detail-stack"><Panel><div className="card-head"><SectionTitle title={`${selected.name} 插件策略`} /><Badge tone={selected.enabled ? 'green' : 'gray'}>{selected.enabled ? '已启用' : '已禁用'}</Badge></div><p className="muted-copy">{selected.description}</p>{[['工具 ID', selected.id], ['来源', selected.source === 'app' ? 'Pi Coder 应用工具' : 'Pi 内置工具'], ['分类', selected.category], ['风险等级', selected.risk], ['路径范围', selected.scope], ['能力', selected.capability], ['生效时间', '保存后下一次 Agent 请求']].map((row) => <div className="key-value" key={row[0]}><span>{row[0]}</span><strong className={row[1] === '高风险' ? 'danger' : ''}>{row[1]}</strong></div>)}<button className={`button wide ${selected.enabled ? 'danger' : 'primary'}`} onClick={() => setDraft((current) => current.map((item) => item.id === selected.id ? { ...item, enabled: !item.enabled } : item))}>{selected.enabled ? '禁用此工具' : '启用此工具'}</button></Panel><Panel><SectionTitle title="最近变更" />{data.changes.length ? data.changes.slice(0, 6).map((change, index) => <div className="activity-row" key={`${change.timestamp}-${change.tool}-${index}`}><CircleDot size={14} /><span><strong>{change.enabled ? '启用' : '禁用'} {change.name}</strong><small>{relativeTime(change.timestamp)}</small></span></div>) : <div className="plugin-empty compact">尚无权限变更记录</div>}</Panel><div className={`security-summary ${enabledHighRisk.length ? 'warning' : ''}`}><ShieldCheck size={18} /><div><strong>安全摘要</strong><p>{enabledHighRisk.length ? `${enabledHighRisk.length} 个高风险工具已启用：${enabledHighRisk.map((tool) => tool.name).join('、')}。所有路径均绑定当前会话工作目录。` : '当前没有启用高风险工具，Agent 仅拥有读取和搜索能力。'}</p></div></div></div></div>
      <button className="floating-save" disabled={!dirty || saving} onClick={save}>{saving ? <RefreshCw className="spin" size={15} /> : <Save size={15} />}{saving ? '保存中…' : dirty ? '保存策略' : '策略已保存'}</button>
      {error && <div className="config-error floating-error"><AlertTriangle size={13} />{error}</div>}
    </div>
  )
}
