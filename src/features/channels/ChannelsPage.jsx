import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Bot, CheckCircle2, ChevronDown, ExternalLink, FolderOpen, MessageCircle, MessageSquare, Plus, RefreshCw, ShieldCheck, Trash2, Unplug, X, Zap } from 'lucide-react'
import { Badge, Panel, SectionTitle, Toggle } from '../../components/ui.jsx'
import { useI18n } from '../../app/use-i18n.js'
import { StarOrbit } from '../../components/StarOrbit.jsx'
import { apiJson } from '../../lib/api.js'
import { relativeTime } from '../../lib/format.js'
import { APP_AGENT_NAME, APP_NAME } from '../../app/brand.js'
import { usePagePrimaryAction } from '../../hooks/usePagePrimaryAction.js'

const PROVIDERS = {
  feishu: { name: '飞书', title: '飞书应用机器人', Icon: Bot, tone: 'blue', transport: 'WebSocket 长连接', capability: '私聊、群聊 @、图片和文件' },
  weixin: { name: '微信', title: '微信', Icon: MessageCircle, tone: 'green', transport: 'Tencent iLink 持续连接', capability: '个人微信私聊、图片和文件' },
}
const STATUS = { idle: ['未连接', 'gray'], connecting: ['连接中', 'amber'], connected: ['在线', 'green'], reconnecting: ['重连中', 'amber'], failed: ['连接失败', 'red'] }
const ONBOARD_STATUS = {
  starting: '正在申请登录二维码…', waiting: '请使用手机扫码并确认连接', scanned: '已扫码，正在等待确认…', verification_required: '请输入手机上显示的数字配对码', authorizing: '正在确认授权…', connecting: '授权成功，正在建立持续连接…', completed: '渠道已经连接', failed: '连接失败', cancelled: '已取消',
}

function expiresIn(value, locale = 'zh-CN') {
  const seconds = Math.max(0, Math.ceil((new Date(value).getTime() - Date.now()) / 1000))
  if (locale === 'en-US') return seconds >= 60 ? `in ${Math.ceil(seconds / 60)} min` : `in ${seconds} sec`
  return seconds >= 60 ? `${Math.ceil(seconds / 60)} 分钟后` : `${seconds} 秒后`
}

