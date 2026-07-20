import { useCallback, useEffect, useRef, useState } from 'react'
import { Bell, Bot, ChevronDown, ChevronRight, CircleDot, Clock3, Code2, Copy, File, FileCode2, GitBranch, Grid2X2, Image, MessageSquare, Network, Package, Pencil, Plus, RefreshCw, Rocket, Save, Search, Send, Server, ShieldCheck, Sparkles, Square, Trash2, Wrench, Zap } from 'lucide-react'
import { useI18n } from '../../app/use-i18n.js'
import { Badge, InputLabel, Metric, Panel, PreviewNotice, SectionTitle, Segmented, SelectLabel, Toggle } from '../../components/ui.jsx'
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

export function WorkflowsPage({ navigate, notify }) {
  const { t } = useI18n()
  const filters = ['全部', '预设', '自定义', '运行中', '失败', '草稿']
  const templates = [
    ['代码审查', '读取 diff → 运行测试 → 生成 review', Code2], ['PR 修复', '定位失败 → 修改代码 → 回归测试', GitBranch],
    ['资料调研', '搜索资料 → 提取引用 → 点亮星忆', Search], ['日报周报', '汇总会话 → 生成摘要 → 渠道通知', File],
    ['资产生成', '生成图片 → 存入资产库 → 通知验收', Image], ['发布准备', '版本检查 → changelog → 创建发布单', Rocket],
  ]
  const runs = [
    ['PR 修复 #284', '回归测试', 72, 'blue'], ['资料调研：MCP Auth', '整理引用', 46, 'violet'],
    ['资产生成：活动页', '等待验收', 88, 'green'], ['发布准备 v2.8', '生成 changelog', 31, 'amber'],
  ]

  return <div className="workflows-page">
    <PreviewNotice>Workflows 页面当前是产品原型，运行数、队列和进度均为演示数据。</PreviewNotice>
    <Segmented options={filters.map(t)} value={t('全部')} onChange={() => {}} />
    <div className="workflow-top">
      <Panel><div className="card-head"><SectionTitle title={t('常见预设')} /><a>6 templates</a></div><div className="template-grid">{templates.map((template) => { const Icon = template[2]; return <button onClick={() => { navigate('workflowCreate'); notify(t('已载入「{name}」演示模板', { name: t(template[0]) }), 'info') }} key={template[0]}><span className="list-icon"><Icon size={15} /></span><span><strong>{t(template[0])}</strong><small>{t(template[1])}</small></span><ChevronRight size={14} /></button>})}</div></Panel>
      <Panel className="workflow-preview"><div className="card-head"><SectionTitle title={t('自定义工作流')} /><button className="text-button" onClick={() => navigate('workflowCreate')}>{t('空白创建')}</button></div><WorkflowMiniMap /></Panel>
    </div>
    <div className="workflow-bottom">
      <Panel><div className="card-head"><SectionTitle title={t('并行运行')} /><a>3 running · 5 queued</a></div>{runs.map((run) => <div className="run-row" key={run[0]}><span><strong>{t(run[0])}</strong><small>{t(run[1])}</small></span><div className="run-progress"><i className={run[3]} style={{ width: `${run[2]}%` }} /></div><em>{run[2]}%</em><button onClick={() => notify(t('演示任务没有真实运行实例'), 'info')}><Square size={12} />{t('停止')}</button></div>)}</Panel>
      <Panel><SectionTitle title={t('队列与限制')} />{[[t('最大并发'), '4', t('当前 3 个运行')], [t('失败重试'), t('2 次'), t('指数退避')], [t('默认模型'), 'GPT-5-Codex', t('可按步骤覆盖')], [t('完成推送'), t('已启用'), t('工作流结束后发送模板消息')]].map((row) => <div className="setting-row" key={row[0]}><span><strong>{row[0]}</strong><small>{row[2]}</small></span><button>{row[1]} <ChevronDown size={12} /></button></div>)}</Panel>
    </div>
  </div>
}

