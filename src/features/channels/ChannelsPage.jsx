import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, CheckCircle2, ChevronDown, ExternalLink, GitBranch, Link2, MessageSquare, Pencil, Plus, RefreshCw, Send, ShieldCheck, Trash2, X, Zap } from 'lucide-react'
import { Badge, Panel, SectionTitle, Toggle } from '../../components/ui.jsx'
import { apiJson } from '../../lib/api.js'
import { relativeTime } from '../../lib/format.js'

const PROVIDERS = {
  feishu: {
    name: '飞书', subtitle: '自定义群机器人', Icon: Send, tone: 'blue',
    placeholder: 'https://open.feishu.cn/open-apis/bot/v2/hook/...',
    steps: ['在目标群打开「设置 → 群机器人」', '添加「自定义机器人」并完成安全设置', '复制 Webhook，粘贴到下方即可'],
  },
  wecom: {
    name: '企业微信', subtitle: '群消息推送', Icon: MessageSquare, tone: 'green',
    placeholder: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=...',
    steps: ['在目标群打开「群设置 → 消息推送」', '创建消息推送并复制 Webhook', '粘贴到下方，保存时自动验证'],
  },
}

const EVENT_OPTIONS = [
  ['agent.completed', '会话完成', 'Agent 完成一轮工作后通知'],
  ['agent.failed', '执行失败', '模型、工具或网络错误时通知'],
]

function initialDraft(type = 'feishu') {
  return { type, name: type === 'feishu' ? '飞书通知群' : '企业微信群通知', webhookUrl: '', signingSecret: '', clearSigningSecret: false, enabled: true, events: ['agent.completed', 'agent.failed'], testAfterSave: true }
}

function ChannelIcon({ type }) {
  const provider = PROVIDERS[type] || PROVIDERS.feishu
  const Icon = provider.Icon
  return <span className={`channel-provider-icon ${provider.tone}`}><Icon size={19} /></span>
}

