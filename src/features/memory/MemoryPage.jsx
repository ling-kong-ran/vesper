import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronRight, FileCode2, Pencil, Plus, RefreshCw, Trash2, X, ZoomIn, ZoomOut } from 'lucide-react'
import { Panel, SectionTitle } from '../../components/ui.jsx'
import { StarOrbit } from '../../components/StarOrbit.jsx'
import { apiJson } from '../../lib/api.js'
import { usePagePrimaryAction } from '../../hooks/usePagePrimaryAction.js'

const GALAXY_VIEW = { width: 600, height: 420, cx: 300, cy: 206 }
const MAX_STARS = 24
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5))

const TYPE_LABELS = {
  concept: '概念', file: '文件', risk: '风险', preference: '偏好', decision: '决策', fact: '事实', task: '任务',
}

// 与 index.css 中的 --g-* 星辰色保持一致，用于连线渐变
const STAR_COLORS = {
  concept: '#6eb5ff', file: '#4ade80', risk: '#fb7185', preference: '#c4b5fd',
  decision: '#fbbf24', fact: '#e2e8f0', task: '#67e8f9',
}

function hashSeed(text) {
  let hash = 0
  for (let index = 0; index < text.length; index += 1) hash = (hash * 31 + text.charCodeAt(index)) >>> 0
  return hash
}

// 黄金角螺旋星系布局：服务端按重要度降序返回星辰，越重要越靠近星系核心；同一星域布局稳定
function galaxyLayout(nodes, spaceId) {
  const stars = nodes.slice(0, MAX_STARS)
  if (!stars.length) return []
  if (stars.length === 1) return [{ node: stars[0], x: GALAXY_VIEW.cx, y: GALAXY_VIEW.cy, twinkle: 0 }]
  const seed = (hashSeed(spaceId || 'galaxy') % 628) / 100
  const base = 172 / Math.sqrt(stars.length)
  return stars.map((node, index) => {
    const jitter = hashSeed(node.id)
    const angle = index * GOLDEN_ANGLE + seed
    const radius = base * Math.sqrt(index + 0.55) + (jitter % 11) - 5
    return {
      node,
      x: GALAXY_VIEW.cx + Math.cos(angle) * radius * 1.38,
      y: GALAXY_VIEW.cy + Math.sin(angle) * radius * 0.74,
      twinkle: (jitter % 50) / 10,
    }
  })
}

function formatMemoryTime(value) {
  if (!value) return '—'
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(date)
}

function spaceLabel(space) {
  return space?.kind === 'global' ? '全局星域' : (space?.name || '')
}

// 关联线使用贝塞尔曲线：沿垂直方向轻微弯曲，相邻线交错方向，看起来更柔和
function linkCurve(source, target, seed) {
  const dx = target.x - source.x
  const dy = target.y - source.y
  const length = Math.hypot(dx, dy) || 1
  const bend = Math.min(24, length * 0.16) * (seed % 2 === 0 ? 1 : -1)
  const cx = (source.x + target.x) / 2 - (dy / length) * bend
  const cy = (source.y + target.y) / 2 + (dx / length) * bend
  return `M ${source.x.toFixed(1)} ${source.y.toFixed(1)} Q ${cx.toFixed(1)} ${cy.toFixed(1)} ${target.x.toFixed(1)} ${target.y.toFixed(1)}`
}

