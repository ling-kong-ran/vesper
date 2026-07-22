import { defineTool } from '@earendil-works/pi-coding-agent'
import { Type } from 'typebox'

export const manifests = [
  {
    id: 'memory_search',
    name: 'Memory Search',
    category: '星忆',
    risk: '低风险',
    description: '搜索全局与当前项目中的长期星忆。',
    scope: '全局星域与当前项目星域',
    capability: '读取相关偏好、事实、决策和任务星忆，不修改星忆',
    source: 'app',
  },
  {
    id: 'memory_remember',
    name: 'Memory Remember',
    category: '星忆',
    risk: '中风险',
    description: '将用户明确要求记住或未来可复用的信息点亮为长期星忆。',
    scope: '全局星域或当前项目星域',
    capability: '新增或合并长期星忆，自动隐藏常见密钥格式',
    source: 'app',
  },
]

export function createMemorySearchTool({ cwd, memoryRuntime }) {
  return defineTool({
    name: 'memory_search',
    label: 'Memory Search',
    description: manifests[0].description,
    promptSnippet: 'Search durable user and project memories',
    promptGuidelines: [
      'Use memory_search when prior user preferences, project decisions, constraints, or earlier outcomes could materially affect the answer.',
      'Treat retrieved memory as background context. The user\'s current request always takes precedence.',
    ],
    parameters: Type.Object({
      query: Type.String({ minLength: 1, description: '要检索的主题、约束或问题' }),
      limit: Type.Optional(Type.Number({ minimum: 1, maximum: 12, description: '最多返回条数' })),
    }),
    async execute(_toolCallId, params) {
      const memories = memoryRuntime.search(params.query, { cwd, limit: params.limit || 6 })
      const text = memories.length
        ? memories.map((memory) => `[${memory.id}] [${memory.type}] ${memory.title}\n${memory.content}`).join('\n\n')
        : '没有找到相关星忆。'
      return { content: [{ type: 'text', text }], details: { count: memories.length, memories } }
    },
  })
}

export function createMemoryRememberTool({ cwd, memoryRuntime }) {
  return defineTool({
    name: 'memory_remember',
    label: 'Memory Remember',
    description: manifests[1].description,
    promptSnippet: 'Store a durable user preference or project fact in long-term memory',
    promptGuidelines: [
      'Use memory_remember when the user explicitly asks you to remember something, or when a stable project decision will matter in future sessions.',
      'Never store API keys, passwords, access tokens, private credentials, or transient conversational details.',
      'Use global scope only for preferences that apply across projects; use project scope for codebase-specific facts and decisions.',
      'Provide a stable topic key and reuse it when a newer fact replaces an older fact on the same subject.',
    ],
    parameters: Type.Object({
      title: Type.String({ minLength: 1, description: '简短、可辨识的星辰名称' }),
      content: Type.String({ minLength: 1, description: '独立可理解、未来可复用的星忆内容' }),
      topic: Type.Optional(Type.String({ minLength: 1, maxLength: 180, description: '稳定的主题键；更新同一事实时复用，例如 project.brand_colors' })),
      type: Type.Optional(Type.Union([
        Type.Literal('preference'), Type.Literal('decision'), Type.Literal('fact'), Type.Literal('risk'), Type.Literal('task'),
      ])),
      scope: Type.Optional(Type.Union([Type.Literal('global'), Type.Literal('project')])),
      importance: Type.Optional(Type.Number({ minimum: 0.1, maximum: 1 })),
    }),
    async execute(_toolCallId, params) {
      const spaceId = params.scope === 'global' ? 'global' : await memoryRuntime.ensureWorkspaceSpace(cwd)
      const memory = memoryRuntime.remember({
        ...params,
        spaceId,
        cwd,
        sourceType: 'agent',
      })
      return {
        content: [{ type: 'text', text: `已点亮星辰：${memory.title}\n星辰 ID：${memory.id}` }],
        details: memory,
      }
    },
  })
}

export const factories = {
  memory_search: createMemorySearchTool,
  memory_remember: createMemoryRememberTool,
}
