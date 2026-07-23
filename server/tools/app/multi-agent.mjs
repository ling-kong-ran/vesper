import { defineTool } from '@earendil-works/pi-coding-agent'
import { Type } from 'typebox'
import {
  DEFAULT_AGENT_MAX_DURATION_SECONDS,
  DEFAULT_AGENT_MAX_TOOL_CALLS,
  MAX_AGENT_MAX_DURATION_SECONDS,
  MAX_AGENT_MAX_TOOL_CALLS,
} from '../../services/multi-agent-service.mjs'

const category = '协作'
const source = 'app'

export const manifests = [
  { id: 'spawn_agent', name: 'Spawn Agent', category, risk: '中风险', description: '启动独立 Agent 处理可并行的边界任务。', scope: '当前会话工作目录与权限边界', capability: '异步启动独立 Agent，不阻塞主 Agent', source },
  { id: 'list_agents', name: 'List Agents', category, risk: '低风险', description: '查看当前会话创建的 Agent 与运行状态。', scope: '当前会话', capability: '列出 Agent 状态、耗时、工具与结果', source },
  { id: 'send_message', name: 'Send Message', category, risk: '低风险', description: '向运行中的 Agent 发送补充信息。', scope: '当前会话的 Agent', capability: '发送消息但不主动启动新一轮任务', source },
  { id: 'followup_task', name: 'Follow-up Task', category, risk: '中风险', description: '让已有 Agent 继续执行后续任务。', scope: '当前会话的 Agent', capability: '复用 Agent 上下文继续工作', source },
  { id: 'wait_agent', name: 'Wait Agent', category, risk: '低风险', description: '等待 Agent 状态发生变化。', scope: '当前会话', capability: '短暂等待状态更新，不承担总任务超时', source },
  { id: 'interrupt_agent', name: 'Interrupt Agent', category, risk: '中风险', description: '中断正在运行的 Agent。', scope: '当前会话的 Agent', capability: '停止 Agent 当前执行', source },
]

function text(value) {
  return { content: [{ type: 'text', text: value }] }
}

function requireRuntime(runtime, method) {
  if (typeof runtime?.[method] !== 'function') throw new Error('Multi-agent runtime is not available.')
  return runtime[method]
}

function compactAgent(agent) {
  const elapsed = Number.isFinite(agent.durationMs) ? `, ${(agent.durationMs / 1000).toFixed(1)}s` : ''
  const output = agent.output ? `\n${agent.output}` : agent.error ? `\nError: ${agent.error}` : ''
  return `${agent.canonicalName} · ${agent.status}${elapsed}${output}`
}

function createSpawnAgentTool({ multiAgentRuntime }) {
  return defineTool({
    name: 'spawn_agent',
    label: 'Spawn Agent',
    description: 'Spawn an isolated Agent for a concrete, bounded subtask that can run independently while you continue useful local work.',
    promptSnippet: 'Spawn an asynchronous Agent for explicitly requested delegation or parallel work',
    promptGuidelines: [
      'Do not use spawn_agent unless the user explicitly asks for subagents, delegation, parallel agent work, or an applicable project instruction requires it.',
      'Use spawn_agent only for a concrete, bounded task that can run independently while you continue non-overlapping local work.',
      'Do not delegate the immediate critical-path step and then wait idly for it.',
      'Provide a self-contained message. Use forkTurns to control how much completed conversation history the Agent receives.',
      'Agents inherit the current model, current reasoning level, tools, permission mode, and workspace boundary. They cannot recursively spawn more Agents.',
      'Use wait_agent sparingly; prefer doing useful non-overlapping work before waiting.',
    ],
    parameters: Type.Object({
      taskName: Type.String({ minLength: 1, maxLength: 48, description: 'Stable short task name using letters, digits, hyphens, or underscores.' }),
      message: Type.String({ minLength: 1, maxLength: 12_000, description: 'Concrete, self-contained delegated task.' }),
      forkTurns: Type.Optional(Type.String({ description: 'Conversation context to inherit: none, all, or a positive integer count of recent turns. Defaults to all.' })),
      maxDurationSeconds: Type.Optional(Type.Integer({ minimum: 15, maximum: MAX_AGENT_MAX_DURATION_SECONDS, description: `Hard total duration limit. Defaults to ${DEFAULT_AGENT_MAX_DURATION_SECONDS} seconds.` })),
      maxToolCalls: Type.Optional(Type.Integer({ minimum: 1, maximum: MAX_AGENT_MAX_TOOL_CALLS, description: `Maximum tool calls. Defaults to ${DEFAULT_AGENT_MAX_TOOL_CALLS}.` })),
    }),
    async execute(_toolCallId, params) {
      const agent = await requireRuntime(multiAgentRuntime, 'spawn')(params)
      return { ...text(`Started ${agent.canonicalName} in the background.`), details: agent }
    },
  })
}