export function MemoryPage({ notify, query, registerPrimaryAction, requestConfirm }) {
  const [data, setData] = useState({ spaces: [], nodes: [], links: [], selectedSpaceId: '' })
  const [spaceId, setSpaceId] = useState('')
  const [selectedId, setSelectedId] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [zoom, setZoom] = useState(1)
  const [nodeModal, setNodeModal] = useState(null)
  const [spaceModal, setSpaceModal] = useState(null)
  const [hoveredId, setHoveredId] = useState('')
  const stageRef = useRef(null)
  const parallaxFrame = useRef(0)
  usePagePrimaryAction(registerPrimaryAction, () => setNodeModal({ spaceId: spaceId || data.selectedSpaceId }))

  // 鼠标视差：星辰与连线按深度分层缓动跟随，rAF 节流避免高频写入
  const handleParallax = (event) => {
    const stage = stageRef.current
    if (!stage) return
    const rect = stage.getBoundingClientRect()
    const px = ((event.clientX - rect.left) / rect.width - 0.5) * 2
    const py = ((event.clientY - rect.top) / rect.height - 0.5) * 2
    cancelAnimationFrame(parallaxFrame.current)
    parallaxFrame.current = requestAnimationFrame(() => {
      stage.style.setProperty('--px', px.toFixed(3))
      stage.style.setProperty('--py', py.toFixed(3))
    })
  }
  const resetParallax = () => {
    cancelAnimationFrame(parallaxFrame.current)
    stageRef.current?.style.setProperty('--px', '0')
    stageRef.current?.style.setProperty('--py', '0')
  }

  const load = useCallback(async (requestedSpaceId = '') => {
    setLoading(true)
    setError('')
    try {
      const params = new URLSearchParams()
      if (requestedSpaceId) params.set('spaceId', requestedSpaceId)
      if (query.trim()) params.set('query', query.trim())
      const result = await apiJson(`/api/memory?${params}`)
      setData(result)
      setSpaceId(result.selectedSpaceId || '')
      setSelectedId((current) => result.nodes.some((node) => node.id === current) ? current : (result.nodes[0]?.id || ''))
    } catch (loadError) {
      setError(loadError.message)
    } finally {
      setLoading(false)
    }
  }, [query])

  useEffect(() => { load(spaceId) }, [load, spaceId])

  const selected = data.nodes.find((node) => node.id === selectedId) || null
  const stars = useMemo(() => galaxyLayout(data.nodes, spaceId), [data.nodes, spaceId])
  const starById = useMemo(() => new Map(stars.map((star) => [star.node.id, star])), [stars])
  const visibleLinks = useMemo(() => {
    const visibleIds = new Set(stars.map((star) => star.node.id))
    return data.links.filter((link) => visibleIds.has(link.sourceId) && visibleIds.has(link.targetId))
  }, [stars, data.links])
  const relatedNodeIds = new Set(data.links.flatMap((link) => {
    if (link.sourceId === selectedId) return [link.targetId]
    if (link.targetId === selectedId) return [link.sourceId]
    return []
  }))
  // 聚焦模式：悬停优先于选中，聚焦星的关系网保持明亮，其余星辰淡出
  const focusId = hoveredId || selectedId
  const focusRelatedIds = new Set(data.links.flatMap((link) => {
    if (link.sourceId === focusId) return [link.targetId]
    if (link.targetId === focusId) return [link.sourceId]
    return []
  }))
  const relatedFiles = data.nodes.filter((node) => node.type === 'file' && (relatedNodeIds.has(node.id) || node.id === selectedId))
  const selectedSpace = data.spaces.find((space) => space.id === spaceId)

  const deleteNode = async (node) => {
    const approved = await requestConfirm({ title: '删除星辰', message: `确定删除星辰“${node.title}”吗？`, confirmLabel: '删除' })
    if (!approved) return
    try {
      await apiJson(`/api/memory/nodes/${encodeURIComponent(node.id)}`, { method: 'DELETE' })
      notify('星辰已删除')
      await load(spaceId)
    } catch (deleteError) { setError(deleteError.message) }
  }

  const deleteSpace = async () => {
    if (!selectedSpace) return
    const approved = await requestConfirm({ title: '删除星域', message: `确定删除星域“${spaceLabel(selectedSpace)}”及其全部星辰吗？`, confirmLabel: '删除' })
    if (!approved) return
    try {
      await apiJson(`/api/memory/spaces/${encodeURIComponent(selectedSpace.id)}`, { method: 'DELETE' })
      setSpaceId('')
      setSelectedId('')
      notify('星域已删除')
    } catch (deleteError) { setError(deleteError.message) }
  }

  return (
    <div className="memory-layout">
      <div className="memory-left-stack">
        <Panel className="wiki-panel">
          <div className="card-head"><SectionTitle title="星域" /><button className="icon-button" title="新建星域" onClick={() => setSpaceModal({})}><Plus size={13} /></button></div>
          {data.spaces.map((space) => <button className={space.id === spaceId ? 'active' : ''} onClick={() => { setSpaceId(space.id); setSelectedId('') }} key={space.id}><span>{spaceLabel(space)}</span><small>{space.nodeCount} 星辰</small><ChevronRight size={13} /></button>)}
          {selectedSpace && <div className="memory-space-actions"><button onClick={() => setSpaceModal(selectedSpace)}><Pencil size={12} />重命名</button>{selectedSpace.kind !== 'global' && <button className="danger" onClick={deleteSpace}><Trash2 size={12} />删除</button>}</div>}
        </Panel>
        <Panel className="memory-legend-panel">
          <SectionTitle title="星图类型" />
          <div className="galaxy-legend">{Object.entries(TYPE_LABELS).map(([type, label]) => <span key={type}><i className={`g-dot g-${type}`} />{label}</span>)}</div>
        </Panel>
      </div>
      <Panel className="graph-panel galaxy-panel" onPointerMove={handleParallax} onPointerLeave={resetParallax}>
        <div className="graph-toolbar">
          <button title="点亮星辰" onClick={() => setNodeModal({ spaceId })}><Plus size={14} /></button>
          <button title="放大" onClick={() => setZoom((value) => Math.min(1.6, Number((value + 0.15).toFixed(2))))}><ZoomIn size={13} /></button>
          <button title="缩小" onClick={() => setZoom((value) => Math.max(0.7, Number((value - 0.15).toFixed(2))))}><ZoomOut size={13} /></button>
          <button title="刷新" onClick={() => load(spaceId)}><RefreshCw className={loading ? 'spin' : ''} size={13} /></button>
        </div>
        <div className={`galaxy-stage ${focusId ? 'has-focus' : ''}`} ref={stageRef} style={{ transform: `scale(${zoom})` }}>
          <i className="galaxy-spiral" aria-hidden="true" />
          <i className="galaxy-core" aria-hidden="true" />
          <i className="galaxy-aurora galaxy-aurora-one" aria-hidden="true" />
          <i className="galaxy-aurora galaxy-aurora-two" aria-hidden="true" />
          <i className="galaxy-aurora galaxy-aurora-three" aria-hidden="true" />
          <svg viewBox="0 0 600 420" preserveAspectRatio="none" aria-hidden="true">
            <g className="galaxy-orbits">
              <ellipse cx="300" cy="206" rx="205" ry="122" transform="rotate(-8 300 206)" />
              <ellipse cx="300" cy="206" rx="154" ry="88" transform="rotate(18 300 206)" />
              <ellipse cx="300" cy="206" rx="95" ry="54" transform="rotate(-24 300 206)" />
            </g>
            <defs>
              {visibleLinks.map((link, index) => {
                const source = starById.get(link.sourceId)
                const target = starById.get(link.targetId)
                if (!source || !target) return null
                return <linearGradient id={`lg-${index}`} gradientUnits="userSpaceOnUse" x1={source.x} y1={source.y} x2={target.x} y2={target.y} key={link.id}>
                  <stop offset="0" stopColor={STAR_COLORS[source.node.type] || '#93b4ff'} />
                  <stop offset="1" stopColor={STAR_COLORS[target.node.type] || '#93b4ff'} />
                </linearGradient>
              })}
            </defs>
            {visibleLinks.map((link, index) => {
              const source = starById.get(link.sourceId)
              const target = starById.get(link.targetId)
              if (!source || !target) return null
              const active = link.sourceId === focusId || link.targetId === focusId
              const path = linkCurve(source, target, hashSeed(link.id))
              return <g key={link.id}>
                <path className={`link-path ${active ? 'active' : ''}`} d={path} stroke={`url(#lg-${index})`} />
                {active && <circle className="link-pulse" r="2.1"><animateMotion dur="2.8s" repeatCount="indefinite" path={path} /></circle>}
              </g>
            })}
          </svg>
          <i className="galaxy-meteor" aria-hidden="true" />
          <i className="galaxy-meteor meteor-two" aria-hidden="true" />
          <i className="galaxy-meteor meteor-three" aria-hidden="true" />
          {stars.map(({ node, x, y, twinkle }, index) => <button
            className={`galaxy-star star-${node.type} ${selectedId === node.id ? 'active' : ''} ${focusId && node.id !== focusId && !focusRelatedIds.has(node.id) ? 'dimmed' : ''}`}
            onClick={() => setSelectedId(node.id)}
            onMouseEnter={() => setHoveredId(node.id)}
            onMouseLeave={() => setHoveredId('')}
            style={{
              left: `${(x / GALAXY_VIEW.width) * 100}%`,
              top: `${(y / GALAXY_VIEW.height) * 100}%`,
              '--star-size': `${10 + Math.round((node.importance || 0.5) * 9)}px`,
              '--twinkle-delay': `${twinkle}s`,
              '--enter-delay': `${index * 55}ms`,
              '--depth': (hashSeed(node.id) % 100) / 100,
            }}
            title={node.content}
            key={node.id}
          >
            {selectedId === node.id && <i className="orbit-ring" aria-hidden="true" />}
            {selectedId === node.id && <i className="dash-ring" aria-hidden="true" />}
            <svg className="star-core" viewBox="0 0 32 32" aria-hidden="true">
              <path className="star-ray" d="M16 0 L19.7 12.3 L32 16 L19.7 19.7 L16 32 L12.3 19.7 L0 16 L12.3 12.3 Z" />
              <path className="star-shape" d="M16 2 L18.8 13.2 L30 16 L18.8 18.8 L16 30 L13.2 18.8 L2 16 L13.2 13.2 Z" />
              <circle className="star-heart" cx="16" cy="16" r="3.2" />
            </svg>
            <span className="star-label">{node.title}</span>
          </button>)}
        </div>
        {!!stars.length && <span className="galaxy-count">✦ {stars.length}/{data.nodes.length} 星辰</span>}
        {!loading && !stars.length && <div className="memory-empty"><StarOrbit size={44} /><span>这片星系还空着，点击左上角 + 种下第一颗星</span></div>}
      </Panel>
      <div className="detail-stack">
        <Panel>
          <SectionTitle title="选中星辰" />
          {selected ? <>
            <h2>{selected.title}</h2>
            <p className="muted-copy">{selected.content}</p>
            <div className="key-value"><span>星辰类型</span><strong className="type-with-dot"><i className={`g-dot g-${selected.type}`} />{TYPE_LABELS[selected.type] || selected.type}</strong></div>
            <div className="key-value"><span>来源</span><strong>{selected.sourceType === 'conversation' ? '对话自动沉淀' : selected.sourceType === 'agent' ? 'Agent 点亮' : '手动添加'}</strong></div>
            <div className="key-value"><span>创建时间</span><strong>{formatMemoryTime(selected.createdAt)}</strong></div>
            <div className="key-value"><span>关联星辰</span><strong>{relatedNodeIds.size} 颗</strong></div>
            <div className="button-row"><button className="button primary" onClick={() => setNodeModal(selected)}><Pencil size={14} />编辑</button><button className="button danger" onClick={() => deleteNode(selected)}><Trash2 size={14} />删除</button></div>
          </> : <p className="muted-copy">从星图中选择一颗星辰查看详细内容。</p>}
          {error && <div className="config-error">{error}</div>}
        </Panel>
        <Panel>
          <SectionTitle title="关联文件" />
          {relatedFiles.map((file) => <div className="file-row" key={file.id}><FileCode2 size={15} /><span><strong>{file.title}</strong><small>{file.sourcePath || file.cwd || '本地星忆'}</small></span><button onClick={() => setSelectedId(file.id)}>查看</button><button onClick={() => setNodeModal(file)}><Pencil size={13} /></button><button className="danger" onClick={() => deleteNode(file)}><Trash2 size={13} /></button></div>)}
          {!relatedFiles.length && <p className="muted-copy">当前星辰没有关联文件。</p>}
        </Panel>
      </div>
      {nodeModal && <MemoryNodeModal spaces={data.spaces} node={nodeModal.id ? nodeModal : null} initialSpaceId={nodeModal.spaceId || spaceId} onClose={() => setNodeModal(null)} onSaved={async (message) => { setNodeModal(null); notify(message); await load(spaceId) }} />}
      {spaceModal && <MemorySpaceModal space={spaceModal.id ? spaceModal : null} onClose={() => setSpaceModal(null)} onSaved={async (space, message) => { setSpaceModal(null); setSpaceId(space.id); notify(message) }} />}
    </div>
  )
}

