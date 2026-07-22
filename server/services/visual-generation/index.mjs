import { runVisualDriver } from './driver-registry.mjs'
import { VisualModelCatalog } from './model-selection.mjs'
import { saveVisualOutput } from './output.mjs'
import { loadMaskImage, loadSourceImages } from './source-images.mjs'

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
    if (kind === 'video' && (request.sourceImages?.length || request.maskPath)) throw new Error('视频生成暂不支持图片编辑参数。')
    const model = await this.models.select(kind, request.model)
    const sourceImages = kind === 'image' ? await loadSourceImages(request.sourceImages, request.cwd) : []
    const maskImage = kind === 'image' ? await loadMaskImage(request.maskPath, request.cwd) : null
    const operation = sourceImages.length ? 'edit' : 'generate'
    const normalizedRequest = normalizeRequest(model, { ...request, kind, operation, sourceImages, maskImage })
    options.onProgress?.(`使用 ${model.providerName} / ${model.name} ${operation === 'edit' ? '编辑图片' : `生成${kind === 'video' ? '视频' : '图片'}`}…`)
    const result = await runVisualDriver(model, normalizedRequest, options)
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
      operation,
    }
  }
}
