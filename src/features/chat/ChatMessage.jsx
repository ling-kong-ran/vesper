import { memo, useEffect, useState } from 'react'
import { Download, File, X } from 'lucide-react'
import { useI18n } from '../../app/use-i18n.js'
import { AgentStatusAvatar } from '../../components/AgentStatusAvatar.jsx'
import MarkdownMessage from '../../components/MarkdownMessage.jsx'
import AgentRunActivity from './AgentRunActivity.jsx'

function ImageLightbox({ attachment, source, onClose }) {
  const { t } = useI18n()
  useEffect(() => {
    const previousOverflow = document.body.style.overflow
    const onKeyDown = (event) => { if (event.key === 'Escape') onClose() }
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', onKeyDown)
    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [onClose])
  return <div className="image-lightbox" role="dialog" aria-modal="true" aria-label={t('图片大屏预览')} onMouseDown={(event) => event.target === event.currentTarget && onClose()}><div className="image-lightbox-toolbar"><span title={attachment.name}>{attachment.name || t('生成图片')}</span><div><a className="button secondary" href={attachment.downloadUrl || source} download={attachment.name || 'generated-image'}><Download size={14} />{t('下载原图')}</a><button type="button" className="icon-button" aria-label={t('关闭预览')} onClick={onClose}><X size={18} /></button></div></div><img src={source} alt={attachment.name || t('生成图片')} /></div>
}

export function MessageAttachments({ attachments, compact = false }) {
  const { t } = useI18n()
  const [preview, setPreview] = useState(null)
  return <><div className={`message-attachments ${compact ? 'compact' : ''}`}>{attachments.map((attachment, index) => {
    const key = attachment.id || index
    const source = attachment.url || (attachment.data ? `data:${attachment.mimeType};base64,${attachment.data}` : '')
    if (attachment.kind === 'image' && source) return <button type="button" className="generated-media" onClick={() => setPreview({ attachment, source })} title={t('点击大屏查看')} key={key}><img src={source} alt={attachment.name || t('图片附件')} /><small>{attachment.name || t('生成图片')}</small></button>
    if (attachment.kind === 'video' && source) return <div className="generated-media video" key={key}><video controls preload="metadata" src={source} /><small>{attachment.name || t('生成视频')}</small></div>
    return <a className="message-file-attachment" href={attachment.downloadUrl || undefined} key={key}><File size={12} />{attachment.name || t('文件附件')}</a>
  })}</div>{preview && <ImageLightbox attachment={preview.attachment} source={preview.source} onClose={() => setPreview(null)} />}</>
}

function focusPropsEqual(prev, next) {
  return prev.message === next.message
    && prev.agentState === next.agentState
    && prev.showRunActivity === next.showRunActivity
    && prev.runProps === next.runProps
}

export const FocusChatMessage = memo(function FocusChatMessage({ message, agentState, showRunActivity, runProps }) {
  return <div className={`message ${message.role} ${message.error ? 'has-error' : ''}`}>
    <span>{message.role === 'agent' ? <AgentStatusAvatar state={agentState} /> : 'You'}</span>
    <div className="message-content">
      {showRunActivity && runProps && <AgentRunActivity {...runProps} />}
      {(message.text || !message.streaming) && <MarkdownMessage streaming={message.streaming}>{message.text}</MarkdownMessage>}
      {message.attachments?.length > 0 && <MessageAttachments attachments={message.attachments} />}
    </div>
  </div>
}, focusPropsEqual)

function miniPropsEqual(prev, next) {
  return prev.message === next.message
}

export const MiniChatMessage = memo(function MiniChatMessage({ message }) {
  return <div className={`mini-message ${message.role}`}>
    <span>{message.role === 'agent' ? 'Vesper' : 'You'}</span>
    <div className="mini-message-content">
      {(message.text || !message.streaming) && <MarkdownMessage streaming={message.streaming}>{message.text}</MarkdownMessage>}
      {message.attachments?.length > 0 && <MessageAttachments attachments={message.attachments} compact />}
    </div>
  </div>
}, miniPropsEqual)

/** Stable empty run props for memoized messages that are not the active agent turn. */
export const EMPTY_RUN_PROPS = null
