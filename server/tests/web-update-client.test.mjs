import assert from 'node:assert/strict'
import test from 'node:test'
import { newerVersion, normalizedVersion } from '../../shared/app-update.mjs'
import { checkWebUpdates } from '../../src/features/updates/update-client.js'

test('web update versions normalize tags and compare semantic parts', () => {
  assert.equal(normalizedVersion('v1.2.3-beta.1'), '1.2.3')
  assert.equal(newerVersion('0.1.3', '0.1.2'), true)
  assert.equal(newerVersion('0.1.2', '0.1.2'), false)
  assert.equal(newerVersion('0.1.1', '0.1.2'), false)
})

test('web update checks use the same-origin cached API', async () => {
  const result = await checkWebUpdates({
    refresh: true,
    fetcher: async (url, options) => {
      assert.equal(url, '/api/app-update?refresh=1')
      assert.equal(options.cache, 'no-store')
      return {
        ok: true,
        json: async () => ({ state: 'available', currentVersion: '0.1.2', availableVersion: '0.1.3', canDownload: false, message: '浏览器模式检测到新版本，请前往 GitHub Releases 查看更新。' }),
      }
    },
  })

  assert.equal(result.state, 'available')
  assert.equal(result.availableVersion, '0.1.3')
  assert.equal(result.canDownload, false)
  assert.match(result.message, /GitHub Releases/)
})
