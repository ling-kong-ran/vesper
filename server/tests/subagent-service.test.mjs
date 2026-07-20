import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { MAX_SUBAGENT_OUTPUT_BYTES, SubagentService } from '../services/subagent-service.mjs'
import { TOOL_CATALOG, createAppTools } from '../tools/registry.mjs'

function createFakeSession({ onPrompt } = {}) {
  const listeners = new Set()
  const session = {
    agent: { state: { systemPrompt: 'Base system prompt' } },
    messages: [],
    disposed: false,
    aborted: false,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    async prompt(task) {
      await onPrompt?.({ task, emit: (event) => listeners.forEach((listener) => listener(event)), session })
    },
    async abort() {
      session.aborted = true
    },
    dispose() {
      session.disposed = true
    },
  }
  return session
}

const createFakeResourceLoader = async ({ role, rolePrompt }) => ({ role, rolePrompt })

test('default Pi resource loader appends the role system prompt', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'vesper-subagent-loader-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  let appendedPrompt = ''
  const service = new SubagentService({
    agentDir: directory,
    createSessionManager: () => ({}),
    createSession: async (options) => {
      appendedPrompt = options.resourceLoader.getAppendSystemPrompt().at(-1) || ''
      return {
        session: createFakeSession({
          onPrompt: async ({ session }) => {
            session.messages.push({ role: 'assistant', content: [{ type: 'text', text: 'Inspected safely.' }] })
          },
        }),
      }
    },
  })

  await service.run({
    parentSessionId: 'parent-loader',
    cwd: directory,
    model: { provider: 'openai', id: 'gpt-5' },
    role: 'planner',
    task: 'Plan the change.',
    allowedTools: ['read'],
  })

  assert.match(appendedPrompt, /planning subagent/i)
})

test('read-focused subagents receive only read tools and return structured findings', async () => {
  const session = createFakeSession({
    onPrompt: async ({ emit, session: active }) => {
      emit({ type: 'tool_execution_start', toolCallId: 'read-1', toolName: 'read' })
      active.messages.push({
        role: 'assistant',
        content: [{ type: 'text', text: '## Findings\n- `server/runtime/agent-runtime.mjs` owns the primary session.' }],
        usage: { input: 120, output: 45, cacheRead: 10, cacheWrite: 0, totalTokens: 165 },
      })
      emit({ type: 'tool_execution_end', toolCallId: 'read-1', toolName: 'read', isError: false })
    },
  })
  const parentTools = ['read', 'grep', 'find', 'ls', 'edit', 'write', 'bash', 'memory_search', 'delegate_task', 'get_goal', 'update_goal']
  const customTools = [{ name: 'bash' }, { name: 'memory_search' }, { name: 'delegate_task' }, { name: 'get_goal' }, { name: 'update_goal' }, { name: 'not_enabled' }]
  let options
  let installed = null
  let completed = null
  const progress = []
  const service = new SubagentService({
    agentDir: '/vesper-agent',
    getModelRuntime: () => ({ name: 'runtime' }),
    getSettingsManager: () => ({ name: 'settings' }),
    createSessionManager: (cwd) => ({ cwd, kind: 'in-memory' }),
    createResourceLoader: createFakeResourceLoader,
    createSession: async (value) => {
      options = value
      return { session }
    },
  })

  const result = await service.run({
    parentSessionId: 'parent-1',
    cwd: '/workspace',
    model: { provider: 'openai', id: 'gpt-5' },
    role: 'scout',
    task: 'Find the agent runtime entry point and report it.',
    allowedTools: parentTools,
    customTools,
    onSession: (child) => { installed = child },
    onCompleted: (value) => { completed = value },
    onProgress: (event) => progress.push(event),
  })

  assert.equal(installed, session)
  assert.deepEqual(options.tools, ['read', 'grep', 'find', 'ls', 'memory_search'])
  assert.deepEqual(options.customTools, [{ name: 'memory_search' }])
  assert.deepEqual(new Set(options.excludeTools), new Set(['delegate_task', 'get_goal', 'update_goal']))
  assert.equal(options.sessionManager.kind, 'in-memory')
  assert.match(options.resourceLoader.rolePrompt, /scout subagent/i)
  assert.equal(session.agent.state.systemPrompt, 'Base system prompt')
  assert.equal(completed, result)
  assert.equal(result.parentSessionId, 'parent-1')
  assert.equal(result.role, 'scout')
  assert.equal(result.writeCapable, false)
  assert.deepEqual(result.availableTools, ['read', 'grep', 'find', 'ls', 'memory_search'])
  assert.equal(result.model, 'openai/gpt-5')
  assert.match(result.output, /agent-runtime/)
  assert.deepEqual(result.usage, { input: 120, output: 45, cacheRead: 10, cacheWrite: 0, reasoning: 0, totalTokens: 165 })
  assert.deepEqual(result.tools, [{ id: 'read-1', name: 'read', status: 'done' }])
  assert.ok(progress.some((event) => event.phase === 'running'))
  assert.equal(progress.at(-1).phase, 'completed')
  assert.equal(session.disposed, true)
  assert.deepEqual(service.getActive(), [])
})

