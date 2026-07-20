import { useCallback, useEffect, useState } from 'react'
import { CircleDot, FileCode2, Image, Package, RefreshCw, Save, Server, Sparkles, Trash2, Wrench } from 'lucide-react'
import { useI18n } from '../../app/use-i18n.js'
import { Badge, Metric, Panel, SectionTitle, Segmented, Toggle } from '../../components/ui.jsx'
import { usePagePrimaryAction } from '../../hooks/usePagePrimaryAction.js'
import { apiJson } from '../../lib/api.js'
import { relativeTime } from '../../lib/format.js'

function mcpStatusMeta(status) {
  return {
    online: ['在线', 'green'],
    connecting: ['连接中', 'amber'],
    unauthorized: ['未授权', 'gray'],
    disabled: ['已禁用', 'gray'],
    offline: ['离线', 'red'],
  }[status] || ['离线', 'red']
}

function mcpAuthLabel(service, t) {
  if (!service) return '—'
  if (service.auth === 'headers') return t('{count} 个请求头', { count: service.authCount })
  if (service.auth === 'environment') return t('已配置环境变量')
  if (service.auth === 'local') return t('本地进程')
  return t('无')
}

function skillIcon(skill) {
  const text = `${skill?.name || ''} ${skill?.description || ''}`.toLowerCase()
  if (/image|visual|design|figma|svg|图片|视觉|设计/.test(text)) return Image
  if (/doc|pdf|文档|说明/.test(text)) return FileCode2
  if (/install|package|market|安装|包/.test(text)) return Package
  if (/code|test|plugin|skill|代码|测试|插件|技能/.test(text)) return Wrench
  return Sparkles
}

function skillMatchesFilter(skill, filter) {
  if (filter === '全部' || filter === '已安装') return true
  if (filter === '可安装') return false
  const text = `${skill.name} ${skill.description} ${(skill.allowedTools || []).join(' ')}`.toLowerCase()
  if (filter === '设计') return /image|visual|design|figma|svg|图片|视觉|设计/.test(text)
  if (filter === '代码') return /code|test|plugin|代码|测试|插件/.test(text)
  if (filter === '文档') return /doc|pdf|文档|说明/.test(text)
  if (filter === '高权限') return (skill.allowedTools || []).some((tool) => ['bash', 'write', 'edit'].includes(tool))
  return true
}

