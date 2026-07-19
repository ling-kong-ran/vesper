import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { extractConversationMemories, shouldExtractConversationMemory } from '../services/memory/conversation-memory.mjs'
import { LocalMemoryRuntime } from '../services/memory/local-memory-runtime.mjs'
import { ToolPluginService } from '../services/tool-plugin-service.mjs'
import { readJson, writeJsonAtomic } from '../storage/json-file.mjs'
import { toolsFromConfig } from '../tools/registry.mjs'

async function withMemory(run) {
  const directory = await mkdtemp(join(tmpdir(), 'vesper-memory-'))
  const cwd = join(directory, 'project')
  const memory = new LocalMemoryRuntime({ path: join(directory, 'memory.sqlite'), cwd })
  try {
    await memory.init()
    await run(memory, cwd)
  } finally {
    memory.dispose()
    await rm(directory, { recursive: true, force: true })
  }
}

test('local memory persists spaces, nodes, search results and links', async () => {
  await withMemory(async (memory, cwd) => {
    const spaces = memory.listSpaces()
    assert.equal(spaces.length, 2)
    assert.equal(spaces[0].kind, 'project')
    assert.equal(spaces[1].id, 'global')

    const projectId = spaces[0].id
    const preference = memory.remember({
      spaceId: projectId,
      title: '页面 UI 约束',
      content: '不要随便改变已经通过产品验收的页面布局，只补充功能。',
      type: 'preference',
      importance: 1,
    })
    const file = memory.remember({
      spaceId: projectId,
      title: '界面规范文件',
      content: '该文件记录页面布局和产品验收约束。',
      type: 'file',
      sourcePath: join(cwd, 'UI.md'),
    })

    const results = memory.search('页面布局不能随便修改', { cwd })
    assert.equal(results[0].id, preference.id)
    assert.ok(results[0].score > 0.25)

    const dashboard = memory.getDashboard({ spaceId: projectId })
    assert.equal(dashboard.nodes.length, 2)
    assert.ok(dashboard.links.some((link) => [link.sourceId, link.targetId].includes(file.id)))

    const updated = memory.remember({
      spaceId: projectId,
      title: '页面 UI 约束',
      content: '已通过产品验收的 UI 不允许随意调整，只实现明确要求的功能。',
      type: 'preference',
      importance: 1,
    })
    assert.equal(updated.id, preference.id)
    assert.match(updated.content, /不允许随意调整/)
    assert.equal(memory.getDashboard({ spaceId: projectId }).nodes.length, 2)

    assert.equal(memory.forget(file.id), true)
    assert.equal(memory.getMemory(file.id), null)
  })
})

test('memory redacts common credential formats before persistence', async () => {
  await withMemory(async (memory) => {
    const item = memory.remember({
      spaceId: 'global',
      title: 'Provider 配置',
      content: 'apiKey: sk-example-secret-token-1234567890',
      type: 'fact',
    })
    assert.doesNotMatch(item.content, /sk-example-secret/)
    assert.match(item.content, /已隐藏/)
  })
})

test('conversation memory extraction accepts only structured durable memories', async () => {
  const modelRuntime = {
    async completeSimple() {
      return {
        content: [{ type: 'text', text: '```json\n[{"title":"UI 约束","content":"不要主动改变已验收页面布局","type":"preference","scope":"global","importance":1}]\n```' }],
        usage: { input: 100, output: 30, totalTokens: 130 },
        timestamp: 123,
      }
    },
  }
  const result = await extractConversationMemories({
    modelRuntime,
    model: { reasoning: false },
    user: '记住不要随便改 UI，只完成我要求的功能。',
    assistant: '明白，后续会保留已经通过验收的布局。',
  })
  assert.equal(result.memories.length, 1)
  assert.equal(result.memories[0].scope, 'global')
  assert.equal(result.usage.totalTokens, 130)
  assert.equal(shouldExtractConversationMemory('你好', '你好'), false)
})

test('memory tools migrate once and can still be disabled in plugin settings', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'vesper-tools-'))
  const path = join(directory, 'vesper.json')
  try {
    await writeJsonAtomic(path, { toolMode: 'custom', enabledTools: ['read', 'bash'] })
    const service = new ToolPluginService(path)
    await service.ensureDefaultTools(['memory_search', 'memory_remember'], 'memoryToolsV1')
    const migrated = await readJson(path, {})
    assert.deepEqual(toolsFromConfig(migrated), ['read', 'bash', 'memory_search', 'memory_remember'])
    await service.saveState({ enabledTools: ['read', 'bash'] })
    assert.deepEqual((await service.getState()).enabledTools, ['read', 'bash'])
    await service.ensureDefaultTools(['memory_search', 'memory_remember'], 'memoryToolsV1')
    assert.deepEqual((await service.getState()).enabledTools, ['read', 'bash'])
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
})
