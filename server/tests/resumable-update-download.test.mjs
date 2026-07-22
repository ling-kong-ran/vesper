import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { mkdtemp, readFile, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PassThrough, Readable } from 'node:stream'
import test from 'node:test'
import { downloadResumableFile, downloadResumableWithRetry, enableResumableUpdateDownloads } from '../../electron/resumable-update-download.mjs'

function sha512(buffer) {
  return createHash('sha512').update(buffer).digest('base64')
}

function response({ statusCode = 200, headers = {}, body }) {
  return { statusCode, headers, body: Readable.from(body), abort() {} }
}

function interruptedResponse({ headers, chunk, message }) {
  const body = new PassThrough()
  setTimeout(() => {
    body.write(chunk, () => setTimeout(() => body.destroy(new Error(message)), 5))
  }, 0)
  return { statusCode: 200, headers, body, abort: () => body.destroy() }
}

async function fixture(t) {
  const directory = await mkdtemp(join(tmpdir(), 'vesper-resumable-update-'))
  t.after(() => rm(directory, { recursive: true, force: true }))
  return {
    directory,
    destination: join(directory, 'pending', 'temp-update.exe'),
    resumeDirectory: join(directory, 'resume'),
  }
}

test('interrupted update downloads resume from the persisted byte offset', async (t) => {
  const paths = await fixture(t)
  const content = Buffer.alloc(1024 * 1024, 7)
  const split = 410_321
  let requests = 0
  let resumedRange = ''
  const openResponse = async ({ headers }) => {
    requests += 1
    if (requests === 1) {
      return interruptedResponse({
        headers: { 'content-length': String(content.length), etag: '"release-1"' },
        chunk: content.subarray(0, split),
        message: 'socket disconnected',
      })
    }
    resumedRange = headers.Range
    return response({
      statusCode: 206,
      headers: {
        'content-length': String(content.length - split),
        'content-range': `bytes ${split}-${content.length - 1}/${content.length}`,
        etag: '"release-1"',
      },
      body: [content.subarray(split)],
    })
  }

  await assert.rejects(downloadResumableFile({
    url: 'https://example.test/Vesper.exe',
    ...paths,
    options: { sha512: sha512(content) },
    openResponse,
  }), /socket disconnected/)

  await downloadResumableFile({
    url: 'https://example.test/Vesper.exe',
    ...paths,
    options: { sha512: sha512(content) },
    openResponse,
  })

  assert.equal(resumedRange, `bytes=${split}-`)
  assert.deepEqual(await readFile(paths.destination), content)
  assert.deepEqual(await readdir(paths.resumeDirectory), [])
})

test('a server that ignores Range safely restarts the current file from zero', async (t) => {
  const paths = await fixture(t)
  const content = Buffer.from('complete installer payload')
  const split = 8
  let requests = 0
  let receivedRange = ''
  const openResponse = async ({ headers }) => {
    requests += 1
    if (requests === 1) {
      return interruptedResponse({
        headers: { 'content-length': String(content.length) },
        chunk: content.subarray(0, split),
        message: 'offline',
      })
    }
    receivedRange = headers.Range
    return response({ headers: { 'content-length': String(content.length) }, body: [content] })
  }

  await assert.rejects(downloadResumableFile({
    url: 'https://example.test/Vesper.exe',
    ...paths,
    options: { sha512: sha512(content) },
    openResponse,
  }), /offline/)
  await downloadResumableFile({
    url: 'https://example.test/Vesper.exe',
    ...paths,
    options: { sha512: sha512(content) },
    openResponse,
  })

  assert.equal(receivedRange, `bytes=${split}-`)
  assert.deepEqual(await readFile(paths.destination), content)
})

test('transient failures retry automatically using the saved partial file', async (t) => {
  const paths = await fixture(t)
  const content = Buffer.alloc(64 * 1024, 3)
  const split = 12_345
  let requests = 0
  const ranges = []

  await downloadResumableWithRetry({
    url: 'https://example.test/Vesper.exe',
    ...paths,
    options: { sha512: sha512(content) },
    openResponse: async ({ headers }) => {
      requests += 1
      ranges.push(headers.Range || '')
      if (requests === 1) return interruptedResponse({ headers: { 'content-length': String(content.length) }, chunk: content.subarray(0, split), message: 'temporary disconnect' })
      return response({
        statusCode: 206,
        headers: { 'content-length': String(content.length - split), 'content-range': `bytes ${split}-${content.length - 1}/${content.length}` },
        body: [content.subarray(split)],
      })
    },
  }, { retryDelays: [0] })

  assert.deepEqual(ranges, ['', `bytes=${split}-`])
  assert.deepEqual(await readFile(paths.destination), content)
})

test('checksum failures remove unusable partial update data', async (t) => {
  const paths = await fixture(t)
  const expected = Buffer.from('expected installer')
  const corrupted = Buffer.from('corrupted installer')

  await assert.rejects(downloadResumableFile({
    url: 'https://example.test/Vesper.exe',
    ...paths,
    options: { sha512: sha512(expected) },
    openResponse: async () => response({
      headers: { 'content-length': String(corrupted.length) },
      body: [corrupted],
    }),
  }), /checksum/)

  assert.deepEqual(await readdir(paths.resumeDirectory), [])
})

test('the Electron updater executor is replaced without changing its download contract', async (t) => {
  const paths = await fixture(t)
  const content = Buffer.from('electron updater payload')
  const requestHeaders = []
  const executor = {
    createRequest(options, callback) {
      requestHeaders.push(options.headers)
      return {
        abort() {},
        end() {
          const body = Readable.from([content])
          body.statusCode = 200
          body.headers = { 'content-length': String(content.length) }
          callback(body)
        },
      }
    },
    addErrorAndTimeoutHandlers() {},
    addRedirectHandlers() {},
  }
  const updater = { httpExecutor: executor }
  assert.equal(enableResumableUpdateDownloads(updater), true)
  assert.equal(enableResumableUpdateDownloads(updater), false)

  await executor.download('https://example.test/Vesper.exe', paths.destination, {
    sha512: sha512(content),
    cancellationToken: { cancelled: false, onCancel() {}, removeListener() {} },
  })

  assert.equal(requestHeaders[0]['User-Agent'], 'Vesper Updater')
  assert.deepEqual(await readFile(paths.destination), content)
})
