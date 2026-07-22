function textContent(content) {
  if (typeof content === 'string') return content
  return Array.isArray(content)
    ? content.filter((part) => part?.type === 'text').map((part) => part.text || '').join('')
    : ''
}

function parseJsonArray(value) {
  const text = String(value || '').trim().replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/i, '')
  const start = text.indexOf('[')
  const end = text.lastIndexOf(']')
  if (start < 0 || end <= start) return []
  try {
    const result = JSON.parse(text.slice(start, end + 1))
    return Array.isArray(result) ? result : []
  } catch {
    return []
  }
}

export function shouldExtractConversationMemory(user, assistant) {
  const value = `${user}\n${assistant}`
  if (value.length < 40) return false
  return /记住|以后|总是|不要|偏好|习惯|决定|约定|要求|工作目录|项目|架构|配置|实现|修复|新增|删除|迁移|原因|完成|提交|bug|provider|模型|工具|runtime/i.test(value)
}

export async function extractConversationMemories({ modelRuntime, model, user, assistant }) {
  if (!modelRuntime || !model || !shouldExtractConversationMemory(user, assistant)) return { memories: [], usage: null, timestamp: Date.now() }
  const result = await modelRuntime.completeSimple(model, {
    systemPrompt: [
      'You extract durable long-term memories for Vesper. Keep only information that is reusable, relatively stable, and genuinely useful in future conversations.',
      'Allowed: lasting user preferences, explicit constraints, project architecture and technical decisions, important completed changes, and recurring risks.',
      'Never store temporary questions, small talk, speculation, full conversation summaries, API keys, passwords, tokens, or other secrets.',
      'Output only a JSON array with at most 3 items. Output [] when there is nothing worth remembering.',
      'Give every item a stable topic key, such as project.brand_colors or user.response_style. Reuse the same topic when a newer fact supersedes an older fact.',
      'When a new fact replaces an old one, make content state only the currently valid conclusion so conflicting versions are not retained.',
      'Use the source conversation language for human-readable title and content fields.',
      'Item format: {"title":"short title","content":"self-contained current fact","topic":"stable topic key","type":"preference|decision|fact|risk|task","scope":"global|project","importance":0.1 to 1}',
    ].join('\n'),
    messages: [{
      role: 'user',
      content: `用户消息：\n${String(user || '').slice(0, 1600)}\n\nAgent 回复：\n${String(assistant || '').slice(0, 3200)}`,
      timestamp: Date.now(),
    }],
  }, {
    ...(model.reasoning ? { reasoning: 'low' } : { temperature: 0.1 }),
    maxTokens: 700,
  })
  if (result.errorMessage) return { memories: [], usage: result.usage, timestamp: result.timestamp }
  const memories = parseJsonArray(textContent(result.content)).slice(0, 3).flatMap((item) => {
    const title = String(item?.title || '').trim().slice(0, 140)
    const content = String(item?.content || '').trim().slice(0, 4000)
    if (!title || !content) return []
    return [{
      title,
      content,
      topic: String(item?.topic || '').trim().slice(0, 180),
      type: ['preference', 'decision', 'fact', 'risk', 'task'].includes(item.type) ? item.type : 'fact',
      scope: item.scope === 'global' ? 'global' : 'project',
      importance: Math.min(1, Math.max(0.1, Number(item.importance) || 0.5)),
    }]
  })
  return { memories, usage: result.usage, timestamp: result.timestamp }
}
