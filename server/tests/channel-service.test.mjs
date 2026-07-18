import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { ChannelService } from '../services/channels/channel-service.mjs'
import { FeishuOnboardingService } from '../services/channels/feishu-onboarding.mjs'

class FakeGateway {
  constructor({ onMessage }) {
    this.onMessage = onMessage
    this.sent = []
    this.status = { state: 'idle', lastError: '', bot: null }
  }
  getStatus() { return this.status }
  async connect(config) {
    this.config = config
    this.status = { state: 'connected', lastError: '', connectedAt: new Date().toISOString(), bot: { name: 'Pi Coder Agent', openId: 'bot' } }
    return this.status
  }
  async disconnect() { this.status = { state: 'idle', lastError: '', bot: null } }
  async send(message, input) { this.sent.push({ chatId: message.chatId, input, replyTo: message.messageId }) }
  async sendToChat(chatId, input) { this.sent.push({ chatId, input }) }
  async downloadResources() { return [] }
}

async function fixture(agent = {}) {
  const directory = await mkdtemp(join(tmpdir(), 'pi-coder-channels-'))
  const path = join(directory, 'channels.json')
  let gateway
  const service = new ChannelService({
    path,
    cwd: directory,
    agent: {
      prompt: agent.prompt || (async () => ({ sessionId: 'session-1', text: 'Agent 回复', cwd: directory, assets: [] })),
      abort: agent.abort || (async () => true),
      validateDirectory: agent.validateDirectory || (async (value) => value || directory),
    },
    gatewayFactory: (options) => { gateway = new FakeGateway(options); return gateway },
    onboardingFactory: ({ onCompleted }) => ({ start: () => onCompleted, get: () => null, cancel: () => false, dispose: () => {} }),
  })
  await service.init()
  return { directory, path, service, gateway }
}

test('legacy one-way webhook configuration is discarded during migration', async (t) => {
  const { directory, path, service } = await fixture()
  t.after(() => rm(directory, { recursive: true, force: true }))
  await writeFile(path, JSON.stringify({ version: 1, channels: [{ type: 'feishu', webhookUrl: 'https://secret' }] }))
  await service.init()
  assert.equal(service.getState().connection, null)
  assert.doesNotMatch(await readFile(path, 'utf8'), /webhookUrl|secret/)
})

test('QR onboarding stores credentials privately and establishes WebSocket state', async (t) => {
  const { directory, path, service, gateway } = await fixture()
  t.after(() => rm(directory, { recursive: true, force: true }))
  await service.completeOnboarding({ appId: 'cli_1234567890', appSecret: 'private-secret', ownerOpenId: 'owner', domain: 'feishu' })
  const state = service.getState()
  assert.equal(state.connection.status, 'connected')
  assert.equal(state.connection.ownerConfigured, true)
  assert.doesNotMatch(JSON.stringify(state), /private-secret/)
  assert.equal(gateway.config.appId, 'cli_1234567890')
  assert.match(await readFile(path, 'utf8'), /private-secret/)
})

test('inbound Feishu messages run the agent and bind each chat to a Pi session', async (t) => {
  let promptInput
  const { directory, service, gateway } = await fixture({ prompt: async (input) => { promptInput = input; return { sessionId: 'pi-session', text: '**完成**', cwd: directory, assets: [] } } })
  t.after(() => rm(directory, { recursive: true, force: true }))
  await service.completeOnboarding({ appId: 'cli_app', appSecret: 'secret', ownerOpenId: 'owner' })
  await service.handleMessage({ messageId: 'm1', chatId: 'chat1', chatType: 'p2p', senderId: 'owner', senderName: '用户', content: '检查项目', resources: [] })
  assert.equal(promptInput.message, '检查项目')
  assert.equal(service.getState().scopes[0].sessionId, 'pi-session')
  assert.deepEqual(gateway.sent.at(-1).input, { markdown: '**完成**' })
})

test('owner-only mode rejects other users and /stop aborts the bound session', async (t) => {
  let aborted = ''
  const { directory, service, gateway } = await fixture({ abort: async (id) => { aborted = id; return true } })
  t.after(() => rm(directory, { recursive: true, force: true }))
  await service.completeOnboarding({ appId: 'cli_app', appSecret: 'secret', ownerOpenId: 'owner' })
  await service.handleMessage({ messageId: 'm1', chatId: 'chat1', chatType: 'p2p', senderId: 'owner', content: '开始', resources: [] })
  await service.handleMessage({ messageId: 'm2', chatId: 'chat1', chatType: 'p2p', senderId: 'other', content: '继续', resources: [] })
  assert.match(gateway.sent.at(-1).input.text, /扫码创建者/)
  await service.handleMessage({ messageId: 'm3', chatId: 'chat1', chatType: 'p2p', senderId: 'owner', content: '/stop', resources: [] })
  assert.equal(aborted, 'session-1')
})

test('official registerApp flow requests only bidirectional bot capabilities', async () => {
  let options
  const service = new FeishuOnboardingService({
    registerAppImpl: async (input) => {
      options = input
      input.onQRCodeReady({ url: 'https://accounts.feishu.cn/device', expireIn: 60 })
      return { client_id: 'cli_app', client_secret: 'secret', user_info: { open_id: 'owner', tenant_brand: 'feishu' } }
    },
    renderQr: async () => 'data:image/png;base64,qr',
    onCompleted: async () => {},
  })
  const job = await service.start()
  assert.equal(job.qrDataUrl, 'data:image/png;base64,qr')
  await service.jobs.get(job.id).promise
  assert.equal(options.createOnly, true)
  assert.deepEqual(options.addons.events.items.tenant, ['im.message.receive_v1'])
  assert.ok(options.addons.scopes.tenant.includes('im:message:send_as_bot'))
})
