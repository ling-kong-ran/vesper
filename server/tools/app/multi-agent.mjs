import { DEFAULT_MAX_BYTES, defineTool } from '@earendil-works/pi-coding-agent'
import { Type } from 'typebox'
import {
  AGENT_ROLES,
  DEFAULT_AGENT_MAX_DURATION_SECONDS,
  DEFAULT_AGENT_MAX_TOOL_CALLS,
  MAX_AGENT_DEPENDENCIES,
  MAX_AGENT_MAX_DURATION_SECONDS,
  MAX_AGENT_MAX_TOOL_CALLS,
} from '../../services/multi-agent-service.mjs'

const category = '协作'
const source = 'app'

export const manifests = [
  { id: 'spawn_agent', name: 'Spawn Agent', category, risk: '中风险', description: '按角色启动独立 Agent，并支持依赖队列。', scope: '当前会话工作目录与权限边界', capability: '异步启动或排队 Agent，不阻塞主 Agent', source },
  { id: 'list_agents', name: 'List Agents', category, risk: '低风险', description: '查看当前会话的 Agent 图与运行状态。', scope: '当前会话', capability: '列出角色、依赖、状态、耗时、工具与结果', source },
  { id: 'send_message', name: 'Send Message', category, risk: '低风险', description: '向运行中的 Agent 发送补充信息。', scope: '当前会话的 Agent', capability: '发送消息但不主动启动新一轮任务', source },
  { id: 'followup_task', name: 'Follow-up Task', category, risk: '中风险', description: '让已有 Agent 继续执行后续任务。', scope: '当前会话的 Agent', capability: '复用 Agent 上下文继续工作', source },
  { id: 'wait_agent', name: 'Wait Agent', category, risk: '低风险', description: '等待 Agent 完成、失败或被中断。', scope: '当前会话', capability: '短暂等待终态结果，不承担总任务超时', source },
  { id: 'interrupt_agent', name: 'Interrupt Agent', category, risk: '中风险', description: '中断正在运行的 Agent。', scope: '当前会话的 Agent', capability: '停止 Agent 当前执行', source },
]

function text(value) {
  return { content: [{ type: 'text', text: value }] }
}

function requireRuntime(runtime, method) {
  if (typeof runtime?.[method] !== 'function') throw new Error('Multi-agent runtime is not available.')
  return runtime[method]
}

function utf8Prefix(value, maxBytes) {
  const buffer = Buffer.from(value, 'utf8')
  if (buffer.length <= maxBytes) return value
  let end = maxBytes
  while (end > 0 && (buffer[end] & 0xc0) === 0x80) end -= 1
  return buffer.subarray(0, end).toString('utf8')
}

function boundedToolText(value) {
  const textValue = String(value || '')
  if (Buffer.byteLength(textValue, 'utf8') <= DEFAULT_MAX_BYTES) return textValue
  const suffix = '\n\n[Agent summary truncated to the Pi tool-output limit.]'
  return `${utf8Prefix(textValue, DEFAULT_MAX_BYTES - Buffer.byteLength(suffix, 'utf8'))}${suffix}`
}

function compactAgent(agent) {
  const elapsed = Number.isFinite(agent.durationMs) ? `, ${(agent.durationMs / 1000).toFixed(1)}s` : ''
  const dependency = agent.status === 'queued' && agent.dependsOn?.length ? ` · waiting for ${agent.dependsOn.length}` : ''
  const output = agent.output ? `\n${agent.output}` : agent.error ? `\nError: ${agent.error}` : ''
  return `${agent.canonicalName} · ${agent.role || 'worker'} · ${agent.status}${dependency}${elapsed}${output}`
}

function compactAgents(agents) {
  return boundedToolText(agents.map(compactAgent).join('\n\n'))
}

