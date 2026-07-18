import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Bot, CheckCircle2, ChevronDown, ExternalLink, FolderOpen, MessageSquare, Plus, RadioTower, RefreshCw, ShieldCheck, Trash2, Unplug, X, Zap } from 'lucide-react'
import { Badge, Panel, SectionTitle, Toggle } from '../../components/ui.jsx'
import { apiJson } from '../../lib/api.js'
import { relativeTime } from '../../lib/format.js'

const STATUS = {
  idle: ['未连接', 'gray'],
  connecting: ['连接中', 'amber'],
  connected: ['在线', 'green'],
  reconnecting: ['重连中', 'amber'],
  failed: ['连接失败', 'red'],
}

const ONBOARD_STATUS = {
  starting: '正在向飞书申请创建机器人…',
  waiting: '请使用飞书 App 扫描二维码并确认创建',
  authorizing: '已扫码，正在确认授权…',
  connecting: '机器人已创建，正在建立 WebSocket 长连接…',
  completed: '机器人已经连接',
  failed: '创建失败',
  cancelled: '已取消',
}

function expiresIn(value) {
  const seconds = Math.max(0, Math.ceil((new Date(value).getTime() - Date.now()) / 1000))
  return seconds >= 60 ? `${Math.ceil(seconds / 60)} 分钟后` : `${seconds} 秒后`
}

