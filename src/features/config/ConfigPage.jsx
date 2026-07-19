import { useEffect, useState } from 'react'
import { AlertTriangle, Bot, Brain, ChevronDown, Code2, KeyRound, Network, Plus, RefreshCw, Save, Server, ShieldCheck, Sparkles, Trash2, X, Zap } from 'lucide-react'
import { Badge, Panel, SectionTitle, Toggle } from '../../components/ui.jsx'
import { usePagePrimaryAction } from '../../hooks/usePagePrimaryAction.js'
import { apiJson } from '../../lib/api.js'
import { NotificationSettings } from './NotificationSettings.jsx'

function configDraft(data, provider, preferredModel) {
  const chatModels = provider?.models.filter((item) => item.kind === 'chat') || []
  const model = chatModels.find((item) => item.id === preferredModel) || chatModels[0]
  return {
    provider: provider?.id || 'openai',
    model: model?.id || '',
    apiKey: '',
    baseUrl: provider?.baseUrl || '',
    modelBaseUrl: model?.baseUrlOverride || '',
    organization: provider?.organization || '',
    thinkingLevel: data.thinkingLevel || 'medium',
    toolMode: data.toolMode || 'read-only',
  }
}

export function ConfigPage({ notify, registerPrimaryAction, section, setSection, onBrowserNotificationChange, requestConfirm }) {
  const [config, setConfig] = useState(null)
  const [draft, setDraft] = useState(null)
  const [saving, setSaving] = useState(false)
  const [toggling, setToggling] = useState('')
  const [error, setError] = useState('')
  const [providerModal, setProviderModal] = useState(false)
  const [modelModal, setModelModal] = useState(false)
  usePagePrimaryAction(registerPrimaryAction, () => setProviderModal(true))

  useEffect(() => {
    apiJson('/api/config')
      .then((data) => {
        setConfig(data)
        const provider = data.providers.find((item) => item.id === data.provider) || data.providers[0]
        setDraft(configDraft(data, provider, data.model))
      })
      .catch((caught) => setError(caught.message))
  }, [])

  const selectProvider = (provider) => {
    setDraft((current) => ({ ...configDraft(config, provider), thinkingLevel: current.thinkingLevel, toolMode: current.toolMode }))
  }

  const selectModel = (modelId) => {
    const provider = config.providers.find((item) => item.id === draft.provider)
    const selectedModel = provider?.models.find((item) => item.id === modelId)
    setDraft((current) => ({ ...current, model: modelId, modelBaseUrl: selectedModel?.baseUrlOverride || '' }))
  }

  const toggleProvider = async (provider, enabled) => {
    setToggling(provider.id)
    setError('')
    try {
      const updated = await apiJson(`/api/providers/${encodeURIComponent(provider.id)}/enabled`, { method: 'PUT', body: JSON.stringify({ enabled }) })
      setConfig(updated)
      notify(`${provider.name} 已${enabled ? '启用' : '停用'}`)
    } catch (caught) {
      setError(caught.message)
    } finally {
      setToggling('')
    }
  }

  const deleteProvider = async (provider) => {
    const approved = await requestConfirm({ title: '删除 Provider 连接', message: `确定删除「${provider.name}」吗？对应的模型配置和认证信息也会删除。`, confirmLabel: '删除' })
    if (!approved) return
    setError('')
    try {
      const updated = await apiJson(`/api/providers/${encodeURIComponent(provider.id)}`, { method: 'DELETE' })
      setConfig(updated)
      const nextProvider = updated.providers.find((item) => item.id === updated.provider) || updated.providers[0]
      setDraft(configDraft(updated, nextProvider, updated.model))
      notify('Provider 连接已删除')
    } catch (caught) {
      setError(caught.message)
    }
  }

  const save = async () => {
    setSaving(true)
    setError('')
    try {
      const saved = await apiJson('/api/config', { method: 'PUT', body: JSON.stringify(draft) })
      setConfig(saved)
      const provider = saved.providers.find((item) => item.id === draft.provider) || saved.providers[0]
      setDraft((current) => ({ ...configDraft(saved, provider, current.model), thinkingLevel: current.thinkingLevel, toolMode: current.toolMode }))
      notify('Agent 配置已保存，新会话将使用该模型')
    } catch (caught) {
      setError(caught.message)
    } finally {
      setSaving(false)
    }
  }

  if (!config || !draft) return <Panel className="empty-state"><RefreshCw className="spin" size={24} /><h2>正在加载模型目录</h2><p>读取 Provider 与认证状态…</p></Panel>
  const selectedProvider = config.providers.find((item) => item.id === draft.provider) || config.providers[0]
  const selectedModel = selectedProvider.models.find((item) => item.id === draft.model)
  const chatModels = selectedProvider.models.filter((item) => item.kind === 'chat')
  const visualModels = selectedProvider.models.filter((item) => item.kind !== 'chat')
  const providerIcons = { openai: Bot, anthropic: Brain, google: Sparkles, deepseek: Code2, xai: Zap, openrouter: Network, 'kimi-coding': Sparkles, 'zai-coding-cn': Brain }
  return (
    <>
    <div className="config-subnav"><button className={section === 'models' ? 'active' : ''} onClick={() => setSection('models')}>模型配置</button><button className={section === 'notifications' ? 'active' : ''} onClick={() => setSection('notifications')}>通知设置</button></div>
    {section === 'notifications' ? <NotificationSettings notify={notify} onBrowserNotificationChange={onBrowserNotificationChange} /> : <>
    <div className="split-list-detail config-layout">
      <Panel className="selection-list"><div className="provider-list-heading"><SectionTitle title="Provider 连接" /><button className="icon-button" title="添加 Provider" onClick={() => setProviderModal(true)}><Plus size={15} /></button></div>{config.providers.map((provider) => { const Icon = providerIcons[provider.id] || Server; return <div className={`provider-list-item ${draft.provider === provider.id ? 'active' : ''} ${provider.enabled ? '' : 'disabled-provider'}`} key={provider.id}><button className="provider-select-main" onClick={() => selectProvider(provider)}><span className="list-icon"><Icon size={16} /></span><span><strong>{provider.name}</strong><small>{provider.id} · {provider.models.length} 个模型</small></span></button><div className="provider-list-control"><Badge tone={!provider.enabled ? 'gray' : provider.configured ? 'green' : 'amber'}>{!provider.enabled ? '已停用' : provider.configured ? '已配置' : '未认证'}</Badge><Toggle value={provider.enabled} disabled={!provider.configured || toggling === provider.id} onChange={(enabled) => toggleProvider(provider, enabled)} /></div></div> })}</Panel>
      <div className="detail-stack">
        <Panel>
          <div className="card-head"><div><h2>{selectedProvider.name}</h2><p>{selectedProvider.id} · {selectedProvider.api} · 每个连接独立保存认证与地址</p></div><div className="provider-header-status"><Badge tone={!selectedProvider.enabled ? 'gray' : selectedProvider.configured ? 'green' : 'amber'}>{!selectedProvider.enabled ? '已停用' : selectedProvider.configured ? '认证可用' : '需要 API Key'}</Badge><Toggle value={selectedProvider.enabled} disabled={!selectedProvider.configured || toggling === selectedProvider.id} onChange={(enabled) => toggleProvider(selectedProvider, enabled)} />{selectedProvider.custom && <button className="icon-button danger" title="删除 Provider" onClick={() => deleteProvider(selectedProvider)}><Trash2 size={14} /></button>}</div></div>
          <label className="field-label">API Key<span className="input-wrap"><input type="password" value={draft.apiKey} onChange={(event) => setDraft({ ...draft, apiKey: event.target.value })} placeholder={selectedProvider.configured ? '已配置；留空将保持现有密钥' : '输入 Provider API Key'} /><KeyRound size={14} /></span></label>
          <label className="field-label">Provider Base URL<input value={draft.baseUrl} onChange={(event) => setDraft({ ...draft, baseUrl: event.target.value })} placeholder="此连接下模型默认使用的地址" /></label>
          <label className="field-label">Organization<input value={draft.organization} onChange={(event) => setDraft({ ...draft, organization: event.target.value })} placeholder="可选，仅 OpenAI Organization 使用" /></label>
          <div className="model-config-heading"><SectionTitle title="模型配置" /><button className="button secondary tiny" onClick={() => setModelModal(true)}><Plus size={13} />添加模型</button></div>
          <label className="field-label">默认对话模型<span className="select-wrap"><select value={draft.model} onChange={(event) => selectModel(event.target.value)}>{chatModels.map((model) => <option key={model.id} value={model.id}>{model.name}</option>)}</select><ChevronDown size={13} /></span></label>
          <label className="field-label">模型 Base URL<input value={draft.modelBaseUrl} onChange={(event) => setDraft({ ...draft, modelBaseUrl: event.target.value })} placeholder="可选；为当前模型覆盖 Provider Base URL" /></label>
          <div className="tag-field"><Badge>{draft.provider}</Badge><Badge>{selectedModel?.reasoning ? '支持推理' : '标准模型'}</Badge><Badge tone="gray">{selectedModel?.contextWindow ? `${Math.round(selectedModel.contextWindow / 1000)}K context` : '自动上下文'}</Badge>{selectedModel?.baseUrlOverride && <Badge tone="amber">独立 Base URL</Badge>}</div>
          {visualModels.length > 0 && <div className="visual-model-list"><span>视觉模型</span>{visualModels.map((model) => <Badge tone={model.kind === 'video' ? 'violet' : 'blue'} key={model.id}>{model.name} · {model.kind === 'video' ? '视频' : '图像'}</Badge>)}</div>}
        </Panel>
        <div className="config-bottom">
          <Panel><SectionTitle title="Agent 运行策略" /><label className="field-label">思考强度<span className="select-wrap"><select value={draft.thinkingLevel} onChange={(event) => setDraft({ ...draft, thinkingLevel: event.target.value })}>{['off', 'minimal', 'low', 'medium', 'high', 'xhigh'].map((level) => <option key={level}>{level}</option>)}</select><ChevronDown size={13} /></span></label><label className="field-label">工具权限<span className="select-wrap"><select value={draft.toolMode} onChange={(event) => setDraft({ ...draft, toolMode: event.target.value })}><option value="read-only">只读：read / grep / find / ls</option><option value="workspace">工作区：允许 edit / write</option><option value="full">完整：允许 bash</option><option value="custom">自定义：在插件页逐项管理</option></select><ChevronDown size={13} /></span></label><div className="permission-note"><ShieldCheck size={16} /><span><strong>权限在服务端生效</strong><small>切换配置后，现有运行时会释放，新会话按最新策略创建。</small></span></div></Panel>
          <Panel className="usage-card"><SectionTitle title="运行时状态" /><div className="usage-number"><span>Engine</span><strong>Pi 0.80</strong></div><div className="usage-number"><span>Provider</span><strong>{selectedProvider.name}</strong></div><div className="usage-number"><span>Models</span><strong>{selectedProvider.models.length}</strong></div><div className="usage-number"><span>状态</span><strong>{selectedProvider.enabled ? '启用' : '停用'}</strong></div>{error && <div className="config-error"><AlertTriangle size={13} />{error}</div>}<button className="button primary wide" disabled={saving || !draft.model || !selectedProvider.enabled} onClick={save}>{saving ? <RefreshCw className="spin" size={14} /> : <Save size={14} />}{saving ? '保存中…' : selectedProvider.enabled ? '保存并设为默认' : '启用后可保存'}</button></Panel>
        </div>
      </div>
    </div>
    {providerModal && <ProviderConfigModal onClose={() => setProviderModal(false)} onCreated={(data) => { const provider = data.providers.find((item) => item.id === data.createdProviderId); setConfig(data); setDraft(configDraft(data, provider)); setProviderModal(false); notify('Provider 连接已创建') }} />}
    {modelModal && <ProviderModelModal provider={selectedProvider} onClose={() => setModelModal(false)} onCreated={(data, modelId) => { const provider = data.providers.find((item) => item.id === selectedProvider.id); setConfig(data); setDraft((current) => ({ ...configDraft(data, provider, modelId), thinkingLevel: current.thinkingLevel, toolMode: current.toolMode })); setModelModal(false); notify('模型已添加') }} />}
    </>}
    </>
  )
}