export function ChannelsPage({ notify, createSignal }) {
  const [data, setData] = useState({ channels: [], capabilities: {} })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [modal, setModal] = useState(null)
  const [testing, setTesting] = useState('')
  const [toggling, setToggling] = useState('')
  const [selectedId, setSelectedId] = useState('')

  const load = async () => {
    try { setError(''); setData(await apiJson('/api/channels')) }
    catch (caught) { setError(caught.message) }
    finally { setLoading(false) }
  }

  useEffect(() => { load() }, [])
  useEffect(() => { if (createSignal > 0) setModal({ channel: null, type: 'feishu' }) }, [createSignal])
  useEffect(() => {
    if (!data.channels.some((channel) => channel.id === selectedId)) setSelectedId(data.channels[0]?.id || '')
  }, [data.channels, selectedId])
  const providerCounts = useMemo(() => Object.fromEntries(Object.keys(PROVIDERS).map((type) => [type, data.channels.filter((channel) => channel.type === type).length])), [data.channels])
  const selectedChannel = data.channels.find((channel) => channel.id === selectedId) || null

  const test = async (channel) => {
    setTesting(channel.id)
    try {
      await apiJson(`/api/channels/${encodeURIComponent(channel.id)}/test`, { method: 'POST', body: '{}' })
      notify(`测试消息已发送到 ${channel.name}`)
    } catch (caught) { notify(`发送失败：${caught.message}`) }
    finally { setTesting(''); load() }
  }

  const toggle = async (channel, enabled) => {
    setToggling(channel.id)
    try {
      await apiJson(`/api/channels/${encodeURIComponent(channel.id)}`, { method: 'PATCH', body: JSON.stringify({ enabled }) })
      setData((current) => ({ ...current, channels: current.channels.map((item) => item.id === channel.id ? { ...item, enabled } : item) }))
      notify(enabled ? '渠道已启用' : '渠道已暂停')
    } catch (caught) { notify(caught.message) }
    finally { setToggling('') }
  }

  const remove = async (channel) => {
    if (!window.confirm(`删除“${channel.name}”？保存的 Webhook 和通知规则也会一并删除。`)) return
    try {
      await apiJson(`/api/channels/${encodeURIComponent(channel.id)}`, { method: 'DELETE' })
      setData((current) => ({ ...current, channels: current.channels.filter((item) => item.id !== channel.id) }))
      notify('渠道已删除')
    } catch (caught) { notify(caught.message) }
  }

  if (loading) return <Panel className="empty-state"><RefreshCw className="spin" size={23} /><h2>正在加载渠道</h2></Panel>
  return <div className="channel-page">
    {error && <div className="config-error"><AlertTriangle size={13} />{error}</div>}
    <div className="channel-cards">{Object.entries(PROVIDERS).map(([type, provider]) => {
      const Icon = provider.Icon
      const count = providerCounts[type] || 0
      const active = data.channels.filter((channel) => channel.type === type && channel.enabled).length
      return <Panel className="provider-card" key={type}><div className="provider-title"><span className={`provider-icon ${provider.tone}`}><Icon /></span><div><h2>{provider.name}</h2><p>{type === 'feishu' ? '飞书机器人、任务完成和失败通知' : '企业微信机器人与群通知'}</p></div><Badge tone={active ? 'green' : count ? 'gray' : 'amber'}>{active ? `已连接 ${active}` : count ? '已暂停' : '未连接'}</Badge></div><label className="field-label">连接方式<span className="channel-summary-field">官方群机器人 Webhook</span></label><label className="field-label">通知范围<span className="channel-summary-field">会话完成、执行失败 · {count} 个配置</span></label><button className="button secondary wide channel-provider-connect" onClick={() => setModal({ channel: null, type })}><Plus size={14} />连接{provider.name}</button></Panel>
    })}</div>
    <div className="two-one-grid">
      <Panel><div className="channel-section-head"><SectionTitle title="通知路由" /><span>{data.channels.length} 个渠道</span></div>{data.channels.length ? data.channels.map((channel) => {
        const provider = PROVIDERS[channel.type]
        return <div className={`route-row channel-route-row ${selectedId === channel.id ? 'selected' : ''}`} key={channel.id} onClick={() => setSelectedId(channel.id)}><span className="route-icon"><GitBranch size={14} /></span><div className="channel-route-copy"><strong>{channel.name} → {provider.name}</strong><small>{channel.events.length ? EVENT_OPTIONS.filter(([id]) => channel.events.includes(id)).map(([, label]) => label).join('、') : '仅手动发送'}{channel.lastTest ? ` · ${channel.lastTest.ok ? '测试正常' : '测试失败'} ${relativeTime(channel.lastTest.at)}` : ' · 尚未测试'}</small></div><div className="channel-route-controls"><Badge tone={!channel.enabled ? 'gray' : channel.lastTest?.ok ? 'green' : channel.lastTest ? 'red' : 'amber'}>{channel.enabled ? '启用' : '暂停'}</Badge><Toggle value={channel.enabled} disabled={toggling === channel.id} onChange={(enabled) => toggle(channel, enabled)} /><button className="icon-button" title="编辑渠道" onClick={(event) => { event.stopPropagation(); setModal({ channel, type: channel.type }) }}><Pencil size={13} /></button><button className="icon-button danger" title="删除渠道" onClick={(event) => { event.stopPropagation(); remove(channel) }}><Trash2 size={13} /></button></div></div>
      }) : <div className="channel-route-empty"><MessageSquare size={20} /><strong>还没有通知路由</strong><span>点击上方平台卡片，约一分钟即可完成连接。</span></div>}</Panel>
      <Panel className="test-panel"><SectionTitle title="测试发送" /><p>选择渠道后发送一条模拟任务完成消息，验证 Webhook、签名和群权限。</p>{data.channels.length ? <><label className="field-label">目标渠道<span className="select-wrap"><select value={selectedId} onChange={(event) => setSelectedId(event.target.value)}>{data.channels.map((channel) => <option value={channel.id} key={channel.id}>{channel.name} · {PROVIDERS[channel.type].name}</option>)}</select><ChevronDown size={13} /></span></label><div className="test-summary"><CheckCircle2 size={14} />模板：Agent 连接测试</div><div className="test-summary"><ShieldCheck size={14} />地址：{selectedChannel?.webhookPreview}</div>{selectedChannel?.lastTest && <div className={`channel-last-test ${selectedChannel.lastTest.ok ? 'success' : 'error'}`}>{selectedChannel.lastTest.ok ? <CheckCircle2 size={13} /> : <AlertTriangle size={13} />}{selectedChannel.lastTest.message} · {relativeTime(selectedChannel.lastTest.at)}</div>}<button className="button primary wide" disabled={!selectedChannel || testing === selectedChannel.id} onClick={() => selectedChannel && test(selectedChannel)}>{testing === selectedChannel?.id ? <RefreshCw className="spin" size={15} /> : <Send size={15} />}{testing === selectedChannel?.id ? '发送中…' : '发送测试消息'}</button></> : <><div className="test-summary"><AlertTriangle size={14} />请先连接飞书或企业微信</div><button className="button primary wide" onClick={() => setModal({ channel: null, type: 'feishu' })}><Plus size={15} />连接渠道</button></>}</Panel>
    </div>
    {modal && <ChannelModal channel={modal.channel} initialType={modal.type} capabilities={data.capabilities} onClose={() => setModal(null)} onSaved={() => { setModal(null); load() }} notify={notify} />}
  </div>
}

