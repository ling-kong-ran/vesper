import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { ChannelService } from '../services/channels/channel-service.mjs'

function response(data, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(data),
  }
}

async function fixture(fetchImpl) {
  const directory = await mkdtemp(join(tmpdir(), 'pi-coder-channels-'))
  const path = join(directory, 'channels.json')
  const service = new ChannelService({ path, fetchImpl })
  await service.init()
  return { directory, path, service }
}

test('channel responses mask webhook and signing secret', async (t) => {
  const { directory, path, service } = await fixture(async () => response({ code: 0 }))
  t.after(() => rm(directory, { recursive: true, force: true }))
  const created = await service.create({
    type: 'feishu',
    name: '研发群',
    webhookUrl: 'https://open.feishu.cn/open-apis/bot/v2/hook/private-token',
    signingSecret: 'private-secret',
  })
  assert.equal(created.webhookConfigured, true)
  assert.equal(created.signingSecretConfigured, true)
  assert.doesNotMatch(JSON.stringify(created), /private-token|private-secret/)
  const stored = await readFile(path, 'utf8')
  assert.match(stored, /private-token/)
  assert.match(stored, /private-secret/)
})

test('Feishu test sends an official signed webhook payload', async (t) => {
  let request
  const { directory, service } = await fixture(async (url, options) => {
    request = { url, options }
    return response({ code: 0, msg: 'success' })
  })
  t.after(() => rm(directory, { recursive: true, force: true }))
  const channel = await service.create({
    type: 'feishu',
    webhookUrl: 'https://open.feishu.cn/open-apis/bot/v2/hook/token',
    signingSecret: 'secret',
  })
  const tested = await service.test(channel.id)
  const payload = JSON.parse(request.options.body)
  assert.equal(request.url, 'https://open.feishu.cn/open-apis/bot/v2/hook/token')
  assert.equal(payload.msg_type, 'text')
  assert.equal(typeof payload.timestamp, 'string')
  assert.equal(typeof payload.sign, 'string')
  assert.equal(tested.lastTest.ok, true)
})

test('WeCom webhook validation blocks non-official hosts and sends the official shape', async (t) => {
  let payload
  const { directory, service } = await fixture(async (_url, options) => {
    payload = JSON.parse(options.body)
    return response({ errcode: 0, errmsg: 'ok' })
  })
  t.after(() => rm(directory, { recursive: true, force: true }))
  await assert.rejects(() => service.create({ type: 'wecom', webhookUrl: 'https://example.com/cgi-bin/webhook/send?key=secret' }), /企业微信官方/)
  const channel = await service.create({ type: 'wecom', webhookUrl: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=secret' })
  await service.test(channel.id)
  assert.equal(payload.msgtype, 'text')
  assert.match(payload.text.content, /连接成功/)
})

test('automatic notifications only target enabled subscribed channels', async (t) => {
  let sends = 0
  const { directory, service } = await fixture(async () => { sends += 1; return response({ errcode: 0 }) })
  t.after(() => rm(directory, { recursive: true, force: true }))
  const channel = await service.create({
    type: 'wecom',
    webhookUrl: 'https://qyapi.weixin.qq.com/cgi-bin/webhook/send?key=secret',
    events: ['agent.failed'],
  })
  await service.notify('agent.completed', { name: '任务' })
  assert.equal(sends, 0)
  await service.notify('agent.failed', { name: '任务' })
  assert.equal(sends, 1)
  await service.update(channel.id, { enabled: false })
  await service.notify('agent.failed', { name: '任务' })
  assert.equal(sends, 1)
})
