import { APP_TOOL_CATALOG, createAppToolDefinitions } from './app/index.mjs'
import { BUILTIN_TOOL_CATALOG, TOOL_PRESETS } from './builtin-catalog.mjs'

export { TOOL_PRESETS }

export const TOOL_CATALOG = [...BUILTIN_TOOL_CATALOG, ...APP_TOOL_CATALOG]

const TOOL_IDS = new Set(TOOL_CATALOG.map((tool) => tool.id))

export function toolsFromConfig(config = {}) {
  const configured = Array.isArray(config.enabledTools)
    ? config.enabledTools.filter((tool) => TOOL_IDS.has(tool))
    : null
  return configured || TOOL_PRESETS[config.toolMode] || TOOL_PRESETS['read-only']
}

export function presetFromTools(enabledTools) {
  return Object.entries(TOOL_PRESETS).find(([, tools]) => (
    tools.length === enabledTools.length && tools.every((tool) => enabledTools.includes(tool))
  ))?.[0] || 'custom'
}

export function sanitizeEnabledTools(enabledTools) {
  return [...new Set(Array.isArray(enabledTools) ? enabledTools.filter((tool) => TOOL_IDS.has(tool)) : [])]
}

export function createAppTools({ enabledTools, ...context }) {
  return createAppToolDefinitions({ ...context, enabledTools: sanitizeEnabledTools(enabledTools) })
}