function MemoryNodeModal({ spaces, node, initialSpaceId, onClose, onSaved }) {
  const [draft, setDraft] = useState({
    spaceId: node?.spaceId || initialSpaceId || spaces[0]?.id || '',
    title: node?.title || '', content: node?.content || '', type: node?.type || 'concept',
    sourcePath: node?.sourcePath || '', importance: node?.importance ?? 0.5,
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const submit = async (event) => {
    event.preventDefault()
    setSaving(true)
    setError('')
    try {
      await apiJson(node ? `/api/memory/nodes/${encodeURIComponent(node.id)}` : '/api/memory/nodes', {
        method: node ? 'PATCH' : 'POST', body: JSON.stringify(draft),
      })
      await onSaved(node ? '星辰已更新' : '星辰已点亮')
    } catch (saveError) { setError(saveError.message) } finally { setSaving(false) }
  }
  return <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><form className="modal" onSubmit={submit}><div className="card-head"><div><h2>{node ? '编辑星辰' : '点亮星辰'}</h2><p>保存可在后续会话中重新找到和复用的星忆。</p></div><button type="button" className="icon-button" onClick={onClose}><X size={17} /></button></div><label className="field-label">所属星域<span className="select-wrap"><select value={draft.spaceId} onChange={(event) => setDraft({ ...draft, spaceId: event.target.value })}>{spaces.map((space) => <option value={space.id} key={space.id}>{spaceLabel(space)}</option>)}</select><ChevronDown size={13} /></span></label><label className="field-label">星辰名称<input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} placeholder="例如：项目 UI 约束" /></label><label className="field-label">星忆内容<textarea value={draft.content} onChange={(event) => setDraft({ ...draft, content: event.target.value })} placeholder="记录独立可理解、未来可复用的星忆" /></label><div className="form-grid"><label className="field-label">星辰类型<span className="select-wrap"><select value={draft.type} onChange={(event) => setDraft({ ...draft, type: event.target.value })}>{Object.entries(TYPE_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select><ChevronDown size={13} /></span></label><label className="field-label">重要度<span className="select-wrap"><select value={draft.importance} onChange={(event) => setDraft({ ...draft, importance: Number(event.target.value) })}><option value="0.3">一般</option><option value="0.5">常用</option><option value="0.8">重要</option><option value="1">强约束</option></select><ChevronDown size={13} /></span></label></div><label className="field-label">关联文件路径<input value={draft.sourcePath} onChange={(event) => setDraft({ ...draft, sourcePath: event.target.value })} placeholder="可选，例如 E:\\code\\project\\README.md" /></label>{error && <div className="config-error">{error}</div>}<div className="modal-actions"><button type="button" className="button secondary" onClick={onClose}>取消</button><button className="button primary" disabled={saving || !draft.spaceId || !draft.title.trim() || !draft.content.trim()}>{saving ? <RefreshCw className="spin" size={14} /> : <Pencil size={14} />}{saving ? '保存中…' : '保存'}</button></div></form></div>
}

function MemorySpaceModal({ space, onClose, onSaved }) {
  const [name, setName] = useState(space?.name || '')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const submit = async (event) => {
    event.preventDefault()
    setSaving(true)
    setError('')
    try {
      const result = await apiJson(space ? `/api/memory/spaces/${encodeURIComponent(space.id)}` : '/api/memory/spaces', {
        method: space ? 'PATCH' : 'POST', body: JSON.stringify({ name, kind: 'custom' }),
      })
      await onSaved(result, space ? '星域已重命名' : '星域已创建')
    } catch (saveError) { setError(saveError.message) } finally { setSaving(false) }
  }
  return <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><form className="modal" onSubmit={submit}><div className="card-head"><div><h2>{space ? '重命名星域' : '新建星域'}</h2><p>用于安放不同主题或项目的长期星忆。</p></div><button type="button" className="icon-button" onClick={onClose}><X size={17} /></button></div><label className="field-label">星域名称<input value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：产品设计规范" autoFocus /></label>{error && <div className="config-error">{error}</div>}<div className="modal-actions"><button type="button" className="button secondary" onClick={onClose}>取消</button><button className="button primary" disabled={saving || !name.trim()}>{saving ? <RefreshCw className="spin" size={14} /> : <Plus size={14} />}{saving ? '保存中…' : '保存'}</button></div></form></div>
}