test('only worker inherits parent write tools and parent-only tools are always excluded', async () => {
  const sessions = []
  const options = []
  const service = new SubagentService({
    createSession: async (value) => {
      options.push(value)
      const session = createFakeSession({
        onPrompt: async ({ session: active }) => {
          active.messages.push({ role: 'assistant', content: [{ type: 'text', text: 'Completed the delegated task.' }] })
        },
      })
      sessions.push(session)
      return { session }
    },
    createSessionManager: () => ({}),
    createResourceLoader: createFakeResourceLoader,
  })

  const parentTools = ['read', 'grep', 'find', 'ls', 'edit', 'write', 'bash', 'memory_search', 'memory_remember', 'delegate_task', 'get_goal', 'update_goal']
  const workerResult = await service.run({
    parentSessionId: 'parent-worker',
    cwd: '/workspace',
    model: { provider: 'openai', id: 'gpt-5' },
    role: 'worker',
    task: 'Investigate the focused change.',
    allowedTools: parentTools,
    customTools: [{ name: 'memory_search' }, { name: 'memory_remember' }, { name: 'delegate_task' }, { name: 'get_goal' }, { name: 'update_goal' }],
  })
  const reviewerResult = await service.run({
    parentSessionId: 'parent-reviewer',
    cwd: '/workspace',
    model: { provider: 'openai', id: 'gpt-5' },
    role: 'reviewer',
    task: 'Review the focused change.',
    allowedTools: parentTools,
    customTools: [{ name: 'memory_search' }, { name: 'memory_remember' }, { name: 'delegate_task' }],
  })

  assert.deepEqual(options[0].tools, ['read', 'grep', 'find', 'ls', 'edit', 'write', 'bash', 'memory_search', 'memory_remember'])
  assert.deepEqual(options[0].customTools, [{ name: 'memory_search' }, { name: 'memory_remember' }])
  assert.equal(workerResult.writeCapable, true)
  assert.deepEqual(options[1].tools, ['read', 'grep', 'find', 'ls', 'memory_search'])
  assert.deepEqual(options[1].customTools, [{ name: 'memory_search' }])
  assert.equal(reviewerResult.writeCapable, false)
  assert.match(options[0].resourceLoader.rolePrompt, /implementation subagent/i)
  assert.match(options[1].resourceLoader.rolePrompt, /code-review subagent/i)
  assert.equal(sessions[0].agent.state.systemPrompt, 'Base system prompt')
  assert.equal(sessions[1].agent.state.systemPrompt, 'Base system prompt')
})

