import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Bell, BellOff, RefreshCw, Save, Send, ShieldCheck } from 'lucide-react'
import { Badge, Panel, SectionTitle, Toggle } from '../../components/ui.jsx'
import { APP_NAME } from '../../app/brand.js'
import { useI18n } from '../../app/use-i18n.js'
import { apiJson } from '../../lib/api.js'
import {
  getBrowserNotificationPermission,
  prepareBrowserNotifications,
  requestBrowserNotificationPermission,
  showBrowserSystemNotification,
} from '../../lib/browser-notifications.js'

const CHANNELS = {
  feishu: { name: '飞书', tone: 'blue' },
  weixin: { name: '微信', tone: 'green' },
  browser: { name: '通知', tone: 'violet' },
}

function renderPreview(content, t) {
  const values = { 'chat.title': t('修复渠道通知'), 'chat.summary': t('实现已完成，测试和构建均已通过。'), 'chat.model': 'openai/gpt-5.4', 'task.name': t('每日代码巡检'), 'task.summary': t('发现 2 个待处理问题，报告已归档。'), 'task.duration': t('2 分 18 秒'), 'task.nextRun': t('明天 09:00'), 'task.error': t('测试进程超时'), 'workflow.name': t('发布前检查'), 'workflow.summary': t('测试、构建和安全检查均已通过。'), 'workflow.duration': t('6 分 42 秒'), 'workflow.runId': 'run_20260718_001', 'workflow.node': t('端到端测试'), 'workflow.error': t('浏览器启动失败') }
  return String(content || '').replace(/\{\{\s*([\w.]+)\s*\}\}/g, (_match, key) => values[key] || `{{${key}}}`)
}

function notificationPermission() {
  if (typeof window !== 'undefined' && window.vesperDesktop?.showNotification) {
    return window.vesperDesktop.getNotificationStatus ? 'checking' : 'granted'
  }
  return getBrowserNotificationPermission()
}

function notificationFailureMessage(reason, t) {
  if (reason === 'system-disabled' || reason === 'app-disabled') return t('系统通知已关闭，请在操作系统设置中允许 Vesper 发送通知。')
  if (reason === 'unsupported') return t('当前环境不支持系统通知')
  return t('系统没有接受通知请求，请检查操作系统通知设置。')
}

