import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { AgentRuntimeService } from '../runtime/agent-runtime.mjs'

test('provider model discovery uses the configured relay Base URL and stored credential', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'vesper-provider-model-runtime-'))
  const calls = []
  const runtime = new AgentRuntimeService({
    cwd: directory,
    dataDir: directory,
    providerModelDiscovery: {
      async discover(input) {
        calls.push(input)
        return {
          count: 2,
          models: [
            { id: 'relay-chat-v2', name: 'Relay Chat V2', kind: 'chat' },
            { id: 'relay-image-v1', name: 'Relay Image V1', kind: 'image' },
          ],
        }
      },
    },
  })
  t.after(async () => {
    await runtime.dispose()
    await rm(directory, { recursive: true, force: true })
  })
  await runtime.init()
  await runtime.createProvider({
    id: 'company-relay',
    name: 'Company Relay',
    api: 'openai-responses',
    baseUrl: 'https://relay.example.test/v1',
    apiKey: 'relay-private-key',
    model: 'relay-chat-v1',
  })

  const discovered = await runtime.discoverProviderModels('company-relay')
  assert.equal(calls.length, 1)
  assert.equal(calls[0].baseUrl, 'https://relay.example.test/v1')
  assert.equal(calls[0].apiKey, 'relay-private-key')
  assert.equal(discovered.models.every((model) => model.added === false), true)

  const updated = await runtime.addProviderModels('company-relay', discovered.models)
  assert.deepEqual(updated.addedModelIds, ['relay-chat-v2', 'relay-image-v1'])
  const provider = updated.providers.find((item) => item.id === 'company-relay')
  assert.ok(provider.models.some((model) => model.id === 'relay-chat-v2' && model.kind === 'chat'))
  assert.ok(provider.models.some((model) => model.id === 'relay-image-v1' && model.kind === 'image'))
})

test('provider model discovery does not infer an official URL when Base URL is missing', async (t) => {
  const directory = await mkdtemp(join(tmpdir(), 'vesper-provider-model-no-base-url-'))
  let called = false
  const runtime = new AgentRuntimeService({
    cwd: directory,
    dataDir: directory,
    providerModelDiscovery: { async discover() { called = true; return { count: 0, models: [] } } },
  })
  t.after(async () => {
    await runtime.dispose()
    await rm(directory, { recursive: true, force: true })
  })
  await runtime.init()
  await assert.rejects(
    () => runtime.discoverProviderModels('openai', { apiKey: 'private-key' }),
    /Base URL/,
  )
  assert.equal(called, false)
})