test('concurrent roles preserve write access only for workers', async () => {
  let releasePrompt
  let startedCount = 0
  let bothStarted
  const started = new Promise((resolve) => { bothStarted = resolve })
  const waitForRelease = new Promise((resolve) => { releasePrompt = resolve })
  const service = new SubagentService({
    createSession: async () => ({
      session: createFakeSession({
        onPrompt: async ({ session: active }) => {
          startedCount += 1
          if (startedCount === 2) bothStarted()
          await waitForRelease
          active.messages.push({ role: 'assistant', content: [{ type: 'text', text: 'Done.' }] })
        },
      }),
    }),
    createSessionManager: () => ({}),
    createResourceLoader: createFakeResourceLoader,
  })
  const workerInput = {
    parentSessionId: 'parent-concurrent-writers',
    cwd: '/workspace',
    model: { provider: 'openai', id: 'gpt-5' },
    allowedTools: ['read', 'grep', 'find', 'ls', 'edit', 'write'],
  }
  const first = service.run({ ...workerInput, role: 'worker', task: 'Implement the first change.' })
  const second = service.run({ ...workerInput, role: 'reviewer', task: 'Implement the second change.' })
  await started
  assert.equal(service.getActive('parent-concurrent-writers').length, 2)
  releasePrompt()
  const [firstResult, secondResult] = await Promise.all([first, second])
  assert.equal(firstResult.writeCapable, true)
  assert.equal(secondResult.writeCapable, false)
})

test('subagent output has a UTF-8-aware 50 KB cap in addition to model context limits', async () => {
  const largeOutput = '你'.repeat(20_000)
  const outputs = [largeOutput, 'y'.repeat(1_000)]
  const service = new SubagentService({
    createSession: async () => ({
      session: createFakeSession({
        onPrompt: async ({ session: active }) => {
          active.messages.push({ role: 'assistant', content: [{ type: 'text', text: outputs.shift() }] })
        },
      }),
    }),
    createSessionManager: () => ({}),
    createResourceLoader: createFakeResourceLoader,
  })

  const largeContext = await service.run({
    parentSessionId: 'parent-large-context',
    cwd: '/workspace',
    model: { provider: 'openai', id: 'gpt-5', contextWindow: 200_000, maxTokens: 128_000 },
    task: 'Return the complete result.',
  })
  assert.ok(Buffer.byteLength(largeContext.output, 'utf8') <= MAX_SUBAGENT_OUTPUT_BYTES)
  assert.equal(largeContext.output.includes('\ufffd'), false)
  assert.equal(largeContext.outputTruncated, true)
  assert.equal(largeContext.fullOutput, largeOutput)
  assert.equal(largeContext.outputBytes, Buffer.byteLength(largeOutput, 'utf8'))
  assert.equal(largeContext.outputByteLimit, MAX_SUBAGENT_OUTPUT_BYTES)
  assert.equal(largeContext.outputTokenLimit, 128_000)

  const smallContext = await service.run({
    parentSessionId: 'parent-small-context',
    cwd: '/workspace',
    model: { provider: 'openai', id: 'small-model', contextWindow: 1_000, maxTokens: 50 },
    task: 'Return the bounded result.',
  })
  assert.equal(smallContext.outputTruncated, true)
  assert.equal(smallContext.outputEstimatedTokens, 250)
  assert.equal(smallContext.outputTokenLimit, 50)
  assert.ok(smallContext.output.length <= 200)
})

