import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Bell, BellOff, RefreshCw, Save, Send, ShieldCheck } from 'lucide-react'
import { Badge, Panel, SectionTitle, Toggle } from '../../components/ui.jsx'
import { apiJson } from '../../lib/api.js'

const CHANNELS = {
  feishu: { name: '飞书', tone: 'blue' },
  weixin: { name: '微信', tone: 'green' },
}

function renderPreview(content) {
  const values = { 'task.name': '每日代码巡检', 'task.summary': '发现 2 个待处理问题，报告已归档。', 'task.duration': '2 分 18 秒', 'task.nextRun': '明天 09:00', 'task.error': '测试进程超时', 'workflow.name': '发布前检查', 'workflow.summary': '测试、构建和安全检查均已通过。', 'workflow.duration': '6 分 42 秒', 'workflow.runId': 'run_20260718_001', 'workflow.node': '端到端测试', 'workflow.error': '浏览器启动失败' }
  return String(content || '').replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_match, key) => values[key] || `{{${key}}}`)
}

function browserPermission() {
  return typeof window !== 'undefined' && 'Notification' in window ? window.Notification.permission : 'unsupported'
}

export function NotificationSettings({ notify, onBrowserNotificationChange }) {
  const [data, setData] = useState({ browser: { enabled: false }, connections: {}, scopes: [], templates: [] })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [permission, setPermission] = useState(browserPermission)
  const [browserSaving, setBrowserSaving] = useState(false)

  const load = useCallback(async () => {
    try {
      setError('')
      const result = await apiJson('/api/settings/notifications')
      setData(result)
      onBrowserNotificationChange?.(result.browser.enabled)
    } catch (caught) { setError(caught.message) }
    finally { setLoading(false) }
  }, [onBrowserNotificationChange])

  useEffect(() => { load() }, [load])

  const updateBrowser = async (enabled) => {
    if (enabled) {
      if (permission === 'unsupported') { notify('当前浏览器不支持系统通知'); return }
      let nextPermission = window.Notification.permission
      if (nextPermission === 'default') nextPermission = await window.Notification.requestPermission()
      setPermission(nextPermission)
      if (nextPermission !== 'granted') { notify('浏览器通知权限未授权，请在站点设置中允许通知'); return }
    }
    setBrowserSaving(true)
    try {
      const result = await apiJson('/api/settings/notifications/browser', { method: 'PATCH', body: JSON.stringify({ enabled }) })
      setData(result)
      onBrowserNotificationChange?.(result.browser.enabled)
      notify(enabled ? '浏览器通知已启用' : '浏览器通知已关闭')
    } catch (caught) { notify(caught.message) }
    finally { setBrowserSaving(false) }
  }

  const testBrowserNotification = () => {
    if (permission !== 'granted') return
    const item = new window.Notification('Pi Coder 通知测试', { body: '浏览器通知工作正常。', tag: 'pi-coder-browser-test' })
    item.onclick = () => { window.focus(); item.close() }
  }

  if (loading) return <Panel className="empty-state"><RefreshCw className="spin" size={23} /><h2>正在加载通知设置</h2></Panel>
  const permissionLabel = permission === 'granted' ? '权限已允许' : permission === 'denied' ? '权限被拒绝' : permission === 'unsupported' ? '浏览器不支持' : '等待授权'
  const permissionTone = permission === 'granted' ? 'green' : permission === 'default' ? 'amber' : 'red'

  return <div className="notification-settings">
    {error && <div className="config-error"><AlertTriangle size={13} />{error}</div>}
    <Panel className="browser-notification-card"><div className="notification-option"><span className={`provider-icon ${data.browser.enabled ? 'blue' : ''}`}>{data.browser.enabled ? <Bell size={18} /> : <BellOff size={18} />}</span><div><strong>浏览器通知</strong><small>页面在后台或窗口失去焦点时，Agent 完成或失败会发送系统通知。</small></div><Badge tone={permissionTone}>{permissionLabel}</Badge><Toggle value={data.browser.enabled} disabled={browserSaving || permission === 'unsupported'} onChange={updateBrowser} /></div><div className="permission-note"><ShieldCheck size={15} /><span><strong>由浏览器权限控制</strong><small>配置保存在用户目录；关闭开关不会修改浏览器自身的站点权限。</small></span></div><div className="button-row"><button className="button secondary" disabled={!data.browser.enabled || permission !== 'granted'} onClick={testBrowserNotification}><Bell size={14} />发送测试通知</button></div></Panel>
    <NotificationTemplates data={data} setData={setData} notify={notify} />
  </div>
}