function createListAgentsTool({ multiAgentRuntime }) {
  return defineTool({
    name: 'list_agents',
    label: 'List Agents',
    description: 'List Agents created by the current primary session, including live and completed states.',
    parameters: Type.Object({}),
    async execute() {
      const agents = await requireRuntime(multiAgentRuntime, 'list')()
      return { ...text(agents.length ? agents.map(compactAgent).join('\n\n') : 'No Agents have been created in this session.'), details: { agents } }
    },
  })
}

function createSendMessageTool({ multiAgentRuntime }) {
  return defineTool({
    name: 'send_message',
    label: 'Send Message',
    description: 'Send information to an existing Agent without starting a separate new Agent.',
    parameters: Type.Object({
      target: Type.String({ minLength: 1, description: 'Agent id, task name, or canonical name returned by spawn_agent.' }),
      message: Type.String({ minLength: 1, maxLength: 12_000 }),
    }),
    async execute(_toolCallId, params) {
      const agent = await requireRuntime(multiAgentRuntime, 'sendMessage')(params.target, params.message)
      return { ...text(`Message queued for ${agent.canonicalName}.`), details: agent }
    },
  })
}

function createFollowupTaskTool({ multiAgentRuntime }) {
  return defineTool({
    name: 'followup_task',
    label: 'Follow-up Task',
    description: 'Give an existing Agent another task while preserving that Agent context.',
    parameters: Type.Object({
      target: Type.String({ minLength: 1, description: 'Agent id, task name, or canonical name returned by spawn_agent.' }),
      message: Type.String({ minLength: 1, maxLength: 12_000 }),
    }),
    async execute(_toolCallId, params) {
      const agent = await requireRuntime(multiAgentRuntime, 'followup')(params.target, params.message)
      return { ...text(`Follow-up queued for ${agent.canonicalName}.`), details: agent }
    },
  })
}

function createWaitAgentTool({ multiAgentRuntime }) {
  return defineTool({
    name: 'wait_agent',
    label: 'Wait Agent',
    description: 'Wait briefly for an Agent state update. This is not the Agent total-duration limit.',
    parameters: Type.Object({
      timeoutMs: Type.Optional(Type.Integer({ minimum: 250, maximum: 30_000, description: 'Maximum time to wait for the next update. Defaults to 15000 ms.' })),
    }),
    async execute(_toolCallId, params) {
      const result = await requireRuntime(multiAgentRuntime, 'wait')(params.timeoutMs)
      const summary = result.agents.length ? result.agents.map(compactAgent).join('\n\n') : 'No Agents have been created in this session.'
      return { ...text(result.timedOut ? `No Agent update before timeout.\n\n${summary}` : summary), details: result }
    },
  })
}

function createInterruptAgentTool({ multiAgentRuntime }) {
  return defineTool({
    name: 'interrupt_agent',
    label: 'Interrupt Agent',
    description: 'Interrupt an Agent current run while preserving its record for inspection or a later follow-up.',
    parameters: Type.Object({ target: Type.String({ minLength: 1, description: 'Agent id, task name, or canonical name.' }) }),
    async execute(_toolCallId, params) {
      const agent = await requireRuntime(multiAgentRuntime, 'interrupt')(params.target)
      return { ...text(`${agent.canonicalName} is ${agent.status}.`), details: agent }
    },
  })
}

export const factories = {
  spawn_agent: createSpawnAgentTool,
  list_agents: createListAgentsTool,
  send_message: createSendMessageTool,
  followup_task: createFollowupTaskTool,
  wait_agent: createWaitAgentTool,
  interrupt_agent: createInterruptAgentTool,
}