export function McpPage({ notify, query = '', registerPrimaryAction, requestText, requestConfirm }) {
  const { t, language } = useI18n()
  const [data, setData] = useState(null)
  const [selectedId, setSelectedId] = useState('')
  const [busy, setBusy] = useState(false)
  const [, setError] = useState('')

  const load = useCallback(async (refresh = true) => {
    setError('')
    try {
      const result = await apiJson(`/api/mcp?refresh=${refresh ? '1' : '0'}`)
      setData(result)
      setSelectedId((current) => result.services.some((service) => service.id === current) ? current : result.services[0]?.id || '')
      return result
    } catch (caught) {
      setError(caught.message)
      return null
    }
  }, [])

  useEffect(() => {
    void load(true)
    const timer = window.setInterval(() => { void load(false) }, 10_000)
    return () => window.clearInterval(timer)
  }, [load])

  const addService = useCallback(async () => {
    const spec = await requestText?.({
      title: t('添加 MCP 服务'),
      message: t('输入 Streamable HTTP URL、stdio 命令，或包含 headers/env 的 JSON 配置。'),
      inputLabel: t('服务配置'),
      placeholder: 'https://server.example.com/mcp',
      maxLength: 12_000,
      confirmLabel: t('继续'),
    })
    if (!spec?.trim()) return
    const approved = await requestConfirm?.({
      title: t('连接 MCP 服务'),
      message: t('MCP 服务可以提供会执行外部操作的工具。仅连接你信任的服务。'),
      confirmLabel: t('连接'),
      tone: 'danger',
    })
    if (approved === false) return
    setBusy(true)
    setError('')
    try {
      const result = await apiJson('/api/mcp', { method: 'POST', body: JSON.stringify({ spec }) })
      setData(result)
      setSelectedId(result.services.at(-1)?.id || result.services[0]?.id || '')
      notify(t('MCP 服务已添加'), 'success')
    } catch (caught) {
      setError(caught.message)
      notify(caught.message, 'error')
    } finally {
      setBusy(false)
    }
  }, [notify, requestConfirm, requestText, t])

  usePagePrimaryAction(registerPrimaryAction, addService)

  const services = data?.services || []
  const visibleServices = services.filter((service) => `${service.name} ${service.endpoint}`.toLowerCase().includes(query.toLowerCase()))
  const selected = services.find((service) => service.id === selectedId) || visibleServices[0] || services[0] || null
  const tools = (data?.tools || []).filter((tool) => `${tool.name} ${tool.serviceName} ${tool.description}`.toLowerCase().includes(query.toLowerCase()))
  const calls = (data?.calls || []).filter((call) => !selected || call.serviceId === selected.id)
  const metrics = data?.metrics || { totalServices: 0, onlineServices: 0, availableTools: 0, restrictedTools: 0, errorRate: 0 }

  const toggleTool = async (tool, enabled) => {
    setBusy(true)
    setError('')
    try {
      setData(await apiJson(`/api/mcp/${encodeURIComponent(tool.serviceId)}/tools/${encodeURIComponent(tool.name)}`, {
        method: 'PATCH', body: JSON.stringify({ enabled }),
      }))
    } catch (caught) {
      setError(caught.message)
    } finally {
      setBusy(false)
    }
  }

  const toggleServer = async (enabled) => {
    if (!selected) return
    setBusy(true)
    setError('')
    try {
      setData(await apiJson(`/api/mcp/${encodeURIComponent(selected.id)}`, {
        method: 'PATCH', body: JSON.stringify({ enabled }),
      }))
      notify(t(enabled ? 'MCP 服务已启用' : 'MCP 服务已禁用'), 'success')
    } catch (caught) {
      setError(caught.message)
    } finally {
      setBusy(false)
    }
  }

  const testConnection = async () => {
    if (!selected) return
    setBusy(true)
    setError('')
    try {
      setData(await apiJson(`/api/mcp/${encodeURIComponent(selected.id)}/test`, { method: 'POST', body: '{}' }))
      notify(t('MCP 连接测试通过'), 'success')
    } catch (caught) {
      setError(caught.message)
      notify(caught.message, 'error')
    } finally {
      setBusy(false)
    }
  }

  const deleteServer = async () => {
    if (!selected) return
    const approved = await requestConfirm?.({
      title: t('删除 MCP 服务'),
      message: t('删除后，该服务提供的工具会从后续 Agent 运行中移除。'),
      confirmLabel: t('删除'),
      tone: 'danger',
    })
    if (approved === false) return
    setBusy(true)
    setError('')
    try {
      await apiJson(`/api/mcp/${encodeURIComponent(selected.id)}`, { method: 'DELETE' })
      const result = await load(false)
      setSelectedId(result?.services[0]?.id || '')
      notify(t('MCP 服务已删除'), 'success')
    } catch (caught) {
      setError(caught.message)
      notify(caught.message, 'error')
    } finally {
      setBusy(false)
    }
  }

  return <div className="preview-page">
    <div className="mcp-layout">
      <Panel className="selection-list"><SectionTitle title={t('服务')} />{visibleServices.map((service) => { const [label, tone] = mcpStatusMeta(service.status); const location = service.transport === 'stdio' ? service.workingDirectory || service.command : service.endpoint; return <button className={`service-row ${selected?.id === service.id ? 'active' : ''}`} onClick={() => setSelectedId(service.id)} key={service.id}><span className="list-icon"><Server size={15} /></span><span><strong>{service.name}</strong><small title={location}>{location}</small></span><Badge tone={tone}>{t(label)}</Badge></button> })}</Panel>
      <div className="mcp-center">
        <div className="metric-grid"><Metric value={String(metrics.onlineServices)} label={t('在线服务')} note={t('共 {count} 个服务', { count: metrics.totalServices })} tone="blue" /><Metric value={String(metrics.availableTools)} label={t('可用工具')} note={t('{count} 个受限工具', { count: metrics.restrictedTools })} tone="green" /><Metric value={`${metrics.errorRate}%`} label={t('错误率')} note="24h" tone="amber" /></div>
        <Panel><SectionTitle title={t('工具能力')} />{tools.map((tool) => <div className="tool-row" key={tool.piName}><span className="list-icon"><Wrench size={15} /></span><span><strong>{tool.name}</strong><small>{tool.serviceName} · {tool.description}</small></span><Badge tone={tool.risk === '高风险' ? 'red' : tool.risk === '中风险' ? 'amber' : 'green'}>{t(tool.risk)}</Badge><Toggle value={tool.enabled} disabled={busy || !tool.serviceEnabled} ariaLabel={t('切换工具 {name}', { name: tool.name })} onChange={(enabled) => void toggleTool(tool, enabled)} /></div>)}</Panel>
      </div>
      <div className="detail-stack">
        <Panel><SectionTitle title={t('当前服务')} /><h2>{selected?.name || t('尚未配置服务')}</h2><p className="muted-copy">{selected?.error || (selected ? t('该服务已通过标准 MCP transport 暴露工具，启用的工具会在新 Agent Runtime 中注册。') : t('使用右上角按钮添加 Streamable HTTP 或 stdio MCP 服务。'))}</p>{[[t('Transport'), selected?.transport === 'stdio' ? 'stdio' : selected?.transport === 'sse' ? 'HTTP + SSE' : 'Streamable HTTP'], ...(selected?.transport === 'stdio' ? [[t('可执行文件'), selected.command || '—'], [t('工作目录'), selected.workingDirectory || '—']] : [[t('服务地址'), selected?.endpoint || '—']]), [t('Latency'), selected?.latencyMs == null ? '—' : `${selected.latencyMs} ms`], [t('Last Ping'), selected?.lastPingAt ? relativeTime(selected.lastPingAt, language) : '—'], [t('Auth'), mcpAuthLabel(selected, t)]].map((row) => <div className="key-value" key={row[0]}><span>{row[0]}</span><strong title={row[1]}>{row[1]}</strong></div>)}<div className="toggle-line"><span>{t('服务启用')}</span><Toggle value={Boolean(selected?.enabled)} disabled={!selected || busy} ariaLabel={t('切换 MCP 服务')} onChange={(enabled) => void toggleServer(enabled)} /></div><div className="button-row"><button className="button secondary" disabled={!selected?.enabled || busy} onClick={testConnection}><RefreshCw className={busy ? 'spin' : ''} size={14} />{t('测试连接')}</button><button className="button danger" disabled={!selected || busy} onClick={deleteServer}><Trash2 size={14} />{t('删除')}</button></div></Panel>
        <Panel><SectionTitle title={t('最近调用')} />{calls.map((activity) => <div className="activity-row" key={activity.id}><CircleDot size={14} /><span><strong>{activity.toolName}</strong><small>{relativeTime(activity.timestamp, language)} · {activity.status === 'ok' ? 'OK' : activity.error || 'Error'} · {activity.durationMs} ms</small></span></div>)}</Panel>
      </div>
    </div>
  </div>
}