function NotificationTemplates({ data, setData, notify }) {
  const [eventId, setEventId] = useState(data.templates[0]?.id || '')
  const [platform, setPlatform] = useState('feishu')
  const selected = data.templates.find((item) => item.id === eventId) || data.templates[0]
  const variant = selected?.channels?.[platform]
  const [content, setContent] = useState(variant?.content || '')
  const [saving, setSaving] = useState(false)
  const latestScope = data.scopes.find((scope) => scope.platform === platform)

  useEffect(() => { setContent(variant?.content || '') }, [eventId, platform, variant?.content])
  if (!selected) return null

  const save = async () => {
    setSaving(true)
    try {
      const result = await apiJson(`/api/settings/notifications/templates/${encodeURIComponent(selected.id)}/${platform}`, { method: 'PUT', body: JSON.stringify({ enabled: selected.enabled, content }) })
      setData(result)
      notify('通知模板已保存')
    } catch (caught) { notify(caught.message) }
    finally { setSaving(false) }
  }

  const test = async () => {
    setSaving(true)
    try {
      const result = await apiJson(`/api/settings/notifications/templates/${encodeURIComponent(selected.id)}/${platform}/test`, { method: 'POST', body: '{}' })
      notify(`测试通知已发送到 ${result.sent} 个会话`)
    } catch (caught) { notify(caught.message) }
    finally { setSaving(false) }
  }

  return <div className="two-one-grid channel-template-layout"><Panel><div className="channel-section-head"><SectionTitle title="通知模板" /><span>定时任务、工作流等事件共用</span></div>{data.templates.map((template) => <button className={`channel-template-row ${template.id === selected.id ? 'selected' : ''}`} onClick={() => setEventId(template.id)} key={template.id}><span className="route-icon"><Send size={14} /></span><span><strong>{template.name}</strong><small>{template.description}</small></span><Badge tone={template.enabled ? 'green' : 'gray'}>{template.enabled ? '启用' : '停用'}</Badge></button>)}</Panel><Panel className="channel-template-editor"><div className="card-head"><div><h2>{selected.name}</h2><p>{selected.description}</p></div><Toggle value={selected.enabled} onChange={(enabled) => setData((current) => ({ ...current, templates: current.templates.map((item) => item.id === selected.id ? { ...item, enabled } : item) }))} /></div><div className="channel-template-platforms">{Object.entries(CHANNELS).map(([id, channel]) => <button className={platform === id ? 'active' : ''} onClick={() => setPlatform(id)} key={id}>{channel.name}<Badge tone={data.connections?.[id] ? channel.tone : 'gray'}>{data.connections?.[id] ? '已连接' : '未连接'}</Badge></button>)}</div><label className="field-label">消息内容<textarea value={content} onChange={(event) => setContent(event.target.value)} /></label><div className="channel-template-vars"><span>可用变量</span>{selected.variables.map((variable) => <code key={variable}>{`{{${variable}}}`}</code>)}</div><div className="channel-template-preview"><small>预览</small><pre>{renderPreview(content)}</pre></div><div className="modal-actions"><button className="button secondary" disabled={saving || !latestScope} onClick={test}><Send size={14} />测试发送</button><button className="button primary" disabled={saving || !content.trim()} onClick={save}>{saving ? <RefreshCw className="spin" size={14} /> : <Save size={14} />}保存模板</button></div></Panel></div>
}