export function ChannelsPage({ notify, registerPrimaryAction, requestConfirm }) {
  const { t, language } = useI18n()
  const [data, setData] = useState({ providers: [], connections: {}, scopes: [], models: [] })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selectedPlatform, setSelectedPlatform] = useState('feishu')
  const [onboarding, setOnboarding] = useState(null)
  const [starting, setStarting] = useState('')
  const [saving, setSaving] = useState(false)
  const [cwd, setCwd] = useState('')

  const load = useCallback(async () => {
    try {
      setError('')
      const result = await apiJson('/api/channels')
      setData(result)
      setCwd(result.connections?.[selectedPlatform]?.defaultCwd || '')
    } catch (caught) { setError(caught.message) }
    finally { setLoading(false) }
  }, [selectedPlatform])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    if (!onboarding?.id || ['completed', 'failed', 'cancelled'].includes(onboarding.status)) return undefined
    const timer = window.setInterval(async () => {
      try {
        const platform = onboarding.platform
        const next = await apiJson(`/api/channels/${platform}/onboarding/${encodeURIComponent(onboarding.id)}`)
        setOnboarding({ ...next, platform })
        if (next.status === 'completed') {
          window.clearInterval(timer)
          notify(t('{name}已建立双向连接', { name: t(PROVIDERS[platform].name) }))
          await load()
          window.setTimeout(() => setOnboarding(null), 900)
        }
      } catch (caught) { setOnboarding((current) => ({ ...current, status: 'failed', error: caught.message })) }
    }, 1500)
    return () => window.clearInterval(timer)
  }, [onboarding?.id, onboarding?.platform, onboarding?.status, load, notify, t])

  const beginOnboarding = async (platform) => {
    const connection = data.connections?.[platform]
    if (connection) {
      const approved = await requestConfirm({ title: t('重新连接{name}', { name: t(PROVIDERS[platform].name) }), message: t('重新扫码会替换当前{name}连接，是否继续？', { name: t(PROVIDERS[platform].name) }), confirmLabel: t('继续扫码'), tone: 'primary' })
      if (!approved) return
    }
    setSelectedPlatform(platform)
    setStarting(platform)
    setOnboarding({ platform, status: 'starting' })
    try {
      const job = await apiJson(`/api/channels/${platform}/onboarding`, { method: 'POST', body: '{}' })
      setOnboarding({ ...job, platform })
    } catch (caught) { setOnboarding({ platform, status: 'failed', error: caught.message }) }
    finally { setStarting('') }
  }

  usePagePrimaryAction(registerPrimaryAction, () => beginOnboarding(selectedPlatform))

  const closeOnboarding = async () => {
    if (onboarding?.id && !['completed', 'failed', 'cancelled'].includes(onboarding.status)) await apiJson(`/api/channels/${onboarding.platform}/onboarding/${encodeURIComponent(onboarding.id)}`, { method: 'DELETE' }).catch(() => {})
    setOnboarding(null)
  }

  const update = async (platform, patch, success) => {
    setSaving(true)
    try {
      const result = await apiJson(`/api/channels/${platform}`, { method: 'PATCH', body: JSON.stringify(patch) })
      setData(result)
      setCwd(result.connections?.[platform]?.defaultCwd || '')
      notify(success)
    } catch (caught) { notify(caught.message, 'error') }
    finally { setSaving(false) }
  }

  const reconnect = async (platform) => {
    setSaving(true)
    try { setData(await apiJson(`/api/channels/${platform}/reconnect`, { method: 'POST', body: '{}' })); notify(t('{name}已重新连接', { name: t(PROVIDERS[platform].name) })) }
    catch (caught) { notify(caught.message, 'error'); load() }
    finally { setSaving(false) }
  }

  const remove = async (platform) => {
    const approved = await requestConfirm({ title: t('解除{name}连接', { name: t(PROVIDERS[platform].name) }), message: t('本地凭据和会话映射会被删除。'), confirmLabel: t('解除连接') })
    if (!approved) return
    try { await apiJson(`/api/channels/${platform}`, { method: 'DELETE' }); await load(); notify(t('{name}已解除连接', { name: t(PROVIDERS[platform].name) })) }
    catch (caught) { notify(caught.message, 'error') }
  }

  const resetScope = async (scope) => {
    const approved = await requestConfirm({ title: t('重置渠道会话'), message: t('重置“{scope}”绑定的 {app} 会话？', { scope: scope.title, app: APP_NAME }), confirmLabel: t('重置') })
    if (!approved) return
    try { await apiJson(`/api/channels/scopes/${encodeURIComponent(scope.key)}`, { method: 'DELETE' }); await load(); notify(t('渠道会话已重置')) }
    catch (caught) { notify(caught.message, 'error') }
  }

  if (loading) return <Panel className="empty-state"><RefreshCw className="spin" size={23} /><h2>{t('正在加载渠道')}</h2></Panel>
  const selectedConnection = data.connections?.[selectedPlatform]
  const [statusLabel] = STATUS[selectedConnection?.status || 'idle'] || STATUS.failed

  return <div className="channel-page">
    {error && <div className="config-error"><AlertTriangle size={13} />{error}</div>}
    <div className="channel-cards">{Object.entries(PROVIDERS).map(([platform, provider]) => {
      const connection = data.connections?.[platform]
      const [label, tone] = STATUS[connection?.status || 'idle'] || STATUS.failed
      const Icon = provider.Icon
      return <Panel className={`provider-card channel-platform-card ${selectedPlatform === platform ? 'selected' : ''}`} key={platform} onClick={() => { setSelectedPlatform(platform); setCwd(connection?.defaultCwd || '') }}><div className="provider-title"><span className={`provider-icon ${provider.tone}`}><Icon /></span><div><h2>{t(provider.title)}</h2><p>{t(provider.transport)}</p></div><Badge tone={tone}>{t(label)}</Badge></div><label className="field-label">{t('双向能力')}<span className="channel-summary-field">{t(provider.capability)}</span></label><label className="field-label">{t('回复模型')}<span className="channel-summary-field">{connection?.replyModel ? `${connection.replyModel.provider}/${connection.replyModel.model}` : t('跟随应用默认模型')}</span></label><button className={`button wide channel-provider-connect ${connection ? 'secondary' : 'primary'}`} disabled={starting === platform} onClick={(event) => { event.stopPropagation(); beginOnboarding(platform) }}>{starting === platform ? <RefreshCw className="spin" size={14} /> : <Plus size={14} />}{t(connection ? '重新扫码绑定' : '扫码连接{name}', { name: t(provider.name) })}</button></Panel>
    })}</div>

    <div className="two-one-grid">
      <Panel><div className="channel-section-head"><SectionTitle title={t('渠道会话')} /><span>{t('{count} 个已绑定', { count: data.scopes.length })}</span></div>{data.scopes.length ? data.scopes.map((scope) => <div className="route-row" key={scope.key}><span className="route-icon">{scope.platform === 'feishu' ? <MessageSquare size={14} /> : <MessageCircle size={14} />}</span><div className="channel-route-copy"><strong>{scope.title} <Badge tone={scope.platform === 'feishu' ? 'blue' : 'green'}>{t(PROVIDERS[scope.platform].name)}</Badge></strong><small>{scope.lastMessage || t('暂无消息')} · {relativeTime(scope.updatedAt, language)}</small><small>{scope.model || t('默认模型')} · {scope.cwd}</small></div><div className="channel-route-controls"><Badge tone="green">{t('双向')}</Badge><button className="icon-button danger" title={t('重置会话')} onClick={() => resetScope(scope)}><Trash2 size={13} /></button></div></div>) : <div className="channel-route-empty"><StarOrbit size={38} /><strong>{t('等待远方的第一声回应')}</strong><span>{t('连接完成后，来自飞书或微信的消息会在这里抵达 Vesper。')}</span></div>}</Panel>
      <Panel className="test-panel"><div className="channel-section-head"><SectionTitle title={t('{name}设置', { name: t(PROVIDERS[selectedPlatform].name) })} /><span>{t(PROVIDERS[selectedPlatform].transport)}</span></div>{selectedConnection ? <><div className={`channel-live-status ${selectedConnection.status}`}><span className="channel-status-dot" /><div><strong>{t(statusLabel)}</strong><small>{selectedConnection.lastError || (selectedConnection.status === 'connected' ? t('已连接 {time}', { time: relativeTime(selectedConnection.connectedAt, language) }) : t('正在建立持续连接'))}</small></div></div><div className="modal-toggle-row"><span><strong>{t('启用此渠道')}</strong><small>{t('关闭后断开连接，但保留登录凭据')}</small></span><Toggle value={selectedConnection.enabled} disabled={saving} onChange={(enabled) => update(selectedPlatform, { enabled }, t(enabled ? '渠道已启用' : '渠道已暂停'))} /></div><label className="field-label">{t('回复模型')}<span className="select-wrap"><select value={selectedConnection.replyModel ? `${selectedConnection.replyModel.provider}/${selectedConnection.replyModel.model}` : ''} onChange={(event) => { const [provider, ...parts] = event.target.value.split('/'); update(selectedPlatform, { replyModel: event.target.value ? { provider, model: parts.join('/') } : null }, t('渠道回复模型已更新')) }}><option value="">{t('跟随应用默认模型')}</option>{data.models.map((model) => <option value={`${model.provider}/${model.model}`} key={`${model.provider}/${model.model}`}>{model.label}</option>)}</select><ChevronDown size={13} /></span></label><label className="field-label">{t('访问范围')}<span className="select-wrap"><select value={selectedConnection.accessMode} onChange={(event) => update(selectedPlatform, { accessMode: event.target.value }, t('访问范围已更新'))}><option value="owner" disabled={!selectedConnection.ownerConfigured}>{t('仅扫码创建者')}</option><option value="all">{t(selectedPlatform === 'feishu' ? '当前租户所有成员' : '所有给机器人发消息的微信用户')}</option></select><ChevronDown size={13} /></span></label><label className="field-label">{t('新会话默认工作目录')}<span className="channel-setting-input"><FolderOpen size={13} /><input value={cwd} onChange={(event) => setCwd(event.target.value)} /><button className="button tiny" disabled={saving || cwd === selectedConnection.defaultCwd} onClick={() => update(selectedPlatform, { defaultCwd: cwd }, t('默认工作目录已保存'))}>{t('保存')}</button></span></label><div className="permission-note"><ShieldCheck size={15} /><span><strong>{t('本机安全边界')}</strong><small>{t('默认仅允许扫码创建者使用；Agent 工具仍受插件权限和会话工作目录限制。')}</small></span></div><div className="button-row"><button className="button secondary" onClick={() => reconnect(selectedPlatform)} disabled={saving}><RefreshCw size={14} />{t('重连')}</button><button className="button danger" onClick={() => remove(selectedPlatform)}><Unplug size={14} />{t('解除连接')}</button></div></> : <><p>{t('扫码确认后会自动保存凭据并保持在线，收到消息后直接交给指定模型和 {agent}。', { agent: APP_AGENT_NAME })}</p><div className="test-summary"><CheckCircle2 size={14} />{t('真正双向收发，不使用通知 Webhook')}</div><div className="test-summary"><CheckCircle2 size={14} />{t('每个联系人或聊天独立映射 Agent 会话')}</div><button className="button primary wide" onClick={() => beginOnboarding(selectedPlatform)}><Zap size={15} />{t('扫码连接{name}', { name: t(PROVIDERS[selectedPlatform].name) })}</button></>}</Panel>
    </div>

    {onboarding && <OnboardingModal job={onboarding} onClose={closeOnboarding} onRetry={() => beginOnboarding(onboarding.platform)} notify={notify} />}
  </div>
}