export function NotificationSettings({ notify, onBrowserNotificationChange }) {
  const { t } = useI18n()
  const [data, setData] = useState({ browser: { enabled: false }, connections: {}, scopes: [], templates: [] })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const desktop = Boolean(window.vesperDesktop?.showNotification)
  const [permission, setPermission] = useState(notificationPermission)
  const [browserSaving, setBrowserSaving] = useState(false)

  const refreshDesktopPermission = useCallback(async () => {
    if (!desktop) return
    if (!window.vesperDesktop.getNotificationStatus) { setPermission('granted'); return }
    try {
      const result = await window.vesperDesktop.getNotificationStatus()
      setPermission(result?.permission || (result?.supported === false ? 'unsupported' : 'granted'))
    } catch {
      setPermission('unsupported')
    }
  }, [desktop])

  const load = useCallback(async () => {
    try {
      setError('')
      const result = await apiJson('/api/settings/notifications')
      setData(result)
      onBrowserNotificationChange?.(result)
    } catch (caught) { setError(caught.message) }
    finally { setLoading(false) }
  }, [onBrowserNotificationChange])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    if (!desktop) return undefined
    void refreshDesktopPermission()
    const refresh = () => { void refreshDesktopPermission() }
    window.addEventListener('focus', refresh)
    return () => window.removeEventListener('focus', refresh)
  }, [desktop, refreshDesktopPermission])

  const updateBrowser = async (enabled) => {
    if (enabled) {
      if (permission === 'unsupported') { notify(t('当前环境不支持系统通知'), 'error'); return }
      if (desktop && permission !== 'granted') { notify(notificationFailureMessage('system-disabled', t), 'error'); return }
      if (!desktop) {
        const nextPermission = await requestBrowserNotificationPermission()
        setPermission(nextPermission)
        if (nextPermission !== 'granted') { notify(t('通知权限未授权，请在浏览器站点设置中允许通知'), 'error'); return }
        try { await prepareBrowserNotifications() }
        catch (caught) { notify(caught.message || t('浏览器后台通知服务注册失败'), 'error'); return }
      }
    }
    setBrowserSaving(true)
    try {
      const result = await apiJson('/api/settings/notifications/browser', { method: 'PATCH', body: JSON.stringify({ enabled }) })
      setData(result)
      onBrowserNotificationChange?.(result)
      notify(t(enabled ? '通知已启用' : '通知已关闭'))
    } catch (caught) { notify(caught.message, 'error') }
    finally { setBrowserSaving(false) }
  }

  const sendSystemNotification = useCallback(async (title, body, tag = 'vesper-browser-test') => {
    if (desktop) {
      const result = await window.vesperDesktop.showNotification({ title, body })
      if (result && typeof result === 'object' && result.shown === false) {
        setPermission(result.permission || 'denied')
        throw new Error(notificationFailureMessage(result.reason, t))
      }
      return result
    }
    return showBrowserSystemNotification({ title, body, tag, url: window.location.href })
  }, [desktop, t])

  const testNotification = async () => {
    if (permission !== 'granted') {
      notify(permission === 'unsupported'
        ? notificationFailureMessage('unsupported', t)
        : desktop
          ? notificationFailureMessage('system-disabled', t)
          : t('通知权限未授权，请在浏览器站点设置中允许通知'), 'error')
      return
    }
    try {
      await sendSystemNotification(t('{app} 通知测试', { app: APP_NAME }), t('通知工作正常。'))
      notify(t('测试通知已发送，请检查系统通知中心。'), 'info')
    } catch (caught) {
      notify(caught.message || t('系统没有接受通知请求，请检查操作系统通知设置。'), 'error')
    }
  }

  const openDesktopNotificationSettings = async () => {
    try {
      const opened = await window.vesperDesktop?.openNotificationSettings?.()
      if (!opened) notify(t('请在操作系统设置中打开通知权限。'), 'info')
    } catch {
      notify(t('请在操作系统设置中打开通知权限。'), 'info')
    }
  }

  if (loading) return <Panel className="empty-state"><RefreshCw className="spin" size={23} /><h2>{t('正在加载通知设置')}</h2></Panel>
  const permissionLabel = t(permission === 'granted' ? '权限已允许' : permission === 'denied' ? desktop ? '系统通知已关闭' : '浏览器通知已关闭' : permission === 'unsupported' ? '当前环境不支持' : permission === 'checking' ? '正在检查' : '等待授权')
  const permissionTone = permission === 'granted' ? 'green' : permission === 'default' || permission === 'checking' ? 'amber' : 'red'

  return <div className="notification-settings">
    {error && <div className="config-error"><AlertTriangle size={13} />{error}</div>}
    <Panel className="browser-notification-card"><div className="notification-option"><span className={`provider-icon ${data.browser.enabled ? 'blue' : ''}`}>{data.browser.enabled ? <Bell size={18} /> : <BellOff size={18} />}</span><div><strong>{t('通知')}</strong><small>{t('Agent 完成或失败时，Vesper 会通过当前平台的系统通知提醒你。')}</small></div><Badge tone={permissionTone}>{permissionLabel}</Badge><Toggle value={data.browser.enabled} disabled={browserSaving || permission === 'unsupported' || permission === 'checking'} onChange={updateBrowser} /></div><div className="permission-note"><ShieldCheck size={15} /><span><strong>{t(desktop ? '由操作系统通知设置控制' : '由浏览器站点权限控制')}</strong><small>{t(desktop ? '桌面端使用操作系统通知；关闭开关不会修改系统自身的通知权限。' : 'Web 端使用浏览器站点通知；关闭开关不会修改浏览器自身的站点权限。')}</small></span></div><div className="button-row">{desktop && permission === 'denied' && <button className="button secondary" onClick={openDesktopNotificationSettings}><ShieldCheck size={14} />{t('打开系统通知设置')}</button>}<button className="button secondary" disabled={!data.browser.enabled || permission !== 'granted'} onClick={testNotification}><Bell size={14} />{t('发送测试通知')}</button></div></Panel>
    <NotificationTemplates data={data} setData={setData} notify={notify} permission={permission} onBrowserTest={sendSystemNotification} onSettingsChange={onBrowserNotificationChange} />
  </div>
}

