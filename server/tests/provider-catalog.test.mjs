import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { AgentRuntimeService } from '../runtime/agent-runtime.mjs'

test('model configuration exposes built-in Kimi and GLM providers', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'vesper-provider-catalog-'))
  const runtime = new AgentRuntimeService({ cwd: directory, dataDir: directory })
  t.after(async () => {
    await runtime.dispose()
    await rm(directory, { recursive: true, force: true })
  })
  await runtime.init()
  const config = await runtime.getConfig()
  const openai = config.providers.find((provider) => provider.id === 'openai')
  const kimi = config.providers.find((provider) => provider.id === 'kimi-coding')
  const glm = config.providers.find((provider) => provider.id === 'zai-coding-cn')

  assert.equal(openai.baseUrl, 'https://api.openai.com/v1')
  assert.equal(kimi.name, 'Kimi Code')
  assert.equal(kimi.api, 'anthropic-messages')
  assert.equal(kimi.baseUrl, 'https://api.kimi.com/coding/')
  assert.ok(kimi.models.some((model) => model.id === 'k3'))
  assert.equal(glm.name, 'GLM')
  assert.equal(glm.api, 'openai-completions')
  assert.equal(glm.baseUrl, 'https://open.bigmodel.cn/api/paas/v4')
  assert.ok(glm.models.some((model) => model.id === 'glm-5.2'))

  await runtime.saveConfig({
    provider: 'zai-coding-cn',
    model: 'glm-5.2',
    apiKey: 'test-key',
    baseUrl: glm.baseUrl,
    thinkingLevel: 'medium',
    toolMode: 'read-only',
  })
  assert.equal(runtime.modelRuntime.getModel('zai-coding-cn', 'glm-5.2').baseUrl, 'https://open.bigmodel.cn/api/paas/v4')
  assert.equal((await runtime.getConfig()).providers.find((provider) => provider.id === 'zai-coding-cn').configured, true)
})

test('visual-only providers save connection settings without replacing the default chat model', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'vesper-visual-provider-config-'))
  const runtime = new AgentRuntimeService({ cwd: directory, dataDir: directory })
  t.after(async () => {
    await runtime.dispose()
    await rm(directory, { recursive: true, force: true })
  })
  await runtime.init()
  await runtime.refreshProviderModels()
  const before = runtime.settingsManager.getGlobalSettings()
  await runtime.createProvider({
    id: 'visual-relay',
    name: 'Visual Relay',
    api: 'openai-responses',
    baseUrl: 'https://visual.example.test/v1',
    apiKey: 'visual-key',
    model: 'gpt-image-1',
    modelKind: 'image',
  })
  const saved = await runtime.saveConfig({
    provider: 'visual-relay',
    model: '',
    baseUrl: 'https://visual.example.test/v1',
    thinkingLevel: 'medium',
    toolMode: 'read-only',
  })
  const after = runtime.settingsManager.getGlobalSettings()
  assert.equal(after.defaultProvider, before.defaultProvider)
  assert.equal(after.defaultModel, before.defaultModel)
  const visual = saved.providers.find((provider) => provider.id === 'visual-relay')
  assert.equal(visual.type, 'visual')
  assert.equal(visual.models.some((model) => model.kind === 'chat'), false)
  assert.ok(visual.models.some((model) => model.kind === 'image'))
})
