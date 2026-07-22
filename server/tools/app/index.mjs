import { createVisualGenerateTool, manifest as visualGenerateManifest } from './visual-generate.mjs'
import { factories as memoryFactories, manifests as memoryManifests } from './memory.mjs'
import { factories as subagentFactories, manifest as subagentManifest } from './subagent.mjs'
import { factories as mcpFactories, manifests as mcpManifests } from './mcp-management.mjs'
import { createWebSearchTool, manifest as webSearchManifest } from './web-search.mjs'
import { createBrowserAutomationTool, manifest as browserAutomationManifest } from './browser-automation.mjs'

export const APP_TOOL_CATALOG = [webSearchManifest, browserAutomationManifest, visualGenerateManifest, ...memoryManifests, subagentManifest, ...mcpManifests]

const APP_TOOL_FACTORIES = {
  [webSearchManifest.id]: createWebSearchTool,
  [browserAutomationManifest.id]: createBrowserAutomationTool,
  [visualGenerateManifest.id]: createVisualGenerateTool,
  ...memoryFactories,
  ...subagentFactories,
  ...mcpFactories,
}

export function createAppToolDefinitions({ enabledTools, ...context }) {
  return enabledTools
    .filter((id) => APP_TOOL_FACTORIES[id])
    .map((id) => APP_TOOL_FACTORIES[id](context))
}
