import { defineTool } from '@earendil-works/pi-coding-agent'
import { Type } from 'typebox'
import { MAX_SUBAGENT_TIMEOUT_SECONDS, SUBAGENT_ROLE_NAMES } from '../../services/subagent-service.mjs'

export const manifest = {
  id: 'delegate_task',
  name: 'Subagent',
  category: '协作',
  risk: '中风险',
  description: '委派隔离上下文的子 Agent 执行调研、规划、审查或代码实现。',
  scope: '当前会话工作目录；独立内存会话；继承当前模型、角色允许的工具与权限模式',
  capability: '调研、规划和审查角色只读；worker 可继承父会话的工作区写入工具',
  source: 'app',
}

const roleSchema = Type.Union(SUBAGENT_ROLE_NAMES.map((role) => Type.Literal(role)), {
  description: '子 Agent 角色用于任务侧重点：scout 调研，planner 方案，reviewer 审查，worker 实现；只有 worker 可继承写入工具',
})

function formatResult(result) {
  const usage = result.usage?.totalTokens ? `\n\nUsage: ${result.usage.totalTokens} tokens` : ''
  const duration = Number.isFinite(result.durationMs) ? `\nDuration: ${(result.durationMs / 1000).toFixed(1)}s` : ''
  return `Subagent ${result.label || result.role} completed.${duration}${usage}\n\n${result.output}`
}

export function createSubagentTool({ runSubagent }) {
  return defineTool({
    name: manifest.id,
    label: manifest.name,
    description: manifest.description,
    promptSnippet: 'Delegate codebase research, planning, review, or bounded implementation to an isolated subagent',
    promptGuidelines: [
      'Use delegate_task when an isolated codebase investigation, implementation plan, independent review, or well-scoped implementation would improve the answer.',
      'Choose scout for evidence gathering, planner for a concrete implementation plan, reviewer for finding regressions or risks, and worker for code changes.',
      'Scout, planner, and reviewer receive read-only tools. Only worker may inherit enabled write tools from the parent session.',
      'Subagents cannot delegate recursively or read or update the parent Goal. Parent-session approvals and the workspace boundary continue to apply.',
      'timeoutSeconds is an inactivity timeout: model or tool activity resets it; it is not a total task duration limit.',
      'Give each subagent a focused, self-contained task and synthesize its result before replying to the user.',
    ],
    parameters: Type.Object({
      role: Type.Optional(roleSchema),
      task: Type.String({ minLength: 1, maxLength: 12_000, description: '完整、独立的委派任务；应说明目标、范围、约束和预期产出' }),
      timeoutSeconds: Type.Optional(Type.Integer({ minimum: 15, maximum: MAX_SUBAGENT_TIMEOUT_SECONDS, description: '连续无模型或工具活动的超时秒数；默认 180 秒' })),
    }),
    async execute(_toolCallId, params, signal, onUpdate) {
      if (typeof runSubagent !== 'function') throw new Error('子 Agent 运行时尚未初始化。')
      const result = await runSubagent({
        role: params.role || 'scout',
        task: params.task,
        timeoutSeconds: params.timeoutSeconds,
      }, {
        signal,
        onProgress: (progress) => onUpdate?.({
          content: [{ type: 'text', text: progress.message || `${progress.label || progress.role} is working` }],
          details: progress,
        }),
      })
      return {
        content: [{ type: 'text', text: formatResult(result) }],
        details: result,
      }
    },
  })
}

export const factories = { [manifest.id]: createSubagentTool }
