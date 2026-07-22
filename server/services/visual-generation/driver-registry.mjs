import { generateGoogle } from './google.mjs'
import { generateOpenAICompatible } from './openai-compatible.mjs'
import { generateXAI } from './xai.mjs'

const DRIVERS = new Map([
  ['google-image', generateGoogle],
  ['google-video', generateGoogle],
  ['xai-image', generateXAI],
  ['xai-video', generateXAI],
  ['openai-image', generateOpenAICompatible],
  ['openai-video', generateOpenAICompatible],
  ['openrouter-image', generateOpenAICompatible],
])

export function runVisualDriver(model, request, options) {
  const driver = DRIVERS.get(model.driver)
  if (!driver) throw new Error(`不支持的视觉接口驱动：${model.driver}`)
  return driver(model, request, options)
}
