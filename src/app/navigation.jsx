import { Brain, CalendarClock, FolderOpen, MessageSquare, Plug, RadioTower, Server, Settings, Sparkles, Workflow } from 'lucide-react'

export const NAV_GROUPS = [
  ['工作区', [
    ['chat', '对话', MessageSquare],
    ['assets', '资产', FolderOpen],
    ['channels', '渠道', RadioTower],
    ['schedules', '定时任务', CalendarClock],
  ]],
  ['能力', [
    ['plugins', '插件', Plug],
    ['memory', '星忆', Brain],
    ['mcp', 'MCP', Server],
    ['skills', '技能', Sparkles],
    ['workflows', '工作流', Workflow],
  ]],
  ['系统', [
    ['config', '配置', Settings],
  ]],
]

export const NAV_ITEMS = NAV_GROUPS.flatMap(([, items]) => items)

export const PAGE_META = {
  chat: ['对话', '多 session 并行'],
  chatHistory: ['历史会话', '浏览、搜索与管理全部对话记录'],
  assets: ['资产', '历史会话产物统一归档'],
  channels: ['渠道', '双向协作渠道与会话管理'],
  schedules: ['定时任务', '周期性 prompt 自动执行'],
  config: ['配置', '模型、运行参数与通知设置'],
  plugins: ['插件', '控制 agent 可使用的工具与插件权限'],
  memory: ['星忆', '让思考、文件与决策在星图中持续闪耀'],
  mcp: ['MCP', 'MCP 服务、工具能力与连接健康管理'],
  skills: ['技能', '技能安装、启用与触发条件管理'],
  workflows: ['工作流', '预设流程、自定义编排与多工作流并行运行'],
  workflowCreate: ['新建工作流', '拖拽节点到画布，自定义 agent 执行流程'],
}

export function getNavigation(t = (value) => value) {
  return NAV_GROUPS.map(([group, items]) => [
    t(group),
    items.map(([id, label, Icon]) => [id, t(label), Icon]),
  ])
}

export function getPageMeta(t = (value) => value) {
  return Object.fromEntries(Object.entries(PAGE_META).map(([id, [title, description]]) => [id, [t(title), t(description)]]))
}
