import { defineTool } from '@earendil-works/pi-coding-agent'
import { Type } from 'typebox'
import { isExplicitMemoryRememberRequest } from '../tool-activation.mjs'

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
    description: '用户明确要求记住时直接写入长期星忆；否则将可复用信息静默加入候选待办，不打断当前任务。',
    scope: '全局星域或当前项目星域',
    capability: '明确要求直接入库，推断内容进入候选；自动隐藏常见密钥格式，且不阻塞当前会话',
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

function resolveUserRequested(params, getUserMessage) {
  if (params.userRequested === true) return true
  if (params.userRequested === false) return false
  const message = typeof getUserMessage === 'function' ? getUserMessage() : ''
  return isExplicitMemoryRememberRequest(message)
}

export function createMemoryRememberTool({ cwd, memoryRuntime, getUserMessage } = {}) {
  return defineTool({
    name: 'memory_remember',
    label: 'Memory Remember',
    description: manifests[1].description,
    promptSnippet: 'Store a durable user preference or project fact in long-term memory',
    promptGuidelines: [
      'Use memory_remember when the user explicitly asks you to remember something, or when a stable project decision will matter in future sessions.',
      'When the user explicitly asks to remember, save, or write something into memory, set userRequested=true so it is stored immediately without approval.',
      'When you are only capturing a reusable fact without an explicit remember request, omit userRequested or set it to false so it becomes a candidate draft.',
      'Never store API keys, passwords, access tokens, private credentials, or transient conversational details.',
      'Use global scope only for preferences that apply across projects; use project scope for codebase-specific facts and decisions.',
      'Provide a stable topic key and reuse it when a newer fact replaces an older fact on the same subject.',
      'Do not ask the user to stop, wait, or review candidates during the current response. Candidate review is non-blocking background work.',
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
      userRequested: Type.Optional(Type.Boolean({
        description: '用户是否明确要求记住。true 时直接写入长期星忆且无需审批；false 或省略时仅加入候选待办。',
      })),
    }),
    async execute(_toolCallId, params) {
      const spaceId = params.scope === 'global' ? 'global' : await memoryRuntime.ensureWorkspaceSpace(cwd)
      const userRequested = resolveUserRequested(params, getUserMessage)

      if (userRequested) {
        const memory = memoryRuntime.remember({
          ...params,
          spaceId,
          cwd,
          sourceType: 'user_confirmed',
          evidence: '用户明确要求记住，已直接写入长期星忆。',
          authority: 100,
        })
        // remember() may fall back to a pending candidate when a higher-authority conflict exists.
        if (memory?.status === 'pending') {
          return {
            content: [{ type: 'text', text: `候选记忆已在后台入列：${memory.title}\n候选 ID：${memory.id}\n原因：与更高可信度记忆冲突，需人工确认。继续完成当前任务。` }],
            details: { ...memory, mode: 'candidate', reason: 'authority_conflict' },
          }
        }
        return {
          content: [{ type: 'text', text: `已直接写入长期星忆：${memory.title}\n星忆 ID：${memory.id}` }],
          details: { ...memory, mode: 'stored' },
        }
      }

      const candidate = memoryRuntime.propose({
        ...params,
        spaceId,
        cwd,
        sourceType: 'agent',
        evidence: '由 Agent 在后台提议；候选处理不影响原会话任务。',
        confidence: 0.5,
      })
      return {
        content: [{ type: 'text', text: `候选记忆已在后台入列：${candidate.title}\n候选 ID：${candidate.id}\n继续完成当前任务；不要要求用户现在处理候选。` }],
        details: { ...candidate, mode: 'candidate' },
      }
    },
  })
}

export const factories = {
  memory_search: createMemorySearchTool,
  memory_remember: createMemoryRememberTool,
}
