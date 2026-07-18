import { useCallback, useEffect, useMemo, useState } from 'react'
import { AlertTriangle, Bell, Bot, CheckCircle2, ChevronDown, Clock3, FolderOpen, MessageCircle, Play, Plus, RefreshCw, Save, Trash2, X } from 'lucide-react'
import { Badge, Panel, SectionTitle, Toggle } from '../../components/ui.jsx'
import { apiJson } from '../../lib/api.js'
import { relativeTime } from '../../lib/format.js'

const TARGETS = {
  browser: { name: '浏览器', Icon: Bell },
  feishu: { name: '飞书', Icon: Bot },
  weixin: { name: '微信', Icon: MessageCircle },
}
const FREQUENCIES = { daily: '每天', weekly: '每周', monthly: '每月' }
const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六']
const STATUS = { idle: ['等待运行', 'gray'], running: ['运行中', 'amber'], completed: ['已完成', 'green'], failed: ['失败', 'red'], interrupted: ['已中断', 'amber'] }

function taskDraft(task) {
  return {
    id: task.id,
    name: task.name,
    prompt: task.prompt,
    enabled: task.enabled,
    frequency: task.frequency,
    time: task.time,
    timezone: task.timezone,
    dayOfWeek: task.dayOfWeek,
    dayOfMonth: task.dayOfMonth,
    cwd: task.cwd,
    model: task.model ? `${task.model.provider}/${task.model.model}` : '',
    notifications: task.notifications || [],
    notifyOn: task.notifyOn || 'always',
  }
}

function nextRunLabel(task) {
  if (!task.enabled || !task.nextRunAt) return '已暂停'
  return new Intl.DateTimeFormat('zh-CN', { timeZone: task.timezone, dateStyle: 'medium', timeStyle: 'short' }).format(new Date(task.nextRunAt))
}

