import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, Download, ExternalLink, Eye, File, FileImage, FileVideo, Link2, Paperclip, Plus, RefreshCw, Trash2, X } from 'lucide-react'
import { STORAGE_KEYS } from '../../app/storage.js'
import { useI18n } from '../../app/use-i18n.js'
import { Panel, Segmented } from '../../components/ui.jsx'
import { StarOrbit } from '../../components/StarOrbit.jsx'
import { usePagePrimaryAction } from '../../hooks/usePagePrimaryAction.js'
import { apiJson } from '../../lib/api.js'
import { formatFileSize } from '../../lib/format.js'

const TEXT_PREVIEW_EXTENSIONS = new Set(['txt', 'md', 'json', 'js', 'jsx', 'ts', 'tsx', 'css', 'html', 'xml', 'yaml', 'yml', 'csv', 'log', 'py', 'java', 'go', 'rs', 'sh', 'ps1', 'toml', 'sql'])
const ASSET_TABS = [
  ['all', '全部'], ['image', '图片'], ['file', '文件'], ['link', '链接'], ['current', '来自当前会话'],
]

function fileExtension(name) {
  return String(name || '').split('.').at(-1)?.toLowerCase() || ''
}

export function AssetsPage({ query, notify, registerPrimaryAction, onUse, requestConfirm }) {
  const { t } = useI18n()
  const [tab, setTab] = useState('all')
  const [assets, setAssets] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [preview, setPreview] = useState(null)
  const [linkModal, setLinkModal] = useState(false)
  usePagePrimaryAction(registerPrimaryAction, () => setLinkModal(true))

  const loadAssets = useCallback(async () => {
    setLoading(true)
    setError('')
    try {
      const params = new URLSearchParams()
      if (query) params.set('query', query)
      if (tab === 'image') params.set('kind', 'image')
      if (tab === 'file') params.set('kind', 'file')
      if (tab === 'link') params.set('kind', 'link')
      if (tab === 'current') params.set('sessionId', localStorage.getItem(STORAGE_KEYS.activeSession) || '__none__')
      const data = await apiJson(`/api/assets?${params}`)
      setAssets(data.assets)
    } catch (caught) {
      setError(caught.message)
    } finally {
      setLoading(false)
    }
  }, [query, tab])

  useEffect(() => { loadAssets() }, [loadAssets])

  const deleteAsset = async (asset) => {
    const approved = await requestConfirm({ title: t('删除资产'), message: t('确定删除资产「{name}」吗？', { name: asset.name }), confirmLabel: t('删除') })
    if (!approved) return
    try {
      await apiJson(`/api/assets/${encodeURIComponent(asset.id)}`, { method: 'DELETE' })
      setAssets((current) => current.filter((item) => item.id !== asset.id))
      notify(t('资产已删除'))
    } catch (caught) { setError(caught.message) }
  }

  const attachAsset = async (asset) => {
    try {
      const content = await apiJson(`/api/assets/${encodeURIComponent(asset.id)}/content`)
      onUse(content)
      notify(t('{name} 已加入对话', { name: asset.name }))
    } catch (caught) { setError(caught.message) }
  }

  const previewAsset = async (asset) => {
    let text = ''
    if (asset.kind === 'link') text = asset.url
    else if (asset.mimeType?.startsWith('text/') || TEXT_PREVIEW_EXTENSIONS.has(fileExtension(asset.name))) {
      const content = await apiJson(`/api/assets/${encodeURIComponent(asset.id)}/content`)
      text = content.text || ''
    }
    setPreview({ ...asset, text })
  }

  return <div className="asset-page">
    <div className="asset-toolbar"><Segmented options={ASSET_TABS.map(([, label]) => t(label))} value={t(ASSET_TABS.find(([id]) => id === tab)?.[1] || '全部')} onChange={(label) => setTab(ASSET_TABS.find(([, source]) => t(source) === label)?.[0] || 'all')} /></div>
    <div className="asset-summary"><span><strong>{assets.length}</strong> {t('个资产')}</span><span>{t('对话附件和 Agent 生成文件会自动归档')}</span></div>
    {error && <div className="config-error"><AlertTriangle size={13} />{error}</div>}
    {loading ? <Panel className="empty-state"><RefreshCw className="spin" size={23} /><h2>{t('正在加载资产')}</h2></Panel> : assets.length ? <div className="asset-grid functional">{assets.map((asset) => {
      const isVideo = asset.mimeType?.startsWith('video/')
      const Icon = asset.kind === 'image' ? FileImage : isVideo ? FileVideo : asset.kind === 'link' ? Link2 : File
      return <Panel className="asset-card functional" key={asset.id}><button className={`asset-preview ${asset.kind} ${isVideo ? 'video' : ''}`} onClick={() => previewAsset(asset)}>{asset.kind === 'image' ? <img src={`/api/assets/${encodeURIComponent(asset.id)}/download?inline=1`} alt="" /> : isVideo ? <video src={`/api/assets/${encodeURIComponent(asset.id)}/download?inline=1`} muted preload="metadata" /> : <Icon size={38} />}</button><div className="asset-card-copy"><strong title={asset.name}>{asset.name}</strong><span>{asset.kind === 'link' ? new URL(asset.url).hostname : formatFileSize(asset.size)} · {t(asset.source === 'agent' ? 'Agent 产物' : asset.source === 'attachment' ? '对话附件' : '手动上传')}</span>{asset.sessionName && <small title={asset.sessionName}>{t('来自：{name}', { name: asset.sessionName })}</small>}</div><div className="asset-card-actions"><button className="button tiny" onClick={() => previewAsset(asset)}><Eye size={13} />{t('预览')}</button>{asset.kind === 'link' ? <a className="button tiny" href={asset.url} target="_blank" rel="noreferrer"><ExternalLink size={13} />{t('打开')}</a> : <a className="button tiny" href={`/api/assets/${encodeURIComponent(asset.id)}/download`}><Download size={13} />{t('下载')}</a>}<button className="button tiny primary" onClick={() => attachAsset(asset)}><Paperclip size={13} />{t('用于对话')}</button><button className="icon-button danger" title={t('删除资产')} onClick={() => deleteAsset(asset)}><Trash2 size={13} /></button></div></Panel>
    })}</div> : <Panel className="empty-state"><StarOrbit size={46} /><h2>{t('暂无资产')}</h2><p>{t('添加链接，或在对话中使用附件后会自动出现在这里；Agent 生成文件也会自动登记。')}</p><button className="button primary" onClick={() => setLinkModal(true)}><Link2 size={14} />{t('添加链接')}</button></Panel>}
    {preview && <AssetPreviewModal asset={preview} onClose={() => setPreview(null)} onUse={() => attachAsset(preview)} />}
    {linkModal && <AssetLinkModal onClose={() => setLinkModal(false)} onCreated={() => { setLinkModal(false); loadAssets(); notify(t('链接资产已添加')) }} />}
  </div>
}

