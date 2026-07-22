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

test('new facts supersede stale memories with the same stable topic', async () => {
  await withMemory(async (memory, cwd) => {
    const spaceId = (await memory.ensureWorkspaceSpace(cwd))
    const stale = memory.remember({
      spaceId,
      title: 'Vesper 品牌颜色',
      content: 'Vesper 的品牌主色是黄色。',
      type: 'decision',
      importance: 1,
    })
    // Simulate a record created before stable topic keys were introduced.
    memory.requireDb().prepare("UPDATE memories SET topic_key = '' WHERE id = ?").run(stale.id)
    const current = memory.remember({
      spaceId,
      title: 'Vesper 品牌色规范',
      content: 'Vesper 以墨黑为主色，仅用少量克制的蓝色点缀。',
      topic: 'project.brand_colors',
      type: 'decision',
      importance: 1,
    })

    const staleRecord = memory.getMemory(stale.id)
    assert.equal(staleRecord.status, 'superseded')
    assert.equal(staleRecord.supersededBy, current.id)
    assert.equal(memory.getMemory(current.id).status, 'active')
    assert.ok(memory.search('Vesper 品牌色 黄色 墨黑 蓝色', { cwd }).every((item) => item.id !== stale.id))
    assert.deepEqual(memory.getDashboard({ spaceId }).nodes.map((item) => item.id), [current.id])

    memory.requireDb().prepare("UPDATE memories SET status = 'active', superseded_by = '', superseded_at = NULL WHERE id = ?").run(stale.id)
    memory.reconcileSupersededMemories()
    assert.equal(memory.getMemory(stale.id).supersededBy, current.id)
  })
})

test('memory search balances relevance with recency so a newer matching fact ranks first', async () => {
  await withMemory(async (memory, cwd) => {
    const spaceId = await memory.ensureWorkspaceSpace(cwd)
    const older = memory.remember({
      spaceId,
      title: '桌面发布流程',
      content: 'Vesper 桌面发布通过 GitHub Actions 构建全平台安装包。',
      type: 'concept',
    })
    memory.requireDb().prepare('UPDATE memories SET updated_at = ? WHERE id = ?').run('2023-01-01T00:00:00.000Z', older.id)
    const newer = memory.remember({
      spaceId,
      title: '桌面发布规范',
      content: 'Vesper 桌面发布使用 GitHub Actions 自动构建 Windows、macOS 与 Linux 安装包。',
      type: 'concept',
      dedupe: false,
    })

    const results = memory.search('Vesper 桌面发布 GitHub Actions 构建安装包', { cwd })
    assert.equal(results[0].id, newer.id)
    assert.ok(results.some((item) => item.id === older.id))
  })
})

test('superseding one topic keeps unrelated older memories recallable', async () => {
  await withMemory(async (memory, cwd) => {
    const spaceId = await memory.ensureWorkspaceSpace(cwd)
    const convention = memory.remember({
      spaceId,
      title: '样式实现约束',
      content: '前端颜色必须通过语义变量引入，不得在组件中硬编码。',
      topic: 'project.css_color_tokens',
      type: 'preference',
    })
    memory.remember({
      spaceId,
      title: '旧品牌色',
      content: '品牌使用黄色。',
      topic: 'project.brand_colors',
      type: 'decision',
    })
    memory.remember({
      spaceId,
      title: '新品牌色',
      content: '品牌现在改为墨黑主色与少量蓝色点缀，不再使用黄色。',
      topic: 'project.brand_colors',
      type: 'decision',
    })

    const results = memory.search('前端颜色语义变量 不要硬编码', { cwd })
    assert.ok(results.some((item) => item.id === convention.id))
    assert.equal(memory.getMemory(convention.id).status, 'active')
  })
})

test('conversation memory extraction accepts only structured durable memories', async () => {
  const modelRuntime = {
    async completeSimple() {
      return {
        content: [{ type: 'text', text: '```json\n[{"title":"UI 约束","content":"不要主动改变已验收页面布局","topic":"user.ui_change_policy","type":"preference","scope":"global","importance":1}]\n```' }],
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
  assert.equal(result.memories[0].topic, 'user.ui_change_policy')
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