export function ChannelsPage({ notify, createSignal }) {
  const [data, setData] = useState({ providers: [], connection: null, scopes: [] })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [onboarding, setOnboarding] = useState(null)
  const [starting, setStarting] = useState(false)
  const [saving, setSaving] = useState(false)
  const [cwd, setCwd] = useState('')

  const load = useCallback(async () => {
    try {
      setError('')
      const result = await apiJson('/api/channels')
      setData(result)
      setCwd(result.connection?.defaultCwd || '')
    } catch (caught) { setError(caught.message) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])
  useEffect(() => {
    if (createSignal > 0) beginOnboarding()
    // beginOnboarding intentionally reads the latest connection state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [createSignal])
  useEffect(() => {
    if (!onboarding?.id || ['completed', 'failed', 'cancelled'].includes(onboarding.status)) return undefined
    const timer = window.setInterval(async () => {
      try {
        const next = await apiJson(`/api/channels/feishu/onboarding/${encodeURIComponent(onboarding.id)}`)
        setOnboarding(next)
        if (next.status === 'completed') {
          window.clearInterval(timer)
          notify('飞书机器人已创建并建立双向连接')
          await load()
          window.setTimeout(() => setOnboarding(null), 900)
        }
      } catch (caught) {
        setOnboarding((current) => ({ ...current, status: 'failed', error: caught.message }))
      }
    }, 1500)
    return () => window.clearInterval(timer)
  }, [onboarding?.id, onboarding?.status, load, notify])

  const beginOnboarding = async () => {
    if (data.connection && !window.confirm('重新扫码会创建新的飞书机器人，并替换当前连接。是否继续？')) return
    setStarting(true)
    setOnboarding({ status: 'starting' })
    try { setOnboarding(await apiJson('/api/channels/feishu/onboarding', { method: 'POST', body: '{}' })) }
    catch (caught) { setOnboarding({ status: 'failed', error: caught.message }) }
    finally { setStarting(false) }
  }

  const closeOnboarding = async () => {
    if (onboarding?.id && !['completed', 'failed', 'cancelled'].includes(onboarding.status)) {
      await apiJson(`/api/channels/feishu/onboarding/${encodeURIComponent(onboarding.id)}`, { method: 'DELETE' }).catch(() => {})
    }
    setOnboarding(null)
  }

  const update = async (patch, success) => {
    setSaving(true)
    try {
      const result = await apiJson('/api/channels/feishu', { method: 'PATCH', body: JSON.stringify(patch) })
      setData(result)
      setCwd(result.connection?.defaultCwd || '')
      notify(success)
    } catch (caught) { notify(caught.message) }
    finally { setSaving(false) }
  }

  const reconnect = async () => {
    setSaving(true)
    try { setData(await apiJson('/api/channels/feishu/reconnect', { method: 'POST', body: '{}' })); notify('飞书 WebSocket 已重新连接') }
    catch (caught) { notify(caught.message); load() }
    finally { setSaving(false) }
  }

  const remove = async () => {
    if (!window.confirm('解除飞书机器人连接？本地保存的应用凭据和飞书会话映射会被删除。')) return
    try { await apiJson('/api/channels/feishu', { method: 'DELETE' }); await load(); notify('飞书机器人已解除连接') }
    catch (caught) { notify(caught.message) }
  }

  const resetScope = async (scope) => {
    if (!window.confirm(`重置“${scope.title}”绑定的 Pi Coder 会话？下一条消息会创建新会话。`)) return
    try { await apiJson(`/api/channels/feishu/scopes/${encodeURIComponent(scope.chatId)}`, { method: 'DELETE' }); await load(); notify('飞书会话已重置') }
    catch (caught) { notify(caught.message) }
  }

  if (loading) return <Panel className="empty-state"><RefreshCw className="spin" size={23} /><h2>正在加载渠道</h2></Panel>
  const connection = data.connection
  const [statusLabel, statusTone] = STATUS[connection?.status || 'idle'] || STATUS.failed

  return <div className="channel-page">
    {error && <div className="config-error"><AlertTriangle size={13} />{error}</div>}
    <div className="channel-cards">
      <Panel className="provider-card"><div className="provider-title"><span className="provider-icon blue"><Bot /></span><div><h2>飞书应用机器人</h2><p>扫码创建 · WebSocket 双向通信</p></div><Badge tone={statusTone}>{statusLabel}</Badge></div><label className="field-label">连接方式<span className="channel-summary-field">WebSocket 长连接</span></label><label className="field-label">机器人应用<span className="channel-summary-field">{connection ? `${connection.name} · ${connection.appId}` : '尚未创建'}</span></label><button className="button primary wide channel-provider-connect" disabled={starting} onClick={beginOnboarding}>{starting ? <RefreshCw className="spin" size={14} /> : <Plus size={14} />}{connection ? '重新扫码绑定' : '扫码创建机器人'}</button></Panel>
      <Panel className="provider-card"><div className="provider-title"><span className="provider-icon green"><RadioTower /></span><div><h2>双向会话</h2><p>私聊直接使用，群聊 @机器人 后使用</p></div><Badge tone={connection?.status === 'connected' ? 'green' : 'gray'}>{connection?.status === 'connected' ? `${data.scopes.length} 个会话` : '等待连接'}</Badge></div><label className="field-label">消息能力<span className="channel-summary-field">文字、图片、文件 · Agent 回复与产物回传</span></label><label className="field-label">会话命令<span className="channel-summary-field">/new · /status · /stop</span></label><button className="button secondary wide channel-provider-connect" disabled={!connection || saving} onClick={reconnect}><RefreshCw className={saving ? 'spin' : ''} size={14} />重新连接</button></Panel>
    </div>

    <div className="two-one-grid">
      <Panel><div className="channel-section-head"><SectionTitle title="飞书会话" /><span>{data.scopes.length} 个已绑定</span></div>{data.scopes.length ? data.scopes.map((scope) => <div className="route-row" key={scope.chatId}><span className="route-icon"><MessageSquare size={14} /></span><div className="channel-route-copy"><strong>{scope.title}</strong><small>{scope.chatType === 'p2p' ? '私聊' : '群聊'} · {scope.lastMessage || '暂无消息'} · {relativeTime(scope.updatedAt)}</small><small>{scope.cwd}</small></div><div className="channel-route-controls"><Badge tone="green">双向</Badge><button className="icon-button danger" title="重置会话" onClick={() => resetScope(scope)}><Trash2 size={13} /></button></div></div>) : <div className="channel-route-empty"><MessageSquare size={20} /><strong>{connection ? '等待飞书消息' : '尚未连接飞书机器人'}</strong><span>{connection ? '在飞书中私聊机器人，或在群里 @机器人。' : '扫码后会自动创建机器人并建立长连接。'}</span></div>}</Panel>
      <Panel className="test-panel"><SectionTitle title="连接设置" />{connection ? <><div className={`channel-live-status ${connection.status}`}><span className="channel-status-dot" /><div><strong>{statusLabel}</strong><small>{connection.lastError || (connection.status === 'connected' ? `已连接 ${relativeTime(connection.connectedAt)}` : '正在等待 WebSocket 建连')}</small></div></div><div className="modal-toggle-row"><span><strong>启用飞书渠道</strong><small>关闭后断开长连接，但保留应用凭据</small></span><Toggle value={connection.enabled} disabled={saving} onChange={(enabled) => update({ enabled }, enabled ? '飞书渠道已启用' : '飞书渠道已暂停')} /></div><label className="field-label">访问范围<span className="select-wrap"><select value={connection.accessMode} disabled={saving} onChange={(event) => update({ accessMode: event.target.value }, '访问范围已更新')}><option value="owner" disabled={!connection.ownerConfigured}>仅扫码创建者</option><option value="tenant">当前租户所有成员</option></select><ChevronDown size={13} /></span></label><label className="field-label">新会话默认工作目录<span className="channel-setting-input"><FolderOpen size={13} /><input value={cwd} onChange={(event) => setCwd(event.target.value)} /><button className="button tiny" disabled={saving || cwd === connection.defaultCwd} onClick={() => update({ defaultCwd: cwd }, '默认工作目录已保存')}>保存</button></span></label><div className="permission-note"><ShieldCheck size={15} /><span><strong>本机安全边界</strong><small>默认仅允许扫码创建者使用。群聊必须 @机器人，所有 Agent 工具仍受插件权限与会话工作目录限制。</small></span></div><div className="button-row"><button className="button secondary" onClick={reconnect} disabled={saving}><RefreshCw size={14} />重连</button><button className="button danger" onClick={remove}><Unplug size={14} />解除连接</button></div></> : <><p>无需填写 App ID 或 Secret。使用飞书扫码确认后，SDK 会创建机器人应用、保存凭据并立即建立 WebSocket 长连接。</p><div className="test-summary"><CheckCircle2 size={14} />无需公网 IP、域名或回调地址</div><div className="test-summary"><CheckCircle2 size={14} />支持私聊、群聊 @、图片和文件</div><div className="test-summary"><CheckCircle2 size={14} />每个飞书聊天独立映射 Pi Coder 会话</div><button className="button primary wide" onClick={beginOnboarding}><Zap size={15} />扫码创建并连接</button></>}</Panel>
    </div>
    {onboarding && <OnboardingModal job={onboarding} onClose={closeOnboarding} onRetry={beginOnboarding} />}
  </div>
}

function OnboardingModal({ job, onClose, onRetry }) {
  const terminal = ['completed', 'failed', 'cancelled'].includes(job.status)
  return <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className="modal feishu-onboard-modal"><div className="card-head"><div><h2>扫码创建飞书机器人</h2><p>由飞书官方授权页完成应用创建和权限确认。</p></div><button className="icon-button" onClick={onClose}><X size={17} /></button></div><div className={`feishu-qr-stage ${job.status}`}>{job.qrDataUrl ? <img src={job.qrDataUrl} alt="飞书机器人创建二维码" /> : job.status === 'failed' ? <AlertTriangle size={42} /> : <RefreshCw className="spin" size={32} />}<strong>{ONBOARD_STATUS[job.status] || '正在处理…'}</strong>{job.error && <p>{job.error}</p>}{job.expireAt && !terminal && <small>二维码将在 {expiresIn(job.expireAt)}过期</small>}</div>{job.qrUrl && !terminal && <a className="button secondary wide feishu-open-link" href={job.qrUrl} target="_blank" rel="noreferrer"><ExternalLink size={14} />无法扫码？在浏览器打开授权页</a>}<div className="permission-note"><ShieldCheck size={15} /><span><strong>仅申请双向对话所需权限</strong><small>发送机器人消息、接收私聊消息、接收群聊 @ 消息，以及消息事件订阅。</small></span></div><div className="modal-actions"><button className="button secondary" onClick={onClose}>{terminal ? '关闭' : '取消'}</button>{job.status === 'failed' && <button className="button primary" onClick={onRetry}><RefreshCw size={14} />重新生成二维码</button>}</div></section></div>
}
