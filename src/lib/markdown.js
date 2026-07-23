import remend from 'remend'

export function prepareMarkdown(value, streaming = false) {
  const source = String(value || '')
  if (!streaming) return source
  return remend(source, { linkMode: 'text-only' })
}
