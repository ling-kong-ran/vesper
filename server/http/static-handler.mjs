import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { extname, join, normalize, resolve } from 'node:path'
import { json } from './response.mjs'

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
}

export function createStaticHandler(root) {
  return async function serveProduction(_req, res, url) {
    const dist = join(root, 'dist')
    const requested = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, '')
    let file = resolve(dist, requested || 'index.html')
    if (!file.startsWith(resolve(dist))) {
      json(res, 403, { error: '禁止访问。' })
      return
    }
    try {
      if ((await stat(file)).isDirectory()) file = join(file, 'index.html')
    } catch {
      file = join(dist, 'index.html')
    }
    res.writeHead(200, { 'Content-Type': MIME[extname(file)] || 'application/octet-stream' })
    createReadStream(file).on('error', () => json(res, 404, { error: '文件不存在。' })).pipe(res)
  }
}