export function SchedulesPage({ notify, createSignal, openNotificationSettings }) {
  const [data, setData] = useState({ tasks: [], runs: [], models: [], notificationTargets: {} })
  const [selectedId, setSelectedId] = useState('')
  const [draft, setDraft] = useState(null)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [createOpen, setCreateOpen] = useState(false)

  const load = useCallback(async () => {
    try {
      const result = await apiJson('/api/schedules')
      setData(result)
      setSelectedId((current) => result.tasks.some((task) => task.id === current) ? current : result.tasks[0]?.id || '')
    } catch (caught) { setError(caught.message) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])
  useEffect(() => { if (createSignal > 0) setCreateOpen(true) }, [createSignal])
  useEffect(() => {
    const timer = window.setInterval(load, data.tasks.some((task) => task.lastStatus === 'running') ? 2000 : 10_000)
    return () => window.clearInterval(timer)
  }, [data.tasks, load])

  const selected = data.tasks.find((task) => task.id === selectedId)
  useEffect(() => { setDraft((current) => selected ? current?.id === selected.id ? current : taskDraft(selected) : null) }, [selected])
  const runs = useMemo(() => data.runs.filter((run) => run.taskId === selectedId).sort((a, b) => new Date(b.startedAt) - new Date(a.startedAt)).slice(0, 20), [data.runs, selectedId])
  const updateDraft = (patch) => setDraft((current) => ({ ...current, ...patch }))
  const toggleNotification = (target) => updateDraft({ notifications: draft.notifications.includes(target) ? draft.notifications.filter((item) => item !== target) : [...draft.notifications, target] })

  const save = async () => {
    if (!selected || !draft) return
    setSaving(true); setError('')
    try {
      const [provider, ...modelParts] = draft.model.split('/')
      const result = await apiJson(`/api/schedules/${encodeURIComponent(selected.id)}`, { method: 'PATCH', body: JSON.stringify({ ...draft, model: draft.model ? { provider, model: modelParts.join('/') } : null }) })
      setData(result.state); setDraft(taskDraft(result.task)); notify('定时任务已保存')
    } catch (caught) { setError(caught.message) }
    finally { setSaving(false) }
  }

  const run = async () => {
    if (!selected) return
    setSaving(true); setError('')
    try { await apiJson(`/api/schedules/${encodeURIComponent(selected.id)}/run`, { method: 'POST', body: '{}' }); await load(); notify('定时任务已开始运行') }
    catch (caught) { setError(caught.message) }
    finally { setSaving(false) }
  }

  const remove = async () => {
    if (!selected || !window.confirm(`删除定时任务「${selected.name}」及其执行历史？`)) return
    try { await apiJson(`/api/schedules/${encodeURIComponent(selected.id)}`, { method: 'DELETE' }); await load(); notify('定时任务已删除') }
    catch (caught) { setError(caught.message) }
  }

  if (loading) return <Panel className="empty-state"><RefreshCw className="spin" size={23} /><h2>正在加载定时任务</h2></Panel>
  return <>
    {error && <div className="config-error"><AlertTriangle size={13} />{error}</div>}
    <div className="split-list-detail">
      <Panel className="selection-list"><SectionTitle title="任务队列" />{data.tasks.length ? data.tasks.map((task) => { const [label, tone] = STATUS[task.lastStatus] || STATUS.idle; return <button className={`selection-item ${selectedId === task.id ? 'active' : ''}`} onClick={() => setSelectedId(task.id)} key={task.id}><div><strong>{task.name}</strong><Badge tone={tone}>{task.enabled ? label : '暂停'}</Badge></div><p>{task.prompt}</p><small>{nextRunLabel(task)}</small></button> }) : <div className="channel-route-empty"><Clock3 size={22} /><strong>还没有定时任务</strong><span>点击右上角“新建任务”开始配置。</span></div>}</Panel>
      {selected && draft ? <div className="detail-stack">
        <Panel><div className="card-head"><div><h2>{draft.name}</h2><p>{selected.lastStatus === 'running' ? 'Agent 正在执行任务' : `下次运行：${nextRunLabel(selected)}`}</p></div><div className="schedule-head-actions"><Toggle value={draft.enabled} onChange={(enabled) => updateDraft({ enabled })} /><button className="button dark" disabled={saving || selected.lastStatus === 'running'} onClick={run}>{selected.lastStatus === 'running' ? <RefreshCw className="spin" size={14} /> : <Play size={14} />}{selected.lastStatus === 'running' ? '运行中' : '立即运行'}</button></div></div>
          <label className="field-label">任务名称<input value={draft.name} onChange={(event) => updateDraft({ name: event.target.value })} /></label>
          <label className="field-label">Prompt<textarea value={draft.prompt} onChange={(event) => updateDraft({ prompt: event.target.value })} /></label>
          <div className="form-grid three"><label className="field-label">频率<span className="select-wrap"><select value={draft.frequency} onChange={(event) => updateDraft({ frequency: event.target.value })}>{Object.entries(FREQUENCIES).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select><ChevronDown size={13} /></span></label><label className="field-label">时间<input type="time" value={draft.time} onChange={(event) => updateDraft({ time: event.target.value })} /></label><label className="field-label">时区<span className="select-wrap"><select value={draft.timezone} onChange={(event) => updateDraft({ timezone: event.target.value })}><option>Asia/Hong_Kong</option><option>UTC</option></select><ChevronDown size={13} /></span></label></div>
          {draft.frequency !== 'daily' && <div className="form-grid three">{draft.frequency === 'weekly' ? <label className="field-label">星期<span className="select-wrap"><select value={draft.dayOfWeek} onChange={(event) => updateDraft({ dayOfWeek: Number(event.target.value) })}>{WEEKDAYS.map((label, value) => <option value={value} key={label}>{label}</option>)}</select><ChevronDown size={13} /></span></label> : <label className="field-label">日期<span className="select-wrap"><select value={draft.dayOfMonth} onChange={(event) => updateDraft({ dayOfMonth: Number(event.target.value) })}>{Array.from({ length: 28 }, (_, index) => index + 1).map((day) => <option value={day} key={day}>{day} 日</option>)}</select><ChevronDown size={13} /></span></label>}</div>}
          <div className="form-grid three"><label className="field-label">模型<span className="select-wrap"><select value={draft.model} onChange={(event) => updateDraft({ model: event.target.value })}><option value="">跟随应用默认模型</option>{data.models.map((model) => <option value={`${model.provider}/${model.model}`} key={`${model.provider}/${model.model}`}>{model.label}</option>)}</select><ChevronDown size={13} /></span></label><label className="field-label">通知条件<span className="select-wrap"><select value={draft.notifyOn} onChange={(event) => updateDraft({ notifyOn: event.target.value })}><option value="always">完成或失败</option><option value="failure">仅失败</option></select><ChevronDown size={13} /></span></label><label className="field-label">工作目录<span className="channel-setting-input"><FolderOpen size={13} /><input value={draft.cwd} onChange={(event) => updateDraft({ cwd: event.target.value })} /></span></label></div>
          <div className="tag-field"><span>通知渠道</span>{Object.entries(TARGETS).map(([id, target]) => { const Icon = target.Icon; const available = data.notificationTargets[id]?.enabled; return <button type="button" className={`schedule-notification-chip ${draft.notifications.includes(id) ? 'selected' : ''}`} title={available ? '可用' : id === 'browser' ? '浏览器通知未启用' : '渠道未连接'} onClick={() => toggleNotification(id)} key={id}><Icon size={12} />{target.name}</button> })}<button type="button" className="text-button" onClick={openNotificationSettings}>编辑模板</button></div>
          <div className="form-footer"><span>完成与失败通知使用“配置 → 通知设置”中的模板</span><div className="schedule-footer-actions"><button className="button danger" onClick={remove}><Trash2 size={13} />删除</button><button className="button primary" disabled={saving || !draft.name.trim() || !draft.prompt.trim()} onClick={save}>{saving ? <RefreshCw className="spin" size={14} /> : <Save size={14} />}{saving ? '保存中…' : '保存任务'}</button></div></div>
        </Panel>
        <Panel><SectionTitle title="最近执行" />{runs.length ? runs.map((item) => <div className={`activity-row ${item.status}`} key={item.id}>{item.status === 'running' ? <RefreshCw className="spin" size={15} /> : item.status === 'completed' ? <CheckCircle2 size={15} /> : <AlertTriangle size={15} />}<span><strong>{item.status === 'running' ? '正在运行' : item.status === 'completed' ? item.summary || '任务已完成' : item.error || '任务执行失败'}</strong><small>{relativeTime(item.startedAt)} · {item.trigger === 'manual' ? '手动运行' : '定时触发'}{item.durationMs ? ` · ${Math.round(item.durationMs / 1000)} 秒` : ''}</small></span></div>) : <div className="channel-route-empty compact"><Clock3 size={20} /><strong>暂无执行记录</strong></div>}</Panel>
      </div> : <Panel className="empty-state"><Clock3 size={24} /><h2>选择或创建任务</h2><button className="button primary" onClick={() => setCreateOpen(true)}><Plus size={14} />新建任务</button></Panel>}
    </div>
    {createOpen && <CreateScheduleModal notificationTargets={data.notificationTargets} onClose={() => setCreateOpen(false)} onCreated={(result) => { setCreateOpen(false); setData(result.state); setSelectedId(result.task.id); notify('定时任务已创建') }} />}
  </>
}

function CreateScheduleModal({ notificationTargets, onClose, onCreated }) {
  const [name, setName] = useState('')
  const [prompt, setPrompt] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const submit = async (event) => {
    event.preventDefault(); setSaving(true); setError('')
    try {
      const notifications = Object.entries(notificationTargets).filter(([, value]) => value.enabled).map(([id]) => id)
      onCreated(await apiJson('/api/schedules', { method: 'POST', body: JSON.stringify({ name, prompt, enabled: true, frequency: 'daily', time: '09:00', timezone: 'Asia/Hong_Kong', notifications, notifyOn: 'always' }) }))
    } catch (caught) { setError(caught.message) }
    finally { setSaving(false) }
  }
  return <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><form className="modal" onSubmit={submit}><div className="card-head"><div><h2>新建定时任务</h2><p>创建后可继续设置运行时间、模型、目录和通知渠道。</p></div><button type="button" className="icon-button" onClick={onClose}><X size={17} /></button></div><label className="field-label">任务名称<input value={name} onChange={(event) => setName(event.target.value)} placeholder="例如 每日代码巡检" /></label><label className="field-label">Prompt<textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder="描述 Agent 每次需要完成的工作" /></label>{error && <div className="config-error"><AlertTriangle size={13} />{error}</div>}<div className="modal-actions"><button type="button" className="button secondary" onClick={onClose}>取消</button><button className="button primary" disabled={saving || !name.trim() || !prompt.trim()}>{saving ? <RefreshCw className="spin" size={14} /> : <Plus size={14} />}{saving ? '创建中…' : '创建任务'}</button></div></form></div>
}
