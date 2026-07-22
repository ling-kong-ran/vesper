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
      '你是 Agent 长期记忆提取器。只提取未来对话确实有用、可复用且相对稳定的信息。',
      '允许：用户长期偏好、明确约束、项目架构与技术决策、已完成的重要改动、反复出现的风险。',
      '禁止：临时问题、寒暄、推测、完整对话复述、API Key、密码、令牌或其他秘密。',
      '只输出 JSON 数组，最多 3 项；没有值得记忆的信息时输出 []。',
      '为每项提供稳定的 topic，用于识别同一主题的新旧事实，例如 project.brand_colors、user.response_style；同一主题发生变化时必须复用原 topic。',
      '新事实取代旧事实时，在 content 中明确写出当前有效结论，避免同时保留互相冲突的表述。',
      '每项格式：{"title":"简短标题","content":"独立可理解的当前事实","topic":"稳定的主题键","type":"preference|decision|fact|risk|task","scope":"global|project","importance":0.1到1}',
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