function agentDetails(agent) {
  const { fullOutput: _fullOutput, ...details } = agent
  return details
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
      'Choose explorer or reviewer for read-only parallel investigation, tester for validation, and worker only for a clearly isolated implementation scope.',
      'Use dependsOn to express ordering between delegated tasks instead of polling or manually waiting; queued Agents start automatically when dependencies and concurrency slots are ready.',
      'Do not delegate the immediate critical-path step and then wait idly for it.',
      'Provide a self-contained message with every constraint and piece of context the Agent needs; Agents never inherit the parent transcript.',
      'Agents inherit the current model, current reasoning level, tools, permission mode, and workspace boundary. They cannot recursively spawn more Agents.',
      'A spawned Agent is a background task. Its running state must not delay replying to the user, handling later user instructions, or spawning other independent Agents.',
      'After spawning, do not call list_agents or wait_agent merely to monitor progress. Completed results are persisted and delivered through the parent mailbox on a later parent turn.',
      'Use wait_agent only when the user explicitly asks you to wait for a specific Agent result before replying.',
    ],
    parameters: Type.Object({
      taskName: Type.String({ minLength: 1, maxLength: 48, description: 'Stable short task name using letters, digits, hyphens, or underscores.' }),
      message: Type.String({ minLength: 1, maxLength: 12_000, description: 'Concrete, self-contained delegated task including all required context and constraints.' }),
      role: Type.Optional(Type.Union(AGENT_ROLES.map((role) => Type.Literal(role)), { description: 'Role-specific behavior and tool scope. Defaults to worker.' })),
      dependsOn: Type.Optional(Type.Array(Type.String({ minLength: 1 }), { maxItems: MAX_AGENT_DEPENDENCIES, description: 'Existing Agent ids, task names, or canonical names that must complete first.' })),
      maxDurationSeconds: Type.Optional(Type.Integer({ minimum: 15, maximum: MAX_AGENT_MAX_DURATION_SECONDS, description: `Hard total duration limit. Defaults to ${DEFAULT_AGENT_MAX_DURATION_SECONDS} seconds.` })),
      maxToolCalls: Type.Optional(Type.Integer({ minimum: 1, maximum: MAX_AGENT_MAX_TOOL_CALLS, description: `Maximum tool calls. Defaults to ${DEFAULT_AGENT_MAX_TOOL_CALLS}.` })),
    }),
    async execute(_toolCallId, params) {
      const agent = await requireRuntime(multiAgentRuntime, 'spawn')(params)
      const action = agent.status === 'queued' ? 'Queued' : 'Started'
      return { ...text(`${action} ${agent.canonicalName} as ${agent.role || 'worker'} in the background.`), details: agent }
    },
  })
}

function createListAgentsTool({ multiAgentRuntime }) {
  return defineTool({
    name: 'list_agents',
    label: 'List Agents',
    description: 'List Agents created by the current primary session, including live and completed states. Use only for an explicit status inspection, not periodic monitoring.',
    promptSnippet: 'Inspect Subagent status only when the user explicitly requests it',
    promptGuidelines: [
      'Do not call list_agents repeatedly to monitor background Agents.',
      'Running Agents do not block the parent from replying or starting other independent Agents.',
    ],
    parameters: Type.Object({}),
    async execute() {
      const agents = await requireRuntime(multiAgentRuntime, 'list')()
      const graph = typeof multiAgentRuntime?.graph === 'function' ? await multiAgentRuntime.graph() : null
      return { ...text(agents.length ? compactAgents(agents) : 'No Agents have been created in this session.'), details: { agents: agents.map(agentDetails), ...(graph ? { graph } : {}) } }
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
    description: 'Wait briefly for an Agent to reach a terminal state only when the user explicitly asks to wait. Never use this tool as a polling loop.',
    promptSnippet: 'Wait for a Subagent only when the user explicitly requires its result before the current reply',
    promptGuidelines: [
      'Do not use wait_agent merely because an Agent is running.',
      'Never call wait_agent repeatedly after a timeout to poll for completion.',
      'The parent should normally reply while Agents continue in the background; their completed results are delivered through the parent mailbox on a later turn.',
    ],
    parameters: Type.Object({
      target: Type.Optional(Type.String({ minLength: 1, description: 'Optional Agent id, task name, or canonical name. Without a target, returns when any currently active Agent finishes.' })),
      timeoutMs: Type.Optional(Type.Integer({ minimum: 250, maximum: 30_000, description: 'Maximum time to wait for completion. Defaults to 15000 ms.' })),
    }),
    async execute(_toolCallId, params) {
      const result = await requireRuntime(multiAgentRuntime, 'wait')(params.timeoutMs, params.target)
      const summary = result.agents.length ? compactAgents(result.agents) : 'No Agents have been created in this session.'
      return { ...text(result.timedOut ? `No Agent completed before timeout.\n\n${summary}` : summary), details: { ...result, agents: result.agents.map(agentDetails) } }
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

// Internal runtime tools: always available to the primary Agent, never shown in the plugins UI.
export function createMultiAgentTools(context = {}) {
  return manifests.map((manifest) => factories[manifest.id](context))
}
