import assert from 'node:assert/strict'
import test from 'node:test'
import {
  MAX_AGENT_OUTPUT_BYTES,
  MULTI_AGENT_TOOL_NAMES,
  MultiAgentService,
} from '../services/multi-agent-service.mjs'
import { TOOL_CATALOG, TOOL_PRESETS, createMultiAgentTools, toolsFromConfig } from '../tools/registry.mjs'

function deferred() {
  let resolve
  let reject
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}

async function waitFor(predicate, message = 'condition') {
  const deadline = Date.now() + 2_000
  while (Date.now() < deadline) {
    const value = predicate()
    if (value) return value
    await new Promise((resolve) => setTimeout(resolve, 0))
  }
  throw new Error(`Timed out waiting for ${message}.`)
}

function createFakeSession({ onPrompt } = {}) {
  const listeners = new Set()
  const session = {
    agent: { state: { systemPrompt: 'Base system prompt' } },
    messages: [],
    promptCalls: [],
    steerCalls: [],
    followUpCalls: [],
    aborted: false,
    disposed: false,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    emit(event) {
      for (const listener of listeners) listener(event)
    },
    async prompt(message) {
      session.promptCalls.push(message)
      await onPrompt?.({ message, session })
    },
    async steer(message) {
      session.steerCalls.push(message)
    },
    async followUp(message) {
      session.followUpCalls.push(message)
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

function createService(session, overrides = {}) {
  const seen = { options: null, messages: [] }
  const service = new MultiAgentService({
    getModelRuntime: () => ({ id: 'runtime' }),
    getSettingsManager: () => ({ id: 'settings' }),
    createResourceLoader: async (options) => ({ options }),
    createSessionManager: () => ({
      appendMessage(message) {
        seen.messages.push(message)
      },
    }),
    createSession: async (options) => {
      seen.options = options
      return { session }
    },
    ...overrides,
  })
  return { service, seen }
}

function baseInput(overrides = {}) {
  return {
    parentSessionId: 'parent-1',
    cwd: process.cwd(),
    model: { provider: 'openai', id: 'gpt-5', contextWindow: 200_000, maxTokens: 128_000 },
    thinkingLevel: 'high',
    taskName: 'inspect_runtime',
    message: 'Inspect the runtime and report the relevant files.',
    allowedTools: ['read', 'edit', 'bash', 'spawn_agent', 'wait_agent', 'get_goal', 'browser_automation', 'mcp_manage'],
    customTools: [{ name: 'bash' }, { name: 'spawn_agent' }, { name: 'browser_automation' }],
    ...overrides,
  }
}

test('spawn_agent starts asynchronously and inherits the active model, reasoning level, and safe tools', async () => {
  const promptGate = deferred()
  const session = createFakeSession({
    onPrompt: async ({ session: active }) => {
      await promptGate.promise
      active.messages.push({
        role: 'assistant',
        content: [{ type: 'text', text: 'Inspected the runtime.' }],
        usage: { input: 20, output: 8, totalTokens: 28 },
      })
    },
  })
  const { service, seen } = createService(session)

  const started = await service.spawn(baseInput())
  assert.ok(['starting', 'running'].includes(started.status))
  assert.equal(Object.hasOwn(started, 'role'), false)
  await waitFor(() => session.promptCalls.length === 1, 'Agent prompt start')
  assert.equal(service.list('parent-1')[0].status, 'running')
  assert.equal(seen.options.model.id, 'gpt-5')
  assert.equal(seen.options.thinkingLevel, 'high')
  assert.deepEqual(seen.options.tools, ['read', 'edit', 'bash'])
  assert.deepEqual(seen.options.customTools, [{ name: 'bash' }])
  assert.ok(MULTI_AGENT_TOOL_NAMES.every((name) => seen.options.excludeTools.includes(name)))
  assert.ok(seen.options.excludeTools.includes('get_goal'))
  assert.ok(seen.options.excludeTools.includes('browser_automation'))

  promptGate.resolve()
  const completed = await waitFor(() => service.list('parent-1')[0]?.status === 'completed' && service.list('parent-1')[0], 'Agent completion')
  assert.equal(completed.output, 'Inspected the runtime.')
  assert.deepEqual(completed.runUsage, { input: 20, output: 8, cacheRead: 0, cacheWrite: 0, reasoning: 0, totalTokens: 28 })
})

test('forkTurns copies only the requested completed parent turns into the child context', async () => {
  const session = createFakeSession({
    onPrompt: async ({ session: active }) => active.messages.push({ role: 'assistant', content: [{ type: 'text', text: 'Done.' }] }),
  })
  const { service, seen } = createService(session)
  await service.spawn(baseInput({
    forkTurns: '1',
    parentMessages: [
      { role: 'system', content: 'hidden' },
      { role: 'user', content: 'first' },
      { role: 'assistant', content: [{ type: 'text', text: 'first answer' }] },
      { role: 'toolResult', content: [{ type: 'text', text: 'tool result' }] },
      { role: 'user', content: 'second' },
      { role: 'assistant', content: [{ type: 'text', text: 'second answer' }] },
    ],
  }))
  await waitFor(() => service.list('parent-1')[0]?.status === 'completed', 'forked Agent completion')
  assert.deepEqual(seen.messages.map((message) => message.role), ['user', 'assistant'])
  assert.equal(seen.messages[0].content, 'second')
})

test('send_message steers a running Agent and followup_task reuses its context', async () => {
  const firstRun = deferred()
  const session = createFakeSession({
    onPrompt: async ({ message, session: active }) => {
      if (message.includes('Inspect')) await firstRun.promise
      active.messages.push({ role: 'assistant', content: [{ type: 'text', text: `Completed: ${message}` }], usage: { input: 5, output: 5, totalTokens: 10 } })
    },
  })
  const { service } = createService(session)
  const started = await service.spawn(baseInput())
  await waitFor(() => service.list('parent-1')[0]?.status === 'running', 'running Agent')

  await service.sendMessage('parent-1', started.id, 'Focus on the service boundary.')
  await service.followup('parent-1', started.id, 'Also check the tests.')
  assert.deepEqual(session.steerCalls, ['Focus on the service boundary.'])
  assert.deepEqual(session.followUpCalls, ['Also check the tests.'])

  firstRun.resolve()
  await waitFor(() => service.list('parent-1')[0]?.status === 'completed', 'first Agent run')
  await assert.rejects(service.sendMessage('parent-1', started.id, 'Late message'), /not running/)

  const queued = await service.followup('parent-1', started.id, 'Review the completed result.')
  assert.ok(['starting', 'running'].includes(queued.status))
  await waitFor(() => session.promptCalls.length === 2, 'follow-up prompt')
  const completed = await waitFor(() => service.list('parent-1')[0]?.status === 'completed' && service.list('parent-1')[0]?.runNumber === 2 && service.list('parent-1')[0], 'follow-up completion')
  assert.equal(completed.runNumber, 2)
  assert.equal(completed.runUsage.totalTokens, 10)
})

test('hard duration and tool-call budgets interrupt an Agent even while it remains active', async () => {
  const timers = new Map()
  const setTimer = (callback, milliseconds) => {
    const handle = { milliseconds, unref() {} }
    timers.set(handle, callback)
    return handle
  }
  const clearTimer = (handle) => timers.delete(handle)
  const promptGate = deferred()
  const session = createFakeSession({ onPrompt: () => promptGate.promise })
  const { service } = createService(session, { setTimer, clearTimer })
  await service.spawn(baseInput({ maxDurationSeconds: 15, maxToolCalls: 1 }))
  await waitFor(() => service.list('parent-1')[0]?.status === 'running', 'budgeted Agent')
  const durationTimer = [...timers.entries()].find(([handle]) => handle.milliseconds === 15_000)
  assert.ok(durationTimer)
  durationTimer[1]()
  await waitFor(() => session.aborted, 'duration abort')
  promptGate.resolve()
  const interrupted = await waitFor(() => service.list('parent-1')[0]?.status === 'interrupted' && service.list('parent-1')[0], 'duration interruption')
  assert.match(interrupted.error, /duration limit/)

  const secondGate = deferred()
  const secondSession = createFakeSession({ onPrompt: () => secondGate.promise })
  const { service: secondService } = createService(secondSession)
  const second = await secondService.spawn(baseInput({ parentSessionId: 'parent-2', maxToolCalls: 1 }))
  await waitFor(() => secondService.list('parent-2')[0]?.status === 'running', 'tool-budget Agent')
  secondSession.emit({ type: 'tool_execution_start', toolCallId: 'read-1', toolName: 'read' })
  secondSession.emit({ type: 'tool_execution_start', toolCallId: 'read-2', toolName: 'read' })
  await waitFor(() => secondSession.aborted, 'tool budget abort')
  secondGate.resolve()
  const toolInterrupted = await waitFor(() => secondService.list('parent-2')[0]?.status === 'interrupted' && secondService.list('parent-2')[0], 'tool budget interruption')
  assert.equal(toolInterrupted.id, second.id)
  assert.match(toolInterrupted.error, /tool-call budget/)
})

test('wait_agent returns on the next Agent update and abortParent stops only matching Agents', async () => {
  const gate = deferred()
  const session = createFakeSession({ onPrompt: () => gate.promise })
  const { service } = createService(session)
  await service.spawn(baseInput())
  await waitFor(() => service.list('parent-1')[0]?.status === 'running', 'waiting Agent')

  const waiting = service.wait('parent-1', 30_000)
  session.emit({ type: 'tool_execution_start', toolCallId: 'read-1', toolName: 'read' })
  const update = await waiting
  assert.equal(update.timedOut, false)
  assert.equal(update.agents[0].toolCallCount, 1)
  assert.equal(service.abortParent('another-parent'), 0)
  assert.equal(service.abortParent('parent-1'), 1)
  gate.resolve()
  await waitFor(() => service.list('parent-1')[0]?.status === 'interrupted', 'parent abort')
})

test('Agent output is UTF-8 safe and bounded to the tool-output limit', async () => {
  const largeOutput = '你'.repeat(20_000)
  const session = createFakeSession({
    onPrompt: async ({ session: active }) => active.messages.push({ role: 'assistant', content: [{ type: 'text', text: largeOutput }] }),
  })
  const { service } = createService(session)
  await service.spawn(baseInput())
  const completed = await waitFor(() => service.list('parent-1')[0]?.status === 'completed' && service.list('parent-1')[0], 'bounded output')
  assert.ok(Buffer.byteLength(completed.output, 'utf8') <= MAX_AGENT_OUTPUT_BYTES)
  assert.equal(completed.output.includes('\ufffd'), false)
  assert.equal(completed.outputTruncated, true)
  assert.equal(completed.fullOutput, largeOutput)
})

test('Codex-style Agent tools replace delegate_task and stay hidden from the plugins catalog', async () => {
  assert.equal(TOOL_CATALOG.some((tool) => tool.id === 'delegate_task'), false)
  assert.ok(MULTI_AGENT_TOOL_NAMES.every((name) => !TOOL_CATALOG.some((tool) => tool.id === name)))
  let input
  const [tool] = createMultiAgentTools({
    multiAgentRuntime: {
      spawn: async (value) => {
        input = value
        return { id: 'agent-1', canonicalName: '/root/inspect_1', status: 'starting' }
      },
    },
  })
  const result = await tool.execute('spawn-1', { taskName: 'inspect', message: 'Inspect the runtime.', forkTurns: 'none' })
  assert.deepEqual(input, { taskName: 'inspect', message: 'Inspect the runtime.', forkTurns: 'none' })
  assert.match(result.content[0].text, /Started \/root\/inspect_1 in the background/)
})

test('new installations enable the complete tool catalog by default', () => {
  assert.deepEqual(toolsFromConfig({}), TOOL_PRESETS.full)
  assert.deepEqual(new Set(TOOL_PRESETS.full), new Set(TOOL_CATALOG.map((tool) => tool.id)))
  assert.ok(MULTI_AGENT_TOOL_NAMES.every((name) => !TOOL_PRESETS.full.includes(name)))
})

test('interrupt then followup waits for the old run and preserves the new duration timer', async () => {
  const timers = new Map()
  const setTimer = (callback, milliseconds) => {
    const handle = { milliseconds, unref() {} }
    timers.set(handle, callback)
    return handle
  }
  const clearTimer = (handle) => timers.delete(handle)
  const firstPrompt = deferred()
  const secondPrompt = deferred()
  let promptCount = 0
  const session = createFakeSession({
    onPrompt: async ({ message, session: active }) => {
      promptCount += 1
      if (promptCount === 1) {
        await firstPrompt.promise
        active.messages.push({ role: 'assistant', content: [{ type: 'text', text: `stale:${message}` }] })
        return
      }
      await secondPrompt.promise
      active.messages.push({ role: 'assistant', content: [{ type: 'text', text: `fresh:${message}` }] })
    },
  })
  const { service } = createService(session, { setTimer, clearTimer })
  const started = await service.spawn(baseInput({ maxDurationSeconds: 20 }))
  await waitFor(() => service.list('parent-1')[0]?.status === 'running', 'first run')
  assert.equal(timers.size, 1)

  service.interrupt('parent-1', started.id, 'stop first run')
  const followup = service.followup('parent-1', started.id, 'Continue with the fixed plan.')
  // Old prompt still finishing; followup must not start the next run until it settles.
  assert.equal(promptCount, 1)
  firstPrompt.resolve()
  await followup
  await waitFor(() => promptCount === 2 && service.list('parent-1')[0]?.status === 'running', 'follow-up run')
  assert.equal(timers.size, 1)
  const followupTimer = [...timers.keys()][0]
  assert.equal(followupTimer.milliseconds, 20_000)

  secondPrompt.resolve()
  const completed = await waitFor(() => service.list('parent-1')[0]?.status === 'completed' && service.list('parent-1')[0]?.runNumber === 2 && service.list('parent-1')[0], 'safe follow-up completion')
  assert.equal(completed.runNumber, 2)
  assert.match(completed.output, /fresh:Continue with the fixed plan/)
  assert.equal(completed.output.includes('stale:'), false)
  assert.equal(timers.size, 0)
})

test('parent message snapshots freeze the forked context at spawn time', async () => {
  const parentMessages = [
    { role: 'user', content: 'first' },
    { role: 'assistant', content: [{ type: 'text', text: 'first answer' }] },
    { role: 'user', content: 'second' },
    { role: 'assistant', content: [{ type: 'text', text: 'second answer' }] },
  ]
  const loaderGate = deferred()
  const session = createFakeSession({
    onPrompt: async ({ session: active }) => active.messages.push({ role: 'assistant', content: [{ type: 'text', text: 'Done.' }] }),
  })
  const { service, seen } = createService(session, {
    createResourceLoader: async (options) => {
      await loaderGate.promise
      return { options }
    },
  })
  const spawning = service.spawn(baseInput({
    forkTurns: '1',
    parentMessages,
  }))
  parentMessages.push({ role: 'user', content: 'third' })
  parentMessages.push({ role: 'assistant', content: [{ type: 'text', text: 'third answer' }] })
  loaderGate.resolve()
  await spawning
  await waitFor(() => service.list('parent-1')[0]?.status === 'completed', 'snapshot Agent completion')
  assert.deepEqual(seen.messages.map((message) => message.role), ['user', 'assistant'])
  assert.equal(seen.messages[0].content, 'second')
  assert.equal(seen.messages.some((message) => message.content === 'third'), false)
})