function ChannelModal({ channel, initialType, capabilities, onClose, onSaved, notify }) {
  const [draft, setDraft] = useState(() => channel ? { ...initialDraft(channel.type), type: channel.type, name: channel.name, enabled: channel.enabled, events: channel.events } : initialDraft(initialType))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const provider = PROVIDERS[draft.type]
  const capability = capabilities?.[draft.type] || {}
  const toggleEvent = (id) => setDraft((current) => ({ ...current, events: current.events.includes(id) ? current.events.filter((event) => event !== id) : [...current.events, id] }))

  const submit = async (event) => {
    event.preventDefault(); setSaving(true); setError('')
    try {
      const body = { type: draft.type, name: draft.name, webhookUrl: draft.webhookUrl, signingSecret: draft.signingSecret, clearSigningSecret: draft.clearSigningSecret, enabled: draft.enabled, events: draft.events }
      const saved = channel ? await apiJson(`/api/channels/${encodeURIComponent(channel.id)}`, { method: 'PATCH', body: JSON.stringify(body) }) : await apiJson('/api/channels', { method: 'POST', body: JSON.stringify(body) })
      if (draft.testAfterSave) {
        try { await apiJson(`/api/channels/${encodeURIComponent(saved.id)}/test`, { method: 'POST', body: '{}' }); notify('渠道已保存，测试消息发送成功') }
        catch (caught) { notify(`配置已保存，但测试失败：${caught.message}`); onSaved(); return }
      } else notify('渠道已保存')
      onSaved()
    } catch (caught) { setError(caught.message) }
    finally { setSaving(false) }
  }

  return <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><form className="modal channel-modal" onSubmit={submit}><div className="card-head"><div><h2>{channel ? '编辑渠道' : '连接通知渠道'}</h2><p>三步完成，不需要部署回调服务。</p></div><button type="button" className="icon-button" onClick={onClose}><X size={17} /></button></div>
    {!channel && <div className="channel-type-switch">{Object.entries(PROVIDERS).map(([type, item]) => <button type="button" className={draft.type === type ? 'active' : ''} onClick={() => setDraft(initialDraft(type))} key={type}><ChannelIcon type={type} /><span><strong>{item.name}</strong><small>{item.subtitle}</small></span></button>)}</div>}
    <div className="channel-guide"><div className="channel-guide-head"><span><Zap size={14} />最快接入</span><a href={capability.docsUrl} target="_blank" rel="noreferrer">打开官方指南<ExternalLink size={12} /></a></div><ol>{provider.steps.map((step) => <li key={step}>{step}</li>)}</ol></div>
    <label className="field-label">渠道名称<input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder={`${provider.name}通知群`} /></label>
    <label className="field-label">Webhook URL<input type="password" value={draft.webhookUrl} onChange={(event) => setDraft({ ...draft, webhookUrl: event.target.value })} placeholder={channel ? `留空保持当前地址 · ${channel.webhookPreview}` : provider.placeholder} /></label>
    {draft.type === 'feishu' && <><label className="field-label">签名密钥（推荐，可选）<input type="password" value={draft.signingSecret} disabled={draft.clearSigningSecret} onChange={(event) => setDraft({ ...draft, signingSecret: event.target.value })} placeholder={channel?.signingSecretConfigured ? '已配置；留空保持不变' : '飞书机器人安全设置中的签名密钥'} /></label>{channel?.signingSecretConfigured && <label className="check-row compact"><input type="checkbox" checked={draft.clearSigningSecret} onChange={(event) => setDraft({ ...draft, clearSigningSecret: event.target.checked })} /><span>移除当前签名密钥</span></label>}</>}
    <div className="channel-rule-editor"><SectionTitle title="自动通知" />{EVENT_OPTIONS.map(([id, label, description]) => <label className="channel-rule-option" key={id}><input type="checkbox" checked={draft.events.includes(id)} onChange={() => toggleEvent(id)} /><span><strong>{label}</strong><small>{description}</small></span></label>)}</div>
    <div className="modal-toggle-row"><span><strong>启用此渠道</strong><small>暂停后仍保留配置，但不会自动发送</small></span><Toggle value={draft.enabled} onChange={(enabled) => setDraft({ ...draft, enabled })} /></div>
    <div className="modal-toggle-row"><span><strong>保存后发送测试消息</strong><small>立即验证 Webhook、签名和群权限</small></span><Toggle value={draft.testAfterSave} onChange={(testAfterSave) => setDraft({ ...draft, testAfterSave })} /></div>
    {error && <div className="config-error"><AlertTriangle size={13} />{error}</div>}
    <div className="modal-actions"><button type="button" className="button secondary" onClick={onClose}>取消</button><button className="button primary" disabled={saving || !draft.name.trim() || (!channel && !draft.webhookUrl.trim())}>{saving ? <RefreshCw className="spin" size={14} /> : <Link2 size={14} />}{saving ? '正在验证…' : channel ? '保存配置' : '连接并测试'}</button></div>
  </form></div>
}
