import { generateGoogle } from './google.mjs'
import { VisualModelCatalog } from './model-selection.mjs'
import { generateOpenAICompatible } from './openai-compatible.mjs'
import { saveVisualOutput } from './output.mjs'

export { inferModelKind } from './model-selection.mjs'

function normalizeRequest(model, request) {
  const value = { ...request }
  if (!value.size && value.aspectRatio) {
    if (value.kind === 'video') {
      value.size = value.aspectRatio === '9:16' ? '720x1280' : '1280x720'
    } else if (!model.driver.startsWith('google-')) {
      value.size = value.aspectRatio === '9:16' || value.aspectRatio === '3:4'
        ? '1024x1536'
        : value.aspectRatio === '16:9' || value.aspectRatio === '4:3'
          ? '1536x1024'
          : '1024x1024'
    }
  }
  if (model.driver.startsWith('google-') && value.kind === 'video' && !value.resolution && value.size) {
    value.resolution = value.size.includes('1080') ? '1080p' : '720p'
  }
  return value
}

export class VisualGenerationService {
  constructor(paths) {
    this.models = new VisualModelCatalog(paths)
  }

  async generate(request, options = {}) {
    const kind = request.kind === 'video' ? 'video' : 'image'
    const model = await this.models.select(kind, request.model)
    const normalizedRequest = normalizeRequest(model, { ...request, kind })
    options.onProgress?.(`使用 ${model.providerName} / ${model.name} 生成${kind === 'video' ? '视频' : '图片'}…`)
    const result = model.driver.startsWith('google-')
      ? await generateGoogle(model, normalizedRequest, options)
      : await generateOpenAICompatible(model, normalizedRequest, options)
    const path = await saveVisualOutput({ cwd: request.cwd, prompt: request.prompt, outputName: request.outputName, result })
    return {
      path,
      kind,
      mimeType: result.mimeType,
      size: result.buffer.length,
      provider: model.providerId,
      providerName: model.providerName,
      model: model.id,
      modelName: model.name,
      remoteId: result.remoteId || null,
    }
  }
}
