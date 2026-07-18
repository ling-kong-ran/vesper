import { defineTool } from '@earendil-works/pi-coding-agent'
import { Type } from 'typebox'

export const manifest = {
  id: 'generate_visual',
  name: 'Visual Generate',
  category: '视觉',
  risk: '高风险',
  description: '调用已配置的图像或视频模型生成视觉内容并保存到工作目录。',
  scope: '已配置的视觉 Provider；当前会话工作目录/generated/visuals',
  capability: '消耗模型额度生成图片或视频，并写入生成文件',
  source: 'app',
}

const optionalStringEnum = (values) => Type.Optional(Type.Union(values.map((value) => Type.Literal(value))))

export function createVisualGenerateTool({ cwd, visualGenerationService, onGeneratedFile }) {
  return defineTool({
    name: manifest.id,
    label: manifest.name,
    description: manifest.description,
    promptSnippet: 'Generate an image or video with a configured visual model',
    promptGuidelines: [
      'Use generate_visual when the user asks to create an image, illustration, poster, concept art, animation, or video.',
      'Before using generate_visual, include all important subject, style, composition, lighting, camera, motion, and text requirements in its prompt.',
      'generate_visual consumes external provider quota and writes the result under generated/visuals.',
    ],
    parameters: Type.Object({
      kind: Type.Union([Type.Literal('image'), Type.Literal('video')], { description: '生成图片或视频' }),
      prompt: Type.String({ minLength: 1, description: '完整的视觉生成提示词' }),
      model: Type.Optional(Type.String({ description: '可选模型 ID，支持 provider/model；留空自动选择' })),
      outputName: Type.Optional(Type.String({ description: '输出文件名，不需要扩展名' })),
      aspectRatio: optionalStringEnum(['1:1', '16:9', '9:16', '4:3', '3:4']),
      size: optionalStringEnum(['1024x1024', '1536x1024', '1024x1536', '1280x720', '720x1280', '1792x1024', '1024x1792']),
      imageSize: optionalStringEnum(['1K', '2K', '4K']),
      resolution: optionalStringEnum(['720p', '1080p', '4k']),
      durationSeconds: Type.Optional(Type.Union([Type.Literal(4), Type.Literal(8), Type.Literal(12)])),
      quality: optionalStringEnum(['auto', 'low', 'medium', 'high', 'standard', 'hd']),
      outputFormat: optionalStringEnum(['png', 'jpeg', 'webp']),
    }),
    async execute(_toolCallId, params, signal, onUpdate) {
      if (!visualGenerationService) throw new Error('视觉生成服务尚未初始化。')
      const result = await visualGenerationService.generate({ ...params, cwd }, {
        signal,
        onProgress: (message) => onUpdate?.({ content: [{ type: 'text', text: message }] }),
      })
      try {
        await onGeneratedFile?.(result)
      } catch {
        // Asset indexing must not discard a successfully generated file.
      }
      return {
        content: [{
          type: 'text',
          text: `${result.kind === 'video' ? '视频' : '图片'}已生成。\n文件：${result.path}\nProvider：${result.providerName}\n模型：${result.modelName}`,
        }],
        details: result,
      }
    },
  })
}
