import { generateGoogle } from './google.mjs'
import { generateNewAPI } from './new-api.mjs'
import { generateOpenAICompatible } from './openai-compatible.mjs'
import { isNewAPIProvider } from './protocol-detection.mjs'
import { generateXAI } from './xai.mjs'

const DRIVERS = new Map([
  ['google-image', generateGoogle],
  ['google-video', generateGoogle],
  ['xai-image', generateXAI],
  ['xai-video', generateXAI],
  ['new-api-image', generateNewAPI],
  ['new-api-video', generateNewAPI],
  ['openai-image', generateOpenAICompatible],
  ['openai-video', generateOpenAICompatible],
  ['openrouter-image', generateOpenAICompatible],
])

export async function runVisualDriver(model, request, options) {
  const detectedDriver = model.driver.startsWith('xai-') && await isNewAPIProvider(model.baseUrl)
    ? `new-api-${model.kind}`
    : model.driver
  const driver = DRIVERS.get(detectedDriver)
  if (!driver) throw new Error(`不支持的视觉接口驱动：${model.driver}`)
  return driver(model, request, options)
}
