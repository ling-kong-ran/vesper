export const TOOL_NAME_KEYS = Object.freeze({
  read: '读取文件',
  ls: '浏览目录',
  grep: '搜索内容',
  find: '查找文件',
  edit: '修改文件',
  write: '写入文件',
  bash: '运行命令',
  web_search: '联网搜索',
  browser_automation: '浏览器控制',
  generate_visual: '生成视觉内容',
  memory_search: '搜索星忆',
  memory_remember: '保存星忆',
  mcp_list: '查看 MCP 服务',
  mcp_manage: '管理 MCP 服务',
})

export function toolNameKey(tool) {
  return TOOL_NAME_KEYS[tool?.id] || String(tool?.name || tool?.id || '')
}
