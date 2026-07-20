import assert from 'node:assert/strict'
import test from 'node:test'
import { SubagentService } from '../services/subagent-service.mjs'
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

test('subagent sessions inherit the parent tool set and return structured findings', async () => {
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
  assert.deepEqual(options.tools, parentTools)
  assert.deepEqual(options.customTools, customTools.slice(0, 5))
  assert.equal(options.sessionManager.kind, 'in-memory')
  assert.match(session.agent.state.systemPrompt, /scout subagent/i)
  assert.equal(completed, result)
  assert.equal(result.parentSessionId, 'parent-1')
  assert.equal(result.role, 'scout')
  assert.equal(result.writeCapable, true)
  assert.equal(result.model, 'openai/gpt-5')
  assert.match(result.output, /agent-runtime/)
  assert.deepEqual(result.usage, { input: 120, output: 45, cacheRead: 10, cacheWrite: 0, reasoning: 0, totalTokens: 165 })
  assert.deepEqual(result.tools, [{ id: 'read-1', name: 'read', status: 'done' }])
  assert.ok(progress.some((event) => event.phase === 'running'))
  assert.equal(progress.at(-1).phase, 'completed')
  assert.equal(session.disposed, true)
  assert.deepEqual(service.getActive(), [])
})

test('worker and read-focused roles both inherit the parent permission tool set', async () => {
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
  })

  const readOnlyTools = ['read', 'grep', 'find', 'ls', 'memory_search']
  const workerResult = await service.run({
    parentSessionId: 'parent-worker',
    cwd: '/workspace',
    model: { provider: 'openai', id: 'gpt-5' },
    role: 'worker',
    task: 'Investigate the focused change.',
    allowedTools: readOnlyTools,
    customTools: [{ name: 'memory_search' }],
  })
  const reviewerResult = await service.run({
    parentSessionId: 'parent-reviewer',
    cwd: '/workspace',
    model: { provider: 'openai', id: 'gpt-5' },
    role: 'reviewer',
    task: 'Review the focused change.',
    allowedTools: ['read', 'edit', 'write'],
  })

  assert.deepEqual(options[0].tools, readOnlyTools)
  assert.deepEqual(options[0].customTools, [{ name: 'memory_search' }])
  assert.equal(workerResult.writeCapable, false)
  assert.deepEqual(options[1].tools, ['read', 'edit', 'write'])
  assert.equal(reviewerResult.writeCapable, true)
  assert.match(sessions[0].agent.state.systemPrompt, /implementation subagent/i)
  assert.match(sessions[1].agent.state.systemPrompt, /code-review subagent/i)
})

test('multiple subagents with write tools can run for one parent session', async () => {
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
  assert.equal(secondResult.writeCapable, true)
})

test('subagent output limits follow model context metadata instead of a fixed character cap', async () => {
  const outputs = ['x'.repeat(30_000), 'y'.repeat(1_000)]
  const service = new SubagentService({
    createSession: async () => ({
      session: createFakeSession({
        onPrompt: async ({ session: active }) => {
          active.messages.push({ role: 'assistant', content: [{ type: 'text', text: outputs.shift() }] })
        },
      }),
    }),
    createSessionManager: () => ({}),
  })

  const largeContext = await service.run({
    parentSessionId: 'parent-large-context',
    cwd: '/workspace',
    model: { provider: 'openai', id: 'gpt-5', contextWindow: 200_000, maxTokens: 128_000 },
    task: 'Return the complete result.',
  })
  assert.equal(largeContext.output.length, 30_000)
  assert.equal(largeContext.outputTruncated, false)
  assert.equal(largeContext.outputEstimatedTokens, 7_500)
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
