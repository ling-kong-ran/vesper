import { readJson, writeJsonAtomic } from '../storage/json-file.mjs'
import { presetFromTools, sanitizeEnabledTools, TOOL_CATALOG, toolsFromConfig } from '../tools/registry.mjs'

export class ToolPluginService {
  constructor(configPath) {
    this.configPath = configPath
  }

  async getState() {
    const appConfig = await readJson(this.configPath, { toolMode: 'read-only' })
    const enabledTools = toolsFromConfig(appConfig)
    return {
      tools: TOOL_CATALOG.map((tool) => ({ ...tool, enabled: enabledTools.includes(tool.id) })),
      enabledTools,
      preset: presetFromTools(enabledTools),
      changes: Array.isArray(appConfig.pluginChanges) ? appConfig.pluginChanges.slice(0, 20) : [],
      updatedAt: appConfig.pluginsUpdatedAt || null,
    }
  }

  async saveState(input = {}) {
    const appConfig = await readJson(this.configPath, { toolMode: 'read-only' })
    const previous = new Set(toolsFromConfig(appConfig))
    const enabledTools = sanitizeEnabledTools(input.enabledTools)
    const now = new Date().toISOString()
    const changes = TOOL_CATALOG.flatMap((tool) => {
      const wasEnabled = previous.has(tool.id)
      const isEnabled = enabledTools.includes(tool.id)
      return wasEnabled === isEnabled
        ? []
        : [{ tool: tool.id, name: tool.name, enabled: isEnabled, timestamp: now }]
    })

    await writeJsonAtomic(this.configPath, {
      ...appConfig,
      toolMode: presetFromTools(enabledTools),
      enabledTools,
      pluginChanges: [...changes, ...(appConfig.pluginChanges || [])].slice(0, 50),
      pluginsUpdatedAt: now,
    })
    return this.getState()
  }
}
