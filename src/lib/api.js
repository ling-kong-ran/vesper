export async function apiJson(path, options) {
  const response = await fetch(path, {
    headers: { 'Content-Type': 'application/json', ...(options?.headers || {}) },
    ...options,
  })
  const data = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(data.error || `请求失败 (${response.status})`)
  return data
}

export async function consumeEventStream(response, onEvent) {
  if (!response.ok) {
    const data = await response.json().catch(() => ({}))
    throw new Error(data.error || `请求失败 (${response.status})`)
  }
  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  while (true) {
    const { value, done } = await reader.read()
    buffer += decoder.decode(value || new Uint8Array(), { stream: !done })
    const records = buffer.split('\n\n')
    buffer = records.pop() || ''
    for (const record of records) {
      let event = 'message'
      let data = null
      for (const line of record.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim()
        if (line.startsWith('data:')) data = JSON.parse(line.slice(5).trim())
      }
      if (data) onEvent(event, data)
    }
    if (done) break
  }
}
