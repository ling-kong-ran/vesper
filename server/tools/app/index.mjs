import { createVisualGenerateTool, manifest as visualGenerateManifest } from './visual-generate.mjs'

export const APP_TOOL_CATALOG = [visualGenerateManifest]

const APP_TOOL_FACTORIES = {
  [visualGenerateManifest.id]: createVisualGenerateTool,
}

export function createAppToolDefinitions({ enabledTools, ...context }) {
  return enabledTools
    .filter((id) => APP_TOOL_FACTORIES[id])
    .map((id) => APP_TOOL_FACTORIES[id](context))
}
