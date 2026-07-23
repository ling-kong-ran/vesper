import { useCallback, useEffect, useState } from 'react'
import { CircleDot, RefreshCw, Server, Trash2, Wrench } from 'lucide-react'
import { useI18n } from '../../app/use-i18n.js'
import { Badge, Metric, Panel, SectionTitle, Toggle } from '../../components/ui.jsx'
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
