import { useCallback, useEffect, useState } from 'react'
import { FileCode2, Image, Package, RefreshCw, Save, Sparkles, Trash2, Wrench } from 'lucide-react'
import { useI18n } from '../../app/use-i18n.js'
import { Badge, Panel, SectionTitle, Segmented, Toggle } from '../../components/ui.jsx'
import { usePagePrimaryAction } from '../../hooks/usePagePrimaryAction.js'
import { apiJson } from '../../lib/api.js'

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
  const text = `${skill.name} ${skill.description} ${(skill.allowedTools || []).join(' ')}`.toLowerCase()
  if (filter === '设计') return /image|visual|design|figma|svg|图片|视觉|设计/.test(text)
  if (filter === '代码') return /code|test|plugin|代码|测试|插件/.test(text)
  if (filter === '文档') return /doc|pdf|文档|说明/.test(text)
  if (filter === '高权限') return (skill.allowedTools || []).some((tool) => ['bash', 'write', 'edit'].includes(tool))
  return true
}

export function SkillsPage({ notify, query = '', registerPrimaryAction, requestText, requestConfirm }) {
  const { t } = useI18n()
  const [data, setData] = useState(null)
  const [selectedId, setSelectedId] = useState('')
  const [filter, setFilter] = useState('全部')
  const [busy, setBusy] = useState(false)
  const [loading, setLoading] = useState(true)
  const [, setError] = useState('')
  const filters = ['全部', '已安装', '设计', '代码', '文档', '高权限']

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
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { void load() }, [load])

  const installSkill = useCallback(async () => {
    const source = await requestText?.({
      title: t('安装技能'),
      message: t('输入本地技能目录、SKILL.md、npm 包或 git 来源。Vesper 只导入其中的技能资源。'),
      inputLabel: t('技能来源'),
      placeholder: 'npm:@scope/vesper-skills or ./path/to/skill',
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

  if (loading && !data) {
    return (
      <div className="skills-page">
        <Panel className="empty-state">
          <RefreshCw className="spin" size={23} />
          <h2>{t('正在加载技能')}</h2>
          <p>{t('正在扫描技能目录与已配置技能包')}</p>
        </Panel>
      </div>
    )
  }

  const skills = data?.skills || []
  const filteredSkills = skills.filter((skill) => skillMatchesFilter(skill, filter) && `${skill.name} ${skill.description}`.toLowerCase().includes(query.toLowerCase()))
  const selected = skills.find((skill) => skill.id === selectedId) || filteredSkills[0] || skills[0] || null
  const packages = (data?.packages || [])
    .map((item) => ({
      source: item.source,
      description: item.scope === 'project' ? t('项目级配置') : t('用户级配置'),
      status: item.installed ? t('本地已就绪') : t('尚未落地'),
      tone: item.installed ? 'green' : 'gray',
    }))
    .filter((item) => `${item.source} ${item.description}`.toLowerCase().includes(query.toLowerCase()))

  const updateSkill = async (skill, patch) => {
    if (!skill) return
    setBusy(true)
    setError('')
    try {
      const updated = await apiJson(`/api/skills/${encodeURIComponent(skill.id)}`, { method: 'PATCH', body: JSON.stringify(patch) })
      setData((current) => {
        const nextSkills = current.skills.map((item) => item.id === updated.id ? updated : item)
        return {
          ...current,
          skills: nextSkills,
          counts: {
            ...current.counts,
            enabled: nextSkills.filter((item) => item.enabled).length,
            modelInvocable: nextSkills.filter((item) => item.enabled && item.modelInvocationEnabled).length,
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

  return (
    <div className="skills-page">
      <Segmented options={filters.map(t)} value={t(filter)} onChange={(label) => setFilter(filters.find((item) => t(item) === label) || '全部')} />
      <div className="skills-layout">
        <Panel>
          <SectionTitle title={t('已安装技能')} />
          {filteredSkills.length ? filteredSkills.map((skill) => {
            const Icon = skillIcon(skill)
            return (
              <button className={`skill-row ${selected?.id === skill.id ? 'selected' : ''}`} onClick={() => setSelectedId(skill.id)} key={skill.id}>
                <span className="list-icon"><Icon size={15} /></span>
                <span><strong>{skill.name}</strong><small>{skill.description}</small></span>
                <Toggle value={skill.enabled} disabled={busy} ariaLabel={t('切换技能 {name}', { name: skill.name })} onChange={(enabled) => void updateSkill(skill, { enabled })} />
              </button>
            )
          }) : (
            <p className="muted-copy skills-empty-copy">{t(skills.length ? '当前筛选下没有匹配技能。' : '尚未安装技能。请用右上角“安装技能”接入本地目录、npm 或 git 来源。')}</p>
          )}
        </Panel>
        <Panel>
          <div className="card-head">
            <SectionTitle title={t('已配置技能包')} />
            <span className="skills-package-count">{t('{count} 个技能包', { count: packages.length })}</span>
          </div>
          {packages.length ? packages.map((item) => (
            <div className="market-row" key={item.source}>
              <span className="list-icon"><Package size={15} /></span>
              <span><strong title={item.source}>{item.source}</strong><small>{item.description}</small></span>
              <Badge tone={item.tone}>{item.status}</Badge>
            </div>
          )) : (
            <p className="muted-copy skills-empty-copy">{t('当前没有已配置技能包。安装技能后，对应来源会出现在这里。')}</p>
          )}
        </Panel>
        <div className="detail-stack">
          <Panel>
            <SectionTitle title={t('选中技能')} />
            <h2>{selected?.name || t('尚未安装技能')}</h2>
            <p className="muted-copy">{selected?.description || t('使用右上角按钮安装符合 Agent Skills 标准的技能。')}</p>
            {[
              [t('触发方式'), selected?.modelInvocationEnabled ? t('自动 + 手动') : t('仅手动')],
              [t('权限'), selected?.allowedTools?.length ? selected.allowedTools.join(', ') : t('按会话工具权限')],
              [t('版本'), selected?.version || 'latest'],
              [t('来源'), selected?.source || '—'],
            ].map((row) => (
              <div className="key-value" key={row[0]}><span>{row[0]}</span><strong>{row[1]}</strong></div>
            ))}
            <button className={`button ${selected?.removable ? 'danger' : 'primary'} wide`} disabled={busy} onClick={selected?.removable ? uninstallSkill : saveSettings}>
              {selected?.removable ? <Trash2 size={14} /> : <Save size={14} />}
              {t(selected?.removable ? '卸载技能' : '保存设置')}
            </button>
          </Panel>
          <Panel>
            <SectionTitle title={t('触发条件')} />
            {[
              [t('允许模型自动调用'), Boolean(selected?.modelInvocationEnabled), false, (checked) => void updateSkill(selected, { modelInvocationEnabled: checked })],
              [t('支持 /skill 手动命令'), Boolean(selected?.command), true],
              [t('项目范围技能'), selected?.sourceInfo?.scope === 'project', true],
              [t('声明所需工具'), Boolean(selected?.allowedTools?.length), true],
            ].map(([item, checked, disabled, onChange]) => (
              <label className="check-row" key={item}>
                <input type="checkbox" checked={checked} disabled={!selected || busy || disabled} onChange={(event) => onChange?.(event.target.checked)} />
                <span>{item}</span>
              </label>
            ))}
          </Panel>
        </div>
      </div>
    </div>
  )
}