function NotificationTemplates({ data, setData, notify, permission, onBrowserTest, onSettingsChange }) {
  const { t } = useI18n()
  const [eventId, setEventId] = useState(data.templates[0]?.id || '')
  const [platform, setPlatform] = useState('feishu')
  const selected = data.templates.find((item) => item.id === eventId) || data.templates[0]
  const variant = selected?.channels?.[platform]
  const [content, setContent] = useState(variant?.content || '')
  const [saving, setSaving] = useState(false)
  const latestScope = data.scopes.find((scope) => scope.platform === platform)
  const canTest = platform === 'browser' ? data.browser.enabled && permission === 'granted' : Boolean(latestScope)
  const visibleChannels = selected?.id === 'chat.completed' ? { browser: CHANNELS.browser } : CHANNELS

  useEffect(() => { setContent(variant?.content || '') }, [eventId, platform, variant?.content])
  useEffect(() => { if (selected?.id === 'chat.completed' && platform !== 'browser') setPlatform('browser') }, [platform, selected?.id])
  if (!selected) return null

  const save = async () => {
    setSaving(true)
    try {
      const result = await apiJson(`/api/settings/notifications/templates/${encodeURIComponent(selected.id)}/${platform}`, { method: 'PUT', body: JSON.stringify({ enabled: selected.enabled, content }) })
      setData(result)
      onSettingsChange?.(result)
      notify(t('通知模板已保存'))
    } catch (caught) { notify(caught.message, 'error') }
    finally { setSaving(false) }
  }

  const test = async () => {
    setSaving(true)
    try {
      const result = await apiJson(`/api/settings/notifications/templates/${encodeURIComponent(selected.id)}/${platform}/test`, { method: 'POST', body: '{}' })
      if (platform === 'browser') await onBrowserTest?.(result.title || t(selected.name), result.body || result.preview || '', `vesper-template-${selected.id}`)
      notify(t(platform === 'browser' ? '测试通知已发送，请检查系统通知中心。' : '测试通知已发送到 {count} 个会话', { count: result.sent }))
    } catch (caught) { notify(caught.message, 'error') }
    finally { setSaving(false) }
  }

  return <div className="two-one-grid channel-template-layout"><Panel><div className="channel-section-head"><SectionTitle title={t('通知模板')} /><span>{t('对话、定时任务和工作流共用')}</span></div>{data.templates.map((template) => <button className={`channel-template-row ${template.id === selected.id ? 'selected' : ''}`} onClick={() => setEventId(template.id)} key={template.id}><span className="route-icon"><Send size={14} /></span><span><strong>{t(template.name)}</strong><small>{t(template.description)}</small></span><Badge tone={template.enabled ? 'green' : 'gray'}>{t(template.enabled ? '启用' : '停用')}</Badge></button>)}</Panel><Panel className="channel-template-editor"><div className="card-head"><div><h2>{t(selected.name)}</h2><p>{t(selected.description)}</p></div><Toggle value={selected.enabled} onChange={(enabled) => setData((current) => ({ ...current, templates: current.templates.map((item) => item.id === selected.id ? { ...item, enabled } : item) }))} /></div><div className={`channel-template-platforms ${selected.id === 'chat.completed' ? 'single' : ''}`}>{Object.entries(visibleChannels).map(([id, channel]) => { const available = id === 'browser' ? data.browser.enabled : data.connections?.[id]; return <button className={platform === id ? 'active' : ''} onClick={() => setPlatform(id)} key={id}>{t(channel.name)}<Badge tone={available ? channel.tone : 'gray'}>{t(available ? id === 'browser' ? '已启用' : '已连接' : id === 'browser' ? '未启用' : '未连接')}</Badge></button> })}</div><label className="field-label">{t('消息内容')}<textarea value={content} onChange={(event) => setContent(event.target.value)} /></label><div className="channel-template-vars"><span>{t('可用变量')}</span>{selected.variables.map((variable) => <code key={variable}>{`{{${variable}}}`}</code>)}</div><div className="channel-template-preview"><small>{t('预览')}</small><pre>{renderPreview(content, t)}</pre></div><div className="modal-actions"><button className="button secondary" disabled={saving || !canTest} onClick={test}><Send size={14} />{t('测试发送')}</button><button className="button primary" disabled={saving || !content.trim()} onClick={save}>{saving ? <RefreshCw className="spin" size={14} /> : <Save size={14} />}{t('保存模板')}</button></div></Panel></div>
}