const PROVIDER_APIS = [
  ['openai-responses', 'OpenAI Responses'],
  ['openai-completions', 'OpenAI Chat Completions'],
  ['anthropic-messages', 'Anthropic Messages'],
  ['google-generative-ai', 'Google Generative AI'],
]

function ProviderConfigModal({ onClose, onCreated }) {
  const [draft, setDraft] = useState({ name: '', id: '', api: 'openai-responses', baseUrl: '', apiKey: '', model: '', modelName: '', modelKind: 'auto', reasoning: true, enabled: true })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const updateName = (name) => setDraft((current) => ({ ...current, name, id: current.id || name.toLowerCase().replace(/[^a-z0-9._-]+/g, '-').replace(/^-+|-+$/g, '') }))
  const submit = async (event) => {
    event.preventDefault()
    setSaving(true); setError('')
    try {
      onCreated(await apiJson('/api/providers', { method: 'POST', body: JSON.stringify(draft) }))
    } catch (caught) { setError(caught.message) } finally { setSaving(false) }
  }
  return <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><form className="modal provider-config-modal" onSubmit={submit}><div className="card-head"><div><h2>添加 Provider 连接</h2><p>同一种协议可创建多个连接，每个连接独立使用 Key 和 Base URL。</p></div><button type="button" className="icon-button" onClick={onClose}><X size={17} /></button></div><div className="form-grid"><label className="field-label">显示名称<input value={draft.name} onChange={(event) => updateName(event.target.value)} placeholder="例如 OpenAI 官方" /></label><label className="field-label">Provider ID<input value={draft.id} onChange={(event) => setDraft({ ...draft, id: event.target.value })} placeholder="openai-official" /></label></div><label className="field-label">API 协议<span className="select-wrap"><select value={draft.api} onChange={(event) => setDraft({ ...draft, api: event.target.value })}>{PROVIDER_APIS.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select><ChevronDown size={13} /></span></label><label className="field-label">Base URL<input value={draft.baseUrl} onChange={(event) => setDraft({ ...draft, baseUrl: event.target.value })} placeholder="https://api.openai.com/v1" /></label><label className="field-label">API Key<input type="password" value={draft.apiKey} onChange={(event) => setDraft({ ...draft, apiKey: event.target.value })} placeholder="输入此连接使用的 API Key" /></label><div className="form-grid"><label className="field-label">初始模型 ID<input value={draft.model} onChange={(event) => setDraft({ ...draft, model: event.target.value })} placeholder="gpt-5.4 或 gpt-image-1" /></label><label className="field-label">模型名称<input value={draft.modelName} onChange={(event) => setDraft({ ...draft, modelName: event.target.value })} placeholder="留空使用模型 ID" /></label></div><label className="field-label">模型用途<span className="select-wrap"><select value={draft.modelKind} onChange={(event) => setDraft({ ...draft, modelKind: event.target.value })}><option value="auto">自动识别</option><option value="chat">对话</option><option value="image">图像生成</option><option value="video">视频生成</option></select><ChevronDown size={13} /></span></label><div className="modal-toggle-row"><span><strong>创建后启用</strong><small>视觉模型由视觉生成工具自动选择，不会进入对话模型列表</small></span><Toggle value={draft.enabled} onChange={(enabled) => setDraft({ ...draft, enabled })} /></div>{error && <div className="config-error"><AlertTriangle size={13} />{error}</div>}<div className="modal-actions"><button type="button" className="button secondary" onClick={onClose}>取消</button><button className="button primary" disabled={saving}>{saving ? <RefreshCw className="spin" size={14} /> : <Plus size={14} />}{saving ? '创建中…' : '创建连接'}</button></div></form></div>
}

function ProviderModelModal({ provider, onClose, onCreated }) {
  const [draft, setDraft] = useState({ id: '', name: '', api: provider.api || 'openai-responses', baseUrl: '', kind: 'auto', reasoning: true })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const submit = async (event) => {
    event.preventDefault(); setSaving(true); setError('')
    try {
      const data = await apiJson(`/api/providers/${encodeURIComponent(provider.id)}/models`, { method: 'POST', body: JSON.stringify(draft) })
      onCreated(data, draft.id)
    } catch (caught) { setError(caught.message) } finally { setSaving(false) }
  }
  return <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><form className="modal" onSubmit={submit}><div className="card-head"><div><h2>添加模型</h2><p>添加到 {provider.name}，可单独覆盖 Base URL。</p></div><button type="button" className="icon-button" onClick={onClose}><X size={17} /></button></div><div className="form-grid"><label className="field-label">模型 ID<input value={draft.id} onChange={(event) => setDraft({ ...draft, id: event.target.value })} placeholder="gpt-5.4-mini、gpt-image-1 或 sora-2" /></label><label className="field-label">显示名称<input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="留空使用模型 ID" /></label></div><label className="field-label">模型 Base URL<input value={draft.baseUrl} onChange={(event) => setDraft({ ...draft, baseUrl: event.target.value })} placeholder="可选；留空继承 Provider Base URL" /></label><label className="field-label">API 协议<span className="select-wrap"><select value={draft.api} onChange={(event) => setDraft({ ...draft, api: event.target.value })}>{PROVIDER_APIS.map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select><ChevronDown size={13} /></span></label><label className="field-label">模型用途<span className="select-wrap"><select value={draft.kind} onChange={(event) => setDraft({ ...draft, kind: event.target.value })}><option value="auto">自动识别</option><option value="chat">对话</option><option value="image">图像生成</option><option value="video">视频生成</option></select><ChevronDown size={13} /></span></label>{draft.kind !== 'image' && draft.kind !== 'video' && <div className="modal-toggle-row"><span><strong>推理模型</strong><small>启用 reasoning effort / thinking level</small></span><Toggle value={draft.reasoning} onChange={(reasoning) => setDraft({ ...draft, reasoning })} /></div>}{error && <div className="config-error"><AlertTriangle size={13} />{error}</div>}<div className="modal-actions"><button type="button" className="button secondary" onClick={onClose}>取消</button><button className="button primary" disabled={saving || !draft.id.trim()}>{saving ? <RefreshCw className="spin" size={14} /> : <Plus size={14} />}{saving ? '添加中…' : '添加模型'}</button></div></form></div>
}

