import { useCallback, useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronRight, FileCode2, Pencil, Plus, RefreshCw, Trash2, X } from 'lucide-react'
import { Panel, SectionTitle } from '../../components/ui.jsx'
import { StarOrbit } from '../../components/StarOrbit.jsx'
import { apiJson } from '../../lib/api.js'
import { usePagePrimaryAction } from '../../hooks/usePagePrimaryAction.js'

const GRAPH_POINTS = [
  [300, 202], [138, 104], [465, 103], [150, 322], [470, 315], [300, 62], [65, 230], [540, 220],
]

const TYPE_LABELS = {
  concept: '概念', file: '文件', risk: '风险', preference: '偏好', decision: '决策', fact: '事实', task: '任务',
}

function graphNodes(nodes, selectedId) {
  const selected = nodes.find((node) => node.id === selectedId)
  const ordered = selected ? [selected, ...nodes.filter((node) => node.id !== selectedId)] : nodes
  return ordered.slice(0, GRAPH_POINTS.length)
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
  usePagePrimaryAction(registerPrimaryAction, () => setNodeModal({ spaceId: spaceId || data.selectedSpaceId }))

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
  const visibleNodes = useMemo(() => graphNodes(data.nodes, selectedId), [data.nodes, selectedId])
  const visibleIds = useMemo(() => new Set(visibleNodes.map((node) => node.id)), [visibleNodes])
  const visibleLinks = data.links.filter((link) => visibleIds.has(link.sourceId) && visibleIds.has(link.targetId))
  const relatedFileIds = new Set(data.links.flatMap((link) => {
    if (link.sourceId === selectedId) return [link.targetId]
    if (link.targetId === selectedId) return [link.sourceId]
    return []
  }))
  const relatedFiles = data.nodes.filter((node) => node.type === 'file' && (relatedFileIds.has(node.id) || node.id === selectedId))
  const selectedSpace = data.spaces.find((space) => space.id === spaceId)

  const deleteNode = async (node) => {
    const approved = await requestConfirm({ title: '删除记忆节点', message: `确定删除记忆“${node.title}”吗？`, confirmLabel: '删除' })
    if (!approved) return
    try {
      await apiJson(`/api/memory/nodes/${encodeURIComponent(node.id)}`, { method: 'DELETE' })
      notify('记忆节点已删除')
      await load(spaceId)
    } catch (deleteError) { setError(deleteError.message) }
  }

  const deleteSpace = async () => {
    if (!selectedSpace) return
    const approved = await requestConfirm({ title: '删除记忆空间', message: `确定删除记忆空间“${selectedSpace.name}”及其全部节点吗？`, confirmLabel: '删除' })
    if (!approved) return
    try {
      await apiJson(`/api/memory/spaces/${encodeURIComponent(selectedSpace.id)}`, { method: 'DELETE' })
      setSpaceId('')
      setSelectedId('')
      notify('记忆空间已删除')
    } catch (deleteError) { setError(deleteError.message) }
  }

  return (
    <div className="memory-layout">
      <Panel className="wiki-panel">
        <div className="card-head"><SectionTitle title="Wiki 空间" /><button className="icon-button" title="新建记忆空间" onClick={() => setSpaceModal({})}><Plus size={13} /></button></div>
        {data.spaces.map((space) => <button className={space.id === spaceId ? 'active' : ''} onClick={() => { setSpaceId(space.id); setSelectedId('') }} key={space.id}><span>{space.name}</span><small>{space.nodeCount} nodes</small><ChevronRight size={13} /></button>)}
        <div className="legend"><strong>图谱类型</strong><span><i className="dot blue" />概念节点</span><span><i className="dot green" />文件节点</span><span><i className="dot red" />风险节点</span></div>
        {selectedSpace && <div className="memory-space-actions"><button onClick={() => setSpaceModal(selectedSpace)}><Pencil size={12} />重命名</button>{selectedSpace.kind !== 'global' && <button className="danger" onClick={deleteSpace}><Trash2 size={12} />删除</button>}</div>}
      </Panel>
      <Panel className="graph-panel">
        <div className="graph-toolbar"><button title="新建节点" onClick={() => setNodeModal({ spaceId })}><Plus size={14} /></button><button title="缩小" onClick={() => setZoom((value) => Math.max(0.75, value - 0.1))}>−</button><button title="刷新" onClick={() => load(spaceId)}><RefreshCw className={loading ? 'spin' : ''} size={13} /></button></div>
        <svg viewBox="0 0 600 420" aria-hidden="true" style={{ transform: `scale(${zoom})` }}>
          {visibleLinks.map((link) => {
            const sourceIndex = visibleNodes.findIndex((node) => node.id === link.sourceId)
            const targetIndex = visibleNodes.findIndex((node) => node.id === link.targetId)
            if (sourceIndex < 0 || targetIndex < 0) return null
            const source = GRAPH_POINTS[sourceIndex]
            const target = GRAPH_POINTS[targetIndex]
            return <path d={`M${source[0]} ${source[1]} L${target[0]} ${target[1]}`} key={link.id} />
          })}
        </svg>
        {visibleNodes.map((node, index) => <button
          onClick={() => setSelectedId(node.id)}
          style={{ transform: `scale(${zoom})` }}
          className={`graph-node node-${index} memory-${node.type} ${selectedId === node.id ? 'active' : ''}`}
          title={node.content}
          key={node.id}
        >{node.title}</button>)}
        {!loading && !visibleNodes.length && <div className="memory-empty"><StarOrbit size={44} /><span>当前空间暂无记忆节点</span></div>}
      </Panel>
      <div className="detail-stack">
        <Panel>
          <SectionTitle title="选中节点" />
          {selected ? <>
            <h2>{selected.title}</h2>
            <p className="muted-copy">{selected.content}</p>
            <div className="key-value"><span>类型</span><strong>{TYPE_LABELS[selected.type] || selected.type}</strong></div>
            <div className="key-value"><span>来源</span><strong>{selected.sourceType === 'conversation' ? '对话自动记忆' : selected.sourceType === 'agent' ? 'Agent 写入' : '手动创建'}</strong></div>
            <div className="button-row"><button className="button primary" onClick={() => setNodeModal(selected)}><Pencil size={14} />编辑</button><button className="button danger" onClick={() => deleteNode(selected)}><Trash2 size={14} />删除</button></div>
          </> : <p className="muted-copy">从图谱中选择节点查看详细内容。</p>}
          {error && <div className="config-error">{error}</div>}
        </Panel>
        <Panel>
          <SectionTitle title="关联文件" />
          {relatedFiles.map((file) => <div className="file-row" key={file.id}><FileCode2 size={15} /><span><strong>{file.title}</strong><small>{file.sourcePath || file.cwd || '本地记忆'}</small></span><button onClick={() => setSelectedId(file.id)}>查看</button><button onClick={() => setNodeModal(file)}><Pencil size={13} /></button><button className="danger" onClick={() => deleteNode(file)}><Trash2 size={13} /></button></div>)}
          {!relatedFiles.length && <p className="muted-copy">当前节点没有关联文件。</p>}
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
      await onSaved(node ? '记忆节点已更新' : '记忆节点已创建')
    } catch (saveError) { setError(saveError.message) } finally { setSaving(false) }
  }
  return <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><form className="modal" onSubmit={submit}><div className="card-head"><div><h2>{node ? '编辑记忆节点' : '新建记忆节点'}</h2><p>保存可在后续会话中检索和复用的信息。</p></div><button type="button" className="icon-button" onClick={onClose}><X size={17} /></button></div><label className="field-label">记忆空间<span className="select-wrap"><select value={draft.spaceId} onChange={(event) => setDraft({ ...draft, spaceId: event.target.value })}>{spaces.map((space) => <option value={space.id} key={space.id}>{space.name}</option>)}</select><ChevronDown size={13} /></span></label><label className="field-label">标题<input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} placeholder="例如：项目 UI 约束" /></label><label className="field-label">内容<textarea value={draft.content} onChange={(event) => setDraft({ ...draft, content: event.target.value })} placeholder="记录独立可理解、未来可复用的信息" /></label><div className="form-grid"><label className="field-label">类型<span className="select-wrap"><select value={draft.type} onChange={(event) => setDraft({ ...draft, type: event.target.value })}>{Object.entries(TYPE_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select><ChevronDown size={13} /></span></label><label className="field-label">重要度<span className="select-wrap"><select value={draft.importance} onChange={(event) => setDraft({ ...draft, importance: Number(event.target.value) })}><option value="0.3">一般</option><option value="0.5">常用</option><option value="0.8">重要</option><option value="1">强约束</option></select><ChevronDown size={13} /></span></label></div><label className="field-label">关联文件路径<input value={draft.sourcePath} onChange={(event) => setDraft({ ...draft, sourcePath: event.target.value })} placeholder="可选，例如 E:\\code\\project\\README.md" /></label>{error && <div className="config-error">{error}</div>}<div className="modal-actions"><button type="button" className="button secondary" onClick={onClose}>取消</button><button className="button primary" disabled={saving || !draft.spaceId || !draft.title.trim() || !draft.content.trim()}>{saving ? <RefreshCw className="spin" size={14} /> : <Pencil size={14} />}{saving ? '保存中…' : '保存'}</button></div></form></div>
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
      await onSaved(result, space ? '记忆空间已重命名' : '记忆空间已创建')
    } catch (saveError) { setError(saveError.message) } finally { setSaving(false) }
  }
  return <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><form className="modal" onSubmit={submit}><div className="card-head"><div><h2>{space ? '重命名记忆空间' : '新建记忆空间'}</h2><p>用于隔离不同主题或项目的长期记忆。</p></div><button type="button" className="icon-button" onClick={onClose}><X size={17} /></button></div><label className="field-label">空间名称<input value={name} onChange={(event) => setName(event.target.value)} placeholder="例如：产品设计规范" autoFocus /></label>{error && <div className="config-error">{error}</div>}<div className="modal-actions"><button type="button" className="button secondary" onClick={onClose}>取消</button><button className="button primary" disabled={saving || !name.trim()}>{saving ? <RefreshCw className="spin" size={14} /> : <Plus size={14} />}{saving ? '保存中…' : '保存'}</button></div></form></div>
}