function OnboardingModal({ job, onClose, onRetry, notify }) {
  const { t, language } = useI18n()
  const [code, setCode] = useState('')
  const terminal = ['completed', 'failed', 'cancelled'].includes(job.status)
  const provider = PROVIDERS[job.platform]
  const submitCode = async () => {
    try { await apiJson(`/api/channels/${job.platform}/onboarding/${encodeURIComponent(job.id)}/verify`, { method: 'POST', body: JSON.stringify({ code }) }); notify(t('配对码已提交')) }
    catch (caught) { notify(caught.message, 'error') }
  }
  return <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className="modal feishu-onboard-modal"><div className="card-head"><div><h2>{t('扫码连接{name}', { name: t(provider.name) })}</h2><p>{t(job.platform === 'feishu' ? '由飞书官方授权页创建机器人应用。' : '由腾讯 iLink Bot 完成个人微信登录。')}</p></div><button className="icon-button" aria-label={t('关闭对话框')} onClick={onClose}><X size={17} /></button></div><div className={`feishu-qr-stage ${job.status}`}>{job.qrDataUrl ? <img src={job.qrDataUrl} alt={t('{name}连接二维码', { name: t(provider.name) })} /> : job.status === 'failed' ? <AlertTriangle size={42} /> : <RefreshCw className="spin" size={32} />}<strong>{t(ONBOARD_STATUS[job.status] || '正在处理…')}</strong>{job.error && <p>{job.error}</p>}{job.expireAt && !terminal && <small>{t('二维码将在 {time}过期', { time: expiresIn(job.expireAt, language) })}</small>}</div>{job.needsVerifyCode && <div className="weixin-verify-code"><input value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, '').slice(0, 8))} placeholder={t('输入手机显示的数字')} /><button className="button primary" disabled={!code} onClick={submitCode}>{t('提交配对码')}</button></div>}{job.qrUrl && !terminal && <a className="button secondary wide feishu-open-link" href={job.qrUrl} target="_blank" rel="noreferrer"><ExternalLink size={14} />{t('无法扫码？打开登录链接')}</a>}<div className="permission-note"><ShieldCheck size={15} /><span><strong>{t('持续在线的双向连接')}</strong><small>{t(job.platform === 'feishu' ? 'WebSocket 接收私聊和群聊 @ 消息。' : '腾讯 iLink 持续拉取私聊消息，并支持文字与媒体回复。')}</small></span></div><div className="modal-actions"><button className="button secondary" onClick={onClose}>{t(terminal ? '关闭' : '取消')}</button>{job.status === 'failed' && <button className="button primary" onClick={onRetry}><RefreshCw size={14} />{t('重新生成二维码')}</button>}</div></section></div>
}