function AssetPreviewModal({ asset, onClose, onUse }) {
  const { t } = useI18n()
  const isVideo = asset.mimeType?.startsWith('video/')
  return <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><section className="modal asset-preview-modal"><div className="card-head"><div><h2>{asset.name}</h2><p>{asset.kind === 'link' ? asset.url : `${asset.mimeType} · ${formatFileSize(asset.size)}`}</p></div><button className="icon-button" aria-label={t('关闭对话框')} onClick={onClose}><X size={17} /></button></div><div className="asset-modal-content">{asset.kind === 'image' ? <img src={`/api/assets/${encodeURIComponent(asset.id)}/download?inline=1`} alt={asset.name} /> : isVideo ? <video controls src={`/api/assets/${encodeURIComponent(asset.id)}/download?inline=1`} /> : asset.kind === 'link' ? <a href={asset.url} target="_blank" rel="noreferrer"><ExternalLink size={16} />{asset.url}</a> : asset.text ? <pre>{asset.text}</pre> : <div className="asset-file-preview"><File size={42} /><strong>{asset.name}</strong><span>{t('此类型可下载，支持的文档也可以直接加入对话分析。')}</span></div>}</div><div className="modal-actions">{asset.kind !== 'link' && <a className="button secondary" href={`/api/assets/${encodeURIComponent(asset.id)}/download`}><Download size={14} />{t('下载')}</a>}<button className="button primary" onClick={onUse}><Paperclip size={14} />{t('用于对话')}</button></div></section></div>
}

function AssetLinkModal({ onClose, onCreated }) {
  const { t } = useI18n()
  const [name, setName] = useState('')
  const [url, setUrl] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const submit = async (event) => {
    event.preventDefault(); setSaving(true); setError('')
    try { await apiJson('/api/assets', { method: 'POST', body: JSON.stringify({ kind: 'link', name, url, source: 'upload' }) }); onCreated() }
    catch (caught) { setError(caught.message) } finally { setSaving(false) }
  }
  return <div className="modal-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}><form className="modal" onSubmit={submit}><div className="card-head"><div><h2>{t('添加链接资产')}</h2><p>{t('链接可以归档、打开，也可以作为上下文加入对话。')}</p></div><button type="button" className="icon-button" aria-label={t('关闭对话框')} onClick={onClose}><X size={17} /></button></div><label className="field-label">{t('名称')}<input value={name} onChange={(event) => setName(event.target.value)} placeholder={t('例如 OpenAI API 文档')} /></label><label className="field-label">URL<input value={url} onChange={(event) => setUrl(event.target.value)} placeholder="https://example.com/docs" /></label>{error && <div className="config-error"><AlertTriangle size={13} />{error}</div>}<div className="modal-actions"><button type="button" className="button secondary" onClick={onClose}>{t('取消')}</button><button className="button primary" disabled={saving || !url.trim()}>{saving ? <RefreshCw className="spin" size={14} /> : <Plus size={14} />}{t(saving ? '添加中…' : '添加链接')}</button></div></form></div>
}