export function SkillsPage({ notify, query = '', registerPrimaryAction, requestText, requestConfirm }) {
  const { t } = useI18n()
  const [data, setData] = useState(null)
  const [selectedId, setSelectedId] = useState('')
  const [filter, setFilter] = useState('全部')
  const [busy, setBusy] = useState(false)
  const [, setError] = useState('')
  const filters = ['全部', '已安装', '可安装', '设计', '代码', '文档', '高权限']

  const load = useCallback(async () => {
    setError('')
    try {
      const result = await apiJson('/api/skills')
      setData(result)
      setSelectedId((current) => result.skills.some((skill) => skill.id === current) ? current : result.skills[0]?.id || '')
      return result
    } catch (caught) {
      setError(caught.message)
      return null
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const installSkill = useCallback(async () => {
    const source = await requestText?.({
      title: t('安装技能'),
      message: t('输入本地技能目录、SKILL.md、npm 包或 git 来源。Vesper 只导入其中的技能资源。'),
      inputLabel: t('技能来源'),
      placeholder: 'npm:@scope/pi-skills or ./path/to/skill',
      maxLength: 2_000,
      confirmLabel: t('继续'),
    })
    if (!source?.trim()) return
    const approved = await requestConfirm?.({
      title: t('安装技能'),
      message: t('技能会向 Agent 提供指令，并可能包含可执行脚本。请确认该来源可信。'),
      confirmLabel: t('安装'),
      tone: 'danger',
    })
    if (approved === false) return
    setBusy(true)
    setError('')
    try {
      const result = await apiJson('/api/skills/install', { method: 'POST', body: JSON.stringify({ source }) })
      setData(result)
      setSelectedId(result.installed?.[0]?.id || result.skills[0]?.id || '')
      notify(t('技能已安装并载入 Agent Runtime'), 'success')
    } catch (caught) {
      setError(caught.message)
      notify(caught.message, 'error')
    } finally {
      setBusy(false)
    }
  }, [notify, requestConfirm, requestText, t])

  usePagePrimaryAction(registerPrimaryAction, installSkill)

  const skills = data?.skills || []
  const filteredSkills = skills.filter((skill) => skillMatchesFilter(skill, filter) && `${skill.name} ${skill.description}`.toLowerCase().includes(query.toLowerCase()))
  const selected = skills.find((skill) => skill.id === selectedId) || filteredSkills[0] || skills[0] || null
  const packages = data?.packages || []
  const market = (packages.length
    ? packages.map((item) => ({ name: item.source, description: item.scope === 'project' ? t('项目级 Pi Package') : t('用户级 Pi Package'), status: item.installed ? t('已安装') : t('可安装') }))
    : [{ name: t('暂无已配置技能包'), description: t('使用右上角“安装技能”接入本地目录、npm 或 git 来源'), status: t('可安装') }])
    .filter((item) => `${item.name} ${item.description}`.toLowerCase().includes(query.toLowerCase()))

  const updateSkill = async (skill, patch) => {
    if (!skill) return
    setBusy(true)
    setError('')
    try {
      const updated = await apiJson(`/api/skills/${encodeURIComponent(skill.id)}`, { method: 'PATCH', body: JSON.stringify(patch) })
      setData((current) => {
        const skills = current.skills.map((item) => item.id === updated.id ? updated : item)
        return {
          ...current,
          skills,
          counts: {
            ...current.counts,
            enabled: skills.filter((item) => item.enabled).length,
            modelInvocable: skills.filter((item) => item.enabled && item.modelInvocationEnabled).length,
          },
        }
      })
    } catch (caught) {
      setError(caught.message)
    } finally {
      setBusy(false)
    }
  }

  const saveSettings = async () => {
    setBusy(true)
    setError('')
    try {
      setData(await apiJson('/api/skills/reload', { method: 'POST', body: '{}' }))
      notify(t('技能设置已保存并重新载入'), 'success')
    } catch (caught) {
      setError(caught.message)
    } finally {
      setBusy(false)
    }
  }

  const uninstallSkill = async () => {
    if (!selected?.removable) return
    const approved = await requestConfirm?.({
      title: t('卸载技能'),
      message: t('将删除由 Vesper 安装的技能目录。此操作不会卸载原始 npm 或 git 包。'),
      confirmLabel: t('卸载'),
      tone: 'danger',
    })
    if (approved === false) return
    setBusy(true)
    setError('')
    try {
      await apiJson(`/api/skills/${encodeURIComponent(selected.id)}`, { method: 'DELETE' })
      const result = await load()
      setSelectedId(result?.skills[0]?.id || '')
      notify(t('技能已卸载'), 'success')
    } catch (caught) {
      setError(caught.message)
      notify(caught.message, 'error')
    } finally {
      setBusy(false)
    }
  }

  return <div className="skills-page">
    <Segmented options={filters.map(t)} value={t(filter)} onChange={(label) => setFilter(filters.find((item) => t(item) === label) || '全部')} />
    <div className="skills-layout">
      <Panel><SectionTitle title={t('已安装技能')} />{filteredSkills.map((skill) => { const Icon = skillIcon(skill); return <button className={`skill-row ${selected?.id === skill.id ? 'selected' : ''}`} onClick={() => setSelectedId(skill.id)} key={skill.id}><span className="list-icon"><Icon size={15} /></span><span><strong>{skill.name}</strong><small>{skill.description}</small></span><Toggle value={skill.enabled} disabled={busy} ariaLabel={t('切换技能 {name}', { name: skill.name })} onChange={(enabled) => void updateSkill(skill, { enabled })} /></button>})}</Panel>
      <Panel><div className="card-head"><SectionTitle title={t('技能市场')} /><a>{t('{count} 个技能包', { count: packages.length })}</a></div>{market.map((skill) => <div className="market-row" key={skill.name}><span className="list-icon"><Sparkles size={15} /></span><span><strong>{skill.name}</strong><small>{skill.description}</small></span><Badge tone={skill.status === t('已安装') ? 'green' : 'blue'}>{skill.status}</Badge></div>)}</Panel>
      <div className="detail-stack">
        <Panel><SectionTitle title={t('选中技能')} /><h2>{selected?.name || t('尚未安装技能')}</h2><p className="muted-copy">{selected?.description || t('使用右上角按钮安装符合 Agent Skills 标准的技能。')}</p>{[[t('触发方式'), selected?.modelInvocationEnabled ? t('自动 + 手动') : t('仅手动')], [t('权限'), selected?.allowedTools?.length ? selected.allowedTools.join(', ') : t('按会话工具权限')], [t('版本'), selected?.version || 'latest'], [t('来源'), selected?.source || '—']].map((row) => <div className="key-value" key={row[0]}><span>{row[0]}</span><strong>{row[1]}</strong></div>)}<button className={`button ${selected?.removable ? 'danger' : 'primary'} wide`} disabled={busy} onClick={selected?.removable ? uninstallSkill : saveSettings}>{selected?.removable ? <Trash2 size={14} /> : <Save size={14} />}{t(selected?.removable ? '卸载技能' : '保存设置')}</button></Panel>
        <Panel><SectionTitle title={t('触发条件')} />{[[t('允许模型自动调用'), Boolean(selected?.modelInvocationEnabled), false, (checked) => void updateSkill(selected, { modelInvocationEnabled: checked })], [t('支持 /skill 手动命令'), Boolean(selected?.command), true], [t('项目范围技能'), selected?.sourceInfo?.scope === 'project', true], [t('声明所需工具'), Boolean(selected?.allowedTools?.length), true]].map(([item, checked, disabled, onChange]) => <label className="check-row" key={item}><input type="checkbox" checked={checked} disabled={!selected || busy || disabled} onChange={(event) => onChange?.(event.target.checked)} /><span>{item}</span></label>)}</Panel>
      </div>
    </div>
  </div>
}
