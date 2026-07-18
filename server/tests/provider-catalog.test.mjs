import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { AgentRuntimeService } from '../runtime/agent-runtime.mjs'

test('model configuration exposes built-in Kimi and GLM providers', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'pi-coder-provider-catalog-'))
  const runtime = new AgentRuntimeService({ cwd: directory, dataDir: directory })
  t.after(async () => {
    await runtime.dispose()
    await rm(directory, { recursive: true, force: true })
  })
  await runtime.init()
  const config = await runtime.getConfig()
  const kimi = config.providers.find((provider) => provider.id === 'moonshotai-cn')
  const glm = config.providers.find((provider) => provider.id === 'zai-coding-cn')

  assert.equal(kimi.name, 'Kimi')
  assert.equal(kimi.api, 'openai-completions')
  assert.equal(kimi.baseUrl, 'https://api.moonshot.cn/v1')
  assert.ok(kimi.models.some((model) => model.id === 'kimi-k3'))
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
