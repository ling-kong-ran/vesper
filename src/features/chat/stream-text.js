/**
 * Split accumulated assistant text around tool calls for display.
 * - lead: frozen preamble captured when tools first start
 * - body: remaining/new text after that point (with repeated preamble stripped)
 */
export function splitAssistantStreamText(fullText, preamble, { streaming = false, hasTools = false } = {}) {
  const text = String(fullText || '')
  if (!streaming || !hasTools) {
    return { lead: '', body: text }
  }
  const frozen = String(preamble || '')
  if (!frozen) {
    return { lead: '', body: text }
  }
  if (!text) {
    return { lead: frozen, body: '' }
  }
  if (frozen.startsWith(text) && text.length < frozen.length) {
    // Typewriter still catching up inside the preamble.
    return { lead: text, body: '' }
  }
  if (text.startsWith(frozen)) {
    let body = text.slice(frozen.length).replace(/^\s+/, '')
    // Models often restate the preamble after tools; strip one repeated copy.
    if (body.startsWith(frozen)) body = body.slice(frozen.length).replace(/^\s+/, '')
    return { lead: frozen, body }
  }
  // Model rewrote earlier content; avoid a broken split.
  return { lead: '', body: text }
}