test('subagent inactivity timeout resets whenever the child emits activity', async () => {
  const timers = new Map()
  let nextTimerId = 0
  const setTimer = (callback, milliseconds) => {
    const handle = { id: ++nextTimerId, milliseconds, unref() {} }
    timers.set(handle, callback)
    return handle
  }
  const clearTimer = (handle) => timers.delete(handle)
  let emitEvent
  let releasePrompt
  let markPromptStarted
  const promptStarted = new Promise((resolve) => { markPromptStarted = resolve })
  const session = createFakeSession({
    onPrompt: async ({ emit }) => {
      emitEvent = emit
      markPromptStarted()
      await new Promise((resolve) => { releasePrompt = resolve })
    },
  })
  const service = new SubagentService({
    createSession: async () => ({ session }),
    createSessionManager: () => ({}),
    createResourceLoader: createFakeResourceLoader,
    setTimer,
    clearTimer,
  })

  const running = service.run({
    parentSessionId: 'parent-inactivity-timeout',
    cwd: '/workspace',
    model: { provider: 'openai', id: 'gpt-5' },
    task: 'Keep working while activity is emitted.',
    timeoutSeconds: 15,
  })
  await promptStarted
  assert.equal(timers.size, 1)
  const firstTimer = [...timers.keys()][0]

  emitEvent({ type: 'message_update' })
  assert.equal(timers.size, 1)
  const resetTimer = [...timers.keys()][0]
  assert.notEqual(resetTimer, firstTimer)
  assert.equal(timers.has(firstTimer), false)

  const rejected = assert.rejects(running, /inactive for 15 seconds/)
  const expire = timers.get(resetTimer)
  timers.delete(resetTimer)
  expire()
  await Promise.resolve()
  assert.equal(session.aborted, true)
  releasePrompt()
  await rejected
  assert.deepEqual(service.getActive('parent-inactivity-timeout'), [])
})

test('subagent service rejects oversized tasks before creating a child session', async () => {
  let created = false
  const service = new SubagentService({
    createSession: async () => { created = true; return { session: createFakeSession() } },
    createResourceLoader: createFakeResourceLoader,
  })
  await assert.rejects(service.run({
    parentSessionId: 'parent-long-task',
    cwd: '/workspace',
    model: { provider: 'openai', id: 'gpt-5' },
    task: 'x'.repeat(12_001),
  }), /limited to 12000 characters/)
  assert.equal(created, false)
})

test('stopping a parent session cancels its active subagents', async () => {
  let releasePrompt
  let promptStarted
  const started = new Promise((resolve) => { promptStarted = resolve })
  const session = createFakeSession({
    onPrompt: async () => {
      promptStarted()
      await new Promise((resolve) => { releasePrompt = resolve })
    },
  })
  const service = new SubagentService({
    createSession: async () => ({ session }),
    createSessionManager: () => ({}),
    createResourceLoader: createFakeResourceLoader,
  })

  const running = service.run({
    parentSessionId: 'parent-stop',
    cwd: '/workspace',
    model: { provider: 'openai', id: 'gpt-5' },
    task: 'Inspect the repository.',
  })
  await started
  assert.equal(service.abortParent('parent-stop'), 1)
  assert.equal(session.aborted, true)
  releasePrompt()
  await assert.rejects(running, /parent session stopped/)
  assert.deepEqual(service.getActive('parent-stop'), [])
})

test('delegate_task is registered and streams subagent progress through the tool contract', async () => {
  assert.ok(TOOL_CATALOG.some((tool) => tool.id === 'delegate_task'))
  let input
  const updates = []
  const [tool] = createAppTools({
    enabledTools: ['delegate_task'],
    runSubagent: async (value, execution) => {
      input = value
      execution.onProgress({ role: 'scout', label: 'Scout', phase: 'running', message: 'Scout is analyzing the task' })
      return {
        role: 'scout',
        label: 'Scout',
        output: 'Found the relevant module.',
        usage: { totalTokens: 42 },
        durationMs: 500,
      }
    },
  })

  const result = await tool.execute('delegate-1', { role: 'scout', task: 'Locate the runtime entry point.' }, new AbortController().signal, (update) => updates.push(update))
  assert.deepEqual(input, { role: 'scout', task: 'Locate the runtime entry point.', timeoutSeconds: undefined })
  assert.equal(updates[0].details.phase, 'running')
  assert.match(result.content[0].text, /Subagent Scout completed/)
  assert.match(result.content[0].text, /Found the relevant module/)
})
