import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import test from 'node:test'
import { VisualGenerationService } from '../services/visual-generation/index.mjs'
import { TOOL_CATALOG, createAppTools } from '../tools/registry.mjs'

const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360000002000154a24f5d0000000049454e44ae426082', 'hex')
const MP4 = Buffer.from('00000018667479706d703432000000006d70343269736f6d', 'hex')

async function listen(handler) {
  const server = createServer(handler)
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  return { server, port: server.address().port }
}

async function fixture(provider) {
  const directory = await mkdtemp(join(tmpdir(), 'vesper-visual-test-'))
  const modelsPath = join(directory, 'models.json')
  const authPath = join(directory, 'auth.json')
  const appConfigPath = join(directory, 'vesper.json')
  await writeFile(modelsPath, JSON.stringify({ providers: { [provider.id]: provider.config } }))
  await writeFile(authPath, JSON.stringify({ [provider.id]: { type: 'api_key', key: 'test-key' } }))
  await writeFile(appConfigPath, JSON.stringify({ disabledProviders: [] }))
  return {
    directory,
    service: new VisualGenerationService({ modelsPath, authPath, appConfigPath }),
    cleanup: () => rm(directory, { recursive: true, force: true }),
  }
}

test('OpenAI-compatible image and video models generate files', async () => {
  const { server, port } = await listen(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1')
    if (req.method === 'POST' && url.pathname === '/v1/images/generations') {
      for await (const _chunk of req) void _chunk
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ created: Date.now(), data: [{ b64_json: PNG.toString('base64') }] }))
      return
    }
    if (req.method === 'POST' && url.pathname === '/v1/videos') {
      for await (const _chunk of req) void _chunk
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ id: 'video-test', object: 'video', status: 'completed', progress: 100, model: 'sora-2', prompt: 'test', seconds: '4', size: '1280x720', created_at: 1, completed_at: 2, expires_at: null, error: null, remixed_from_video_id: null }))
      return
    }
    if (req.method === 'GET' && url.pathname === '/v1/videos/video-test/content') {
      res.writeHead(200, { 'content-type': 'video/mp4' })
      res.end(MP4)
      return
    }
    res.writeHead(404).end()
  })
  const value = await fixture({
    id: 'fake',
    config: { name: 'Fake Visual', api: 'openai-responses', baseUrl: `http://127.0.0.1:${port}/v1`, models: [{ id: 'gpt-image-1', kind: 'image' }, { id: 'sora-2', kind: 'video' }] },
  })
  try {
    const image = await value.service.generate({ kind: 'image', prompt: 'test image', cwd: value.directory })
    const video = await value.service.generate({ kind: 'video', prompt: 'test video', cwd: value.directory, durationSeconds: 4, size: '1280x720' })
    assert.equal((await readFile(image.path)).length, PNG.length)
    assert.equal((await readFile(video.path)).length, MP4.length)
    assert.ok(TOOL_CATALOG.some((tool) => tool.id === 'generate_visual'))
    assert.ok(!TOOL_CATALOG.some((tool) => tool.id === 'workspace_summary'))
    let indexedPath = ''
    const tools = createAppTools({
      cwd: value.directory,
      enabledTools: ['generate_visual'],
      visualGenerationService: value.service,
      onGeneratedFile: (result) => { indexedPath = result.path },
    })
    assert.equal(tools[0].name, 'generate_visual')
    await tools[0].execute('tool-test', { kind: 'image', prompt: 'tool image', model: 'gpt-image-1' }, new AbortController().signal)
    assert.ok(indexedPath.endsWith('.png'))
  } finally {
    server.close()
    await value.cleanup()
  }
})

test('Google Gemini and Veo models generate files', async () => {
  let port
  const { server, port: listeningPort } = await listen(async (req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1')
    if (req.method === 'POST' && url.pathname.endsWith(':generateContent')) {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: PNG.toString('base64') } }] } }] }))
      return
    }
    if (req.method === 'POST' && url.pathname.endsWith(':predictLongRunning')) {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ name: 'operations/video-test', done: true, response: { generatedVideos: [{ video: { uri: `http://127.0.0.1:${port}/video.mp4` } }] } }))
      return
    }
    if (req.method === 'GET' && url.pathname === '/video.mp4') {
      res.writeHead(200, { 'content-type': 'video/mp4' })
      res.end(MP4)
      return
    }
    res.writeHead(404).end()
  })
  port = listeningPort
  const value = await fixture({
    id: 'google',
    config: { name: 'Google', api: 'google-generative-ai', baseUrl: `http://127.0.0.1:${port}/v1beta`, models: [{ id: 'gemini-3-pro-image', kind: 'image' }, { id: 'veo-3.1-generate-preview', kind: 'video' }] },
  })
  try {
    const image = await value.service.generate({ kind: 'image', prompt: 'test image', cwd: value.directory, aspectRatio: '16:9' })
    const video = await value.service.generate({ kind: 'video', prompt: 'test video', cwd: value.directory, aspectRatio: '16:9' })
    assert.equal((await readFile(image.path)).length, PNG.length)
    assert.equal((await readFile(video.path)).length, MP4.length)
  } finally {
    server.close()
    await value.cleanup()
  }
})
