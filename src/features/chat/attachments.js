import { useCallback, useRef, useState } from 'react'

const MAX_ATTACHMENT_BYTES = 10 * 1024 * 1024
const MAX_TOTAL_ATTACHMENT_BYTES = 20 * 1024 * 1024
const MAX_TEXT_CHARS = 200_000
const TEXT_EXTENSIONS = new Set(['txt', 'md', 'json', 'js', 'jsx', 'ts', 'tsx', 'css', 'html', 'xml', 'yaml', 'yml', 'csv', 'log', 'py', 'java', 'go', 'rs', 'sh', 'ps1', 'toml', 'sql'])
const DOCUMENT_EXTENSIONS = new Set(['pdf', 'docx', 'pptx', 'xlsx', 'odt', 'odp', 'ods', 'rtf', 'epub'])

function fileExtension(name) {
  return name.includes('.') ? name.split('.').pop().toLowerCase() : ''
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).split(',')[1] || '')
    reader.onerror = () => reject(reader.error || new Error('读取图片失败'))
    reader.readAsDataURL(file)
  })
}

async function prepareFiles(fileList) {
  const files = [...fileList].slice(0, 8)
  const attachments = []
  for (const file of files) {
    if (file.size > MAX_ATTACHMENT_BYTES) throw new Error(`${file.name} 超过 10 MB 限制`)
    if (file.type.startsWith('image/')) {
      attachments.push({ id: `${file.name}-${file.lastModified}-${file.size}`, kind: 'image', name: file.name, mimeType: file.type, size: file.size, data: await fileToBase64(file) })
      continue
    }
    const extension = fileExtension(file.name)
    if (file.type.startsWith('text/') || TEXT_EXTENSIONS.has(extension)) {
      const text = await file.text()
      attachments.push({ id: `${file.name}-${file.lastModified}-${file.size}`, kind: 'text', name: file.name, mimeType: file.type || 'text/plain', size: file.size, text: text.slice(0, MAX_TEXT_CHARS), truncated: text.length > MAX_TEXT_CHARS })
      continue
    }
    if (DOCUMENT_EXTENSIONS.has(extension)) {
      attachments.push({ id: `${file.name}-${file.lastModified}-${file.size}`, kind: 'document', name: file.name, mimeType: file.type || 'application/octet-stream', extension, size: file.size, data: await fileToBase64(file) })
      continue
    }
    throw new Error(`${file.name} 暂不支持；请选择图片或文本/代码文件`)
  }
  return attachments
}

export function useAttachmentSelection() {
  const [attachments, setAttachments] = useState([])
  const [attachmentError, setAttachmentError] = useState('')
  const inputRef = useRef(null)
  const chooseFiles = async (event) => {
    try {
      setAttachmentError('')
      const prepared = await prepareFiles(event.target.files || [])
      const combined = [...attachments, ...prepared].slice(0, 8)
      if (combined.reduce((total, item) => total + item.size, 0) > MAX_TOTAL_ATTACHMENT_BYTES) throw new Error('附件总大小不能超过 20 MB')
      setAttachments(combined)
    } catch (error) {
      setAttachmentError(error.message)
    } finally {
      event.target.value = ''
    }
  }
  const removeAttachment = (id) => setAttachments((current) => current.filter((item) => item.id !== id))
  const clearAttachments = () => setAttachments([])
  const addAttachments = useCallback((items) => {
    setAttachments((current) => {
      const next = [...current]
      for (const item of items) {
        if (!next.some((existing) => existing.id === item.id)) next.push(item)
      }
      return next.slice(0, 8)
    })
  }, [])
  return { attachments, attachmentError, inputRef, chooseFiles, removeAttachment, clearAttachments, addAttachments }
}