export function WorkflowBuilder({ notify }) {
  const { t } = useI18n()
  const canvasRef = useRef(null)
  const [nodes, setNodes] = useState([
    { id: 1, label: 'Git push', type: '触发器', x: 65, y: 45 }, { id: 2, label: '读取 diff', type: '任务', x: 235, y: 45 },
    { id: 3, label: '是否需要测试', type: '判断', x: 405, y: 45 }, { id: 4, label: '测试 + lint', type: '并行', x: 235, y: 160 },
    { id: 5, label: '生成修复计划', type: '任务', x: 405, y: 160 }, { id: 6, label: '修改代码', type: '任务', x: 235, y: 280 },
    { id: 7, label: '人工确认', type: '审批', x: 405, y: 280 }, { id: 8, label: '发送结果', type: '通知', x: 320, y: 385 },
  ])
  const [selected, setSelected] = useState(6)
  const palette = [['Git Push', Zap], ['定时', Clock3], ['手动输入', Pencil], ['运行 Prompt', Bot], ['读写文件', FileCode2], ['调用 MCP', Server], ['发送通知', Bell], ['条件判断', GitBranch], ['并行分支', Network], ['等待审批', ShieldCheck]]
  const drop = (event) => {
    event.preventDefault()
    const data = JSON.parse(event.dataTransfer.getData('text/plain') || '{}')
    const box = canvasRef.current.getBoundingClientRect()
    const x = Math.max(10, event.clientX - box.left - 60)
    const y = Math.max(10, event.clientY - box.top - 25)
    if (data.id) setNodes(nodes.map((node) => node.id === data.id ? { ...node, x, y } : node))
    else if (data.label) { const id = Date.now(); setNodes([...nodes, { id, label: data.label, type: '节点', x, y }]); setSelected(id) }
  }
  const current = nodes.find((node) => node.id === selected) || nodes[0]

  return <div className="preview-page">
    <PreviewNotice>工作流编辑器当前仅用于交互预览，发布和试运行不会启动真实工作流。</PreviewNotice>
    <div className="builder-layout">
      <Panel className="node-library"><SectionTitle title={t('节点库')} />{palette.map(([label, Icon], index) => <div key={label}><small>{[0, 3, 7].includes(index) ? t(['触发', '动作', '控制'][[0, 3, 7].indexOf(index)]) : ''}</small><button draggable onDragStart={(event) => event.dataTransfer.setData('text/plain', JSON.stringify({ label }))}><Icon size={15} />{t(label)}<span>{t('拖拽')}</span></button></div>)}</Panel>
      <Panel className="builder-canvas" ref={canvasRef} onDragOver={(event) => event.preventDefault()} onDrop={drop}><div className="canvas-tools"><button><Plus size={14} /></button><button>−</button><button><Grid2X2 size={13} /></button></div><svg viewBox="0 0 620 520"><path d="M125 70 H235 M355 70 H405 M465 95 L465 160 M405 185 H355 M295 210 V280 M355 305 H405 M465 330 L380 385 M295 330 L320 385" /></svg>{nodes.map((node) => <button draggable onDragStart={(event) => event.dataTransfer.setData('text/plain', JSON.stringify({ id: node.id }))} onClick={() => setSelected(node.id)} className={`flow-node ${selected === node.id ? 'active' : ''} type-${node.type}`} style={{ left: node.x, top: node.y }} key={node.id}><small>{t(node.type)}</small><strong>{t(node.label)}</strong></button>)}</Panel>
      <div className="detail-stack inspector">
        <Panel><SectionTitle title={t('完成后通知')} /><div className="toggle-line"><span><MessageSquare size={15} />{t('微信研发群')}</span><Toggle defaultOn /></div><div className="toggle-line"><span><Send size={15} />{t('飞书 On-call')}</span><Toggle defaultOn /></div><label className="field-label">{t('模板')}<textarea defaultValue={t('{{workflow.name}} 已完成，耗时 {{duration}}，产物 {{asset.count}} 个。')} /></label></Panel>
        <Panel><SectionTitle title={t('选中节点')} /><h2>{t(current.label)}</h2><p className="muted-copy">{t('配置该步骤使用的模型、插件权限、输入输出和失败处理。')}</p><SelectLabel label={t('模型')} options={['GPT-5-Codex', 'GPT-5', 'DeepSeek']} /><InputLabel label={t('插件')} value="Read, Write, Grep" /><InputLabel label={t('超时')} value={t('20 分钟')} /><SelectLabel label={t('失败处理')} options={[t('重试 2 次'), t('立即停止'), t('跳过')]} /><label className="field-label">Prompt<textarea defaultValue={t('根据测试结果和 diff 修改代码，保留用户已有改动，不执行破坏性命令。')} /></label><div className="button-row"><button className="button secondary" onClick={() => { const id = Date.now(); setNodes([...nodes, { ...current, id, x: current.x + 25, y: current.y + 25 }]); notify(t('节点已复制'), 'info') }}><Copy size={14} />{t('复制节点')}</button><button className="button danger" onClick={() => { setNodes(nodes.filter((node) => node.id !== selected)); setSelected(nodes[0]?.id); notify(t('节点已删除'), 'info') }}><Trash2 size={14} />{t('删除节点')}</button></div></Panel>
      </div>
    </div>
  </div>
}

function WorkflowMiniMap() {
  const { t } = useI18n()
  const nodes = [['触发器', 'Git push'], ['任务', '运行测试'], ['判断', '测试通过?'], ['任务', '生成报告'], ['通知', '飞书 + 微信']]
  return <div className="workflow-mini-map"><svg viewBox="0 0 520 170"><path d="M90 85 H190 M250 85 H330 M390 85 H460 M220 110 V142 H330" /></svg>{nodes.map((node, index) => <span className={`mini-node mn-${index}`} key={node[1]}><small>{t(node[0])}</small><strong>{t(node[1])}</strong></span>)}</div>
}
