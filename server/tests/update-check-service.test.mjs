import assert from 'node:assert/strict'
import test from 'node:test'
import { UpdateCheckService } from '../services/update-check-service.mjs'

test('server update checks sanitize notes and cache GitHub responses', async () => {
  let requests = 0
  let now = Date.parse('2026-07-23T00:00:00.000Z')
  const service = new UpdateCheckService({
    currentVersion: '0.1.2',
    now: () => now,
    fetcher: async (_url, options) => {
      requests += 1
      assert.equal(options.headers['User-Agent'], 'Vesper/0.1.2')
      return {
        ok: true,
        json: async () => ({
          tag_name: 'v0.1.3',
          published_at: '2026-07-22T23:00:00.000Z',
          body: '<h2>Vesper 0.1.3</h2><p><strong>Improved</strong> startup updates.</p>',
          html_url: 'https://github.com/ling-kong-ran/vesper/releases/tag/v0.1.3',
        }),
      }
    },
  })

  const first = await service.check()
  const cached = await service.check()
  now += 16 * 60_000
  await service.check()

  assert.equal(first.state, 'available')
  assert.equal(first.currentVersion, '0.1.2')
  assert.equal(first.canDownload, false)
  assert.match(first.notes, /\*\*Improved\*\*/)
  assert.deepEqual(cached, first)
  assert.equal(requests, 2)
})
