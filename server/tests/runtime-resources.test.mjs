import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { defineTool, SessionManager } from '@earendil-works/pi-coding-agent'
import { Type } from 'typebox'
import { AgentRuntimeService } from '../runtime/agent-runtime.mjs'

test('main and child Agent runtimes receive filtered Pi skills while MCP definitions become active tools', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'vesper-runtime-resources-'))
  let runtime
  t.after(async () => {
    await runtime?.dispose()
    await rm(directory, { recursive: true, force: true })
  })
  await mkdir(join(directory, 'skills', 'runtime-skill'), { recursive: true })
  await writeFile(join(directory, 'skills', 'runtime-skill', 'SKILL.md'), `---\nname: runtime-skill\ndescription: Verify runtime skill loading.\n---\n\nUse this runtime skill.\n`, 'utf8')

  runtime = new AgentRuntimeService({ cwd: directory, dataDir: directory })
  await runtime.init()
  runtime.mcp.createToolDefinitions = async () => [defineTool({
    name: 'mcp_fixture_echo_12345678',
    label: 'MCP fixture echo',
    description: 'Fixture MCP tool',
    parameters: Type.Object({ text: Type.String() }),
    async execute(_id, params) {
      return { content: [{ type: 'text', text: params.text }], details: {} }
    },
  })]

  const value = await runtime.createSessionRuntime(SessionManager.inMemory(directory))
  assert.ok(value.session.resourceLoader.getSkills().skills.some((skill) => skill.name === 'runtime-skill'))
  assert.ok(value.session.agent.state.systemPrompt.includes('runtime-skill'))
  assert.ok(value.session.getActiveToolNames().includes('mcp_fixture_echo_12345678'))
  assert.ok(value.session.getActiveToolNames().includes('mcp_list'))
  assert.ok(value.session.getActiveToolNames().includes('mcp_manage'))
  assert.ok(value.session.hasExtensionHandlers('tool_result'))
  assert.ok(value.session.hasExtensionHandlers('message_end'))

  const childLoader = await runtime.subagents.createResourceLoader({ cwd: directory, rolePrompt: 'CHILD ROLE PROMPT' })
  assert.ok(childLoader.getSkills().skills.some((skill) => skill.name === 'runtime-skill'))
  assert.ok(childLoader.getAppendSystemPrompt().includes('CHILD ROLE PROMPT'))
})

test('resource changes keep the currently streaming session alive', async () => {
  const runtime = new AgentRuntimeService({ cwd: process.cwd(), dataDir: process.cwd() })
  let streamingDisposed = 0
  let idleDisposed = 0
  runtime.sessions.set('streaming', {
    runtimeVersion: 0,
    session: { isStreaming: true, dispose: () => { streamingDisposed += 1 } },
  })
  runtime.sessions.set('idle', {
    runtimeVersion: 0,
    session: { isStreaming: false, dispose: () => { idleDisposed += 1 } },
  })
  runtime.mcp.add = async () => ({ services: [] })

  await runtime.createMcpServer({ name: 'fixture' })

  assert.equal(runtime.sessionRuntimeVersion, 1)
  assert.equal(streamingDisposed, 0)
  assert.equal(idleDisposed, 1)
  assert.equal(runtime.sessions.has('streaming'), true)
  assert.equal(runtime.sessions.has('idle'), false)
})
