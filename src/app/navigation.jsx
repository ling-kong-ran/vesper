import { Brain, CalendarClock, FolderOpen, MessageSquare, Plug, RadioTower, Server, Settings, Sparkles, Workflow } from 'lucide-react'

export const NAV_GROUPS = [
  ['工作台', [
    ['chat', '会话', MessageSquare],
    ['assets', '资产', FolderOpen],
    ['channels', '渠道', RadioTower],
    ['schedules', '定时任务', CalendarClock],
  ]],
  ['能力', [
    ['plugins', '工具', Plug],
    ['memory', '星忆', Brain],
    ['mcp', 'MCP', Server],
    ['skills', '技能', Sparkles],
    ['workflows', '工作流', Workflow],
  ]],
  ['系统', [
    ['config', '设置', Settings],
  ]],
]

export const NAV_ITEMS = NAV_GROUPS.flatMap(([, items]) => items)

export const PAGE_META = {
  chat: ['会话', '让多个会话沿各自轨道并行推进'],
  chatHistory: ['历史会话', '每一次交谈，都在这里留下清晰可寻的回声'],
  assets: ['资产', '收拢对话中的文件、图像与灵感产物'],
  channels: ['渠道', '让 Vesper 穿过屏幕，抵达你的协作现场'],
  schedules: ['定时任务', '把重复的等待，交给准时启程的任务'],
  config: ['设置', '校准模型、运行策略与通知节奏'],
  plugins: ['工具', '为 Agent 选择可触及的工具，也划清行动边界'],
  memory: ['星忆', '让思考、偏好与决策在星图中长久发光'],
  mcp: ['MCP', '连接外部能力，也守住每一道权限边界'],
  skills: ['技能', '收纳可复用的技艺，让能力随任务被唤醒'],
  workflows: ['工作流', '把灵感编排成路径，让多个流程并行生长'],
  workflowCreate: ['新建工作流', '拖拽节点，把一次设想编排成可运行的星轨'],
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
