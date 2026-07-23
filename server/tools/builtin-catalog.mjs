export const BUILTIN_TOOL_CATALOG = [
  { id: 'read', name: 'Read', category: '文件系统', risk: '低风险', description: '读取工作目录中的文本、代码和图片文件。', scope: '当前会话工作目录', capability: '读取文件内容，不修改文件', source: 'builtin' },
  { id: 'ls', name: 'List', category: '文件系统', risk: '低风险', description: '列出目录结构和文件基本信息。', scope: '当前会话工作目录', capability: '浏览目录，不读取文件正文', source: 'builtin' },
  { id: 'grep', name: 'Grep', category: '搜索', risk: '低风险', description: '在项目文件中进行全文和正则搜索。', scope: '当前会话工作目录', capability: '搜索文本，不修改文件', source: 'builtin' },
  { id: 'find', name: 'Find', category: '搜索', risk: '低风险', description: '按名称和模式查找项目文件。', scope: '当前会话工作目录', capability: '查找路径，不修改文件', source: 'builtin' },
  { id: 'edit', name: 'Edit', category: '文件系统', risk: '高风险', description: '对现有文件执行精确的局部编辑。', scope: '当前会话工作目录', capability: '修改现有文件并生成差异', source: 'builtin' },
  { id: 'write', name: 'Write', category: '文件系统', risk: '高风险', description: '创建新文件或覆盖写入文件内容。', scope: '当前会话工作目录', capability: '创建和覆盖文件', source: 'builtin' },
  { id: 'bash', name: 'Shell', category: '终端', risk: '高风险', description: '在会话工作目录中执行终端命令。', scope: '当前会话工作目录', capability: '执行命令、构建和测试', source: 'builtin' },
]

export const TOOL_PRESETS = {
  'read-only': ['read', 'grep', 'find', 'ls', 'web_search', 'browser_automation', 'memory_search', 'memory_remember', 'mcp_list', 'mcp_manage'],
  workspace: ['read', 'grep', 'find', 'ls', 'edit', 'write', 'web_search', 'browser_automation', 'memory_search', 'memory_remember', 'mcp_list', 'mcp_manage'],
  full: ['read', 'grep', 'find', 'ls', 'edit', 'write', 'bash', 'web_search', 'browser_automation', 'generate_visual', 'memory_search', 'memory_remember', 'mcp_list', 'mcp_manage'],
}
