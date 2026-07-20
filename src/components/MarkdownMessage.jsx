import { Children, isValidElement, useState } from 'react'
import { Check, Copy } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import rehypeHighlight from 'rehype-highlight'
import remarkGfm from 'remark-gfm'
import { useI18n } from '../app/use-i18n.js'

function textContent(value) {
  if (typeof value === 'string' || typeof value === 'number') return String(value)
  if (Array.isArray(value)) return value.map(textContent).join('')
  if (isValidElement(value)) return textContent(value.props.children)
  return ''
}

function languageName(className) {
  const match = String(className || '').match(/language-([\w-]+)/)
  return match?.[1] || 'text'
}

function copyText(value) {
  if (navigator.clipboard?.writeText) return navigator.clipboard.writeText(value)
  const textarea = document.createElement('textarea')
  textarea.value = value
  textarea.setAttribute('readonly', '')
  textarea.style.position = 'fixed'
  textarea.style.opacity = '0'
  document.body.append(textarea)
  textarea.select()
  document.execCommand('copy')
  textarea.remove()
  return Promise.resolve()
}

function CodeBlock({ children }) {
  const { t } = useI18n()
  const [copied, setCopied] = useState(false)
  const codeNode = Children.toArray(children).find(isValidElement)
  const className = codeNode?.props.className || ''
  const source = textContent(codeNode?.props.children || children).replace(/\n$/, '')

  const copy = async () => {
    try {
      await copyText(source)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1800)
    } catch {
      setCopied(false)
    }
  }

  return <div className="code-block">
    <div className="code-block-toolbar"><span>{languageName(className)}</span><button type="button" onClick={copy} aria-label={t('复制代码')} title={t('复制代码')}>{copied ? <Check size={13} /> : <Copy size={13} />}{t(copied ? '已复制' : '复制')}</button></div>
    <pre><code className={className}>{codeNode?.props.children || children}</code></pre>
  </div>
}

export default function MarkdownMessage({ children }) {
  return <div className="markdown-body"><ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[[rehypeHighlight, { detect: true }]]} components={{
    a: ({ children: label, node: _node, ...props }) => <a {...props} target="_blank" rel="noreferrer">{label}</a>,
    pre: ({ children: codeChildren }) => <CodeBlock>{codeChildren}</CodeBlock>,
    code: ({ children: code, className, node: _node, ...props }) => <code className={className || ''} {...props}>{code}</code>,
  }}>{children}</ReactMarkdown></div>
}
