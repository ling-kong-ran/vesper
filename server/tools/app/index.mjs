import { createVisualGenerateTool, manifest as visualGenerateManifest } from './visual-generate.mjs'
import { factories as memoryFactories, manifests as memoryManifests } from './memory.mjs'

export const APP_TOOL_CATALOG = [visualGenerateManifest, ...memoryManifests]

const APP_TOOL_FACTORIES = {
  [visualGenerateManifest.id]: createVisualGenerateTool,
  ...memoryFactories,
}

export function createAppToolDefinitions({ enabledTools, ...context }) {
  return enabledTools
    .filter((id) => APP_TOOL_FACTORIES[id])
    .map((id) => APP_TOOL_FACTORIES[id](context))
}
