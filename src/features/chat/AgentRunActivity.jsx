import { memo, useEffect, useMemo, useState } from 'react'
import {
  AlertTriangle,
  Check,
  ChevronRight,
  Clock3,
  RefreshCw,
  Square,
} from 'lucide-react'
import { useI18n } from '../../app/use-i18n.js'
import { deriveRunActivity, formatRunDuration, groupToolCalls, runDurationMs } from './run-activity.js'

const EMPTY_LIST = []

const TOOL_ACTIVITY_LABELS = {
  read: '读取文件',
  grep: '搜索内容',
  find: '查找文件',
  ls: '浏览目录',
  edit: '修改文件',
  write: '写入文件',
  bash: '运行命令',
  memory_search: '搜索记忆',
  memory_remember: '保存记忆',
  spawn_agent: '启动 Agent',
  list_agents: '查看 Agent',
  send_message: '发送 Agent 消息',
  followup_task: '追加 Agent 任务',
  wait_agent: '等待 Agent',
  interrupt_agent: '中断 Agent',
  get_task_list: '读取任务清单',
  update_task_list: '更新任务清单',
  browser_automation: '浏览器自动化',
  generate_visual: '生成视觉内容',
}

function useRunActivityClock(streaming) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    setNow(Date.now())
    if (!streaming) return undefined
    const timer = window.setInterval(() => setNow(Date.now()), 1_000)
    return () => window.clearInterval(timer)
  }, [streaming])
  return now
}

function AgentRunActivity({ streaming, text, tools = EMPTY_LIST, error, stopped, notice, startedAt, lastActivityAt, finishedAt, compact = false }) {
  const { t, language } = useI18n()
  const [expanded, setExpanded] = useState(false)
  const now = useRunActivityClock(streaming)
  const activity = deriveRunActivity({ streaming, text, tools, error, stopped, lastActivityAt, now })
  const groups = useMemo(() => groupToolCalls(tools), [tools])
  const duration = formatRunDuration(runDurationMs(startedAt, finishedAt, now), language)
  const completedCount = tools.filter((tool) => tool.status === 'done').length
  const runningCount = groups.running.length
  const errorCount = groups.errors.length
  const toolLabel = (name) => t(TOOL_ACTIVITY_LABELS[name] || name || '使用工具')
  const stageLabel = ({ stage, activeTool }) => ({
    thinking: t('正在理解任务'),
    researching: t('正在检查项目内容'),
    editing: t('正在修改文件'),
    validating: t('正在运行命令或验证'),
    subagent: t('子 Agent 正在处理'),
    generating_visual: t('正在生成视觉内容'),
    using_tool: t('正在使用 {tool}', { tool: toolLabel(activeTool?.name) }),
    responding: t('正在整理回复'),
    waiting_model: t('正在等待模型响应'),
    waiting_tool: t('正在等待工具返回'),
    completed: t('已完成回复'),
    failed: t('本轮执行失败'),
    stopped: t('已停止运行'),
  })[stage] || t('正在处理')
  const summary = [
    completedCount ? t('已完成 {count} 项操作', { count: completedCount }) : '',
    runningCount ? t('{count} 项运行中', { count: runningCount }) : '',
    errorCount ? t('{count} 项失败', { count: errorCount }) : '',
  ].filter(Boolean).join(' · ')
  const inactivity = activity.inactiveMs >= 10_000
    ? t('{count} 秒无新进度', { count: Math.floor(activity.inactiveMs / 1000) })
    : ''
  const details = expanded
    ? [
        ...groups.running.map((tool) => ({ ...tool, count: 1 })),
        ...groups.errors.map((tool) => ({ ...tool, count: 1 })),
        ...groups.completed.map((group) => ({ ...group, id: `completed-${group.name}`, status: 'done' })),
      ]
    : [
        ...groups.running.map((tool) => ({ ...tool, count: 1 })),
        ...groups.errors.map((tool) => ({ ...tool, count: 1 })),
      ]
  const expandable = !compact && tools.length > 0

  useEffect(() => {
    if (!streaming) setExpanded(false)
  }, [streaming])

  const statusIcon = activity.stage === 'failed'
    ? <AlertTriangle size={14} />
    : activity.stage === 'stopped'
      ? <Square size={12} />
      : streaming
        ? <RefreshCw className="spin" size={14} />
        : <Check size={14} />

  return <section className={`agent-run-activity ${compact ? 'compact' : ''} ${activity.stage}`}>
    <button type="button" className="agent-run-summary" disabled={!expandable} aria-expanded={expandable ? expanded : undefined} onClick={() => expandable && setExpanded((value) => !value)} title={expandable ? t(expanded ? '收起工作过程' : '展开工作过程') : stageLabel(activity)}>
      <span className="agent-run-status-icon">{statusIcon}</span>
      <span className="agent-run-copy"><strong>{stageLabel(activity)}</strong><small>{inactivity || notice || summary || t('尚未调用工具')}</small></span>
      <span className="agent-run-duration"><Clock3 size={12} />{duration}</span>
      {expandable && <ChevronRight className={expanded ? 'expanded' : ''} size={14} />}
    </button>
    {!compact && details.length > 0 && <div className="agent-run-tools">
      {details.map((tool) => {
        const toolDuration = tool.count === 1 && tool.startedAt ? formatRunDuration(runDurationMs(tool.startedAt, tool.finishedAt, now), language) : ''
        return <div className={`agent-run-tool ${tool.status}`} key={tool.id || `${tool.name}-${tool.status}`}>
          <span>{tool.status === 'error' ? <AlertTriangle size={13} /> : tool.status === 'running' ? <RefreshCw className="spin" size={13} /> : <Check size={13} />}</span>
          <span><strong>{toolLabel(tool.name)}{tool.count > 1 ? ` × ${tool.count}` : ''}</strong>{tool.message && <small title={tool.message}>{tool.message}</small>}</span>
          <em>{toolDuration || t(tool.status === 'running' ? '运行中' : tool.status === 'error' ? '失败' : '完成')}</em>
        </div>
      })}
      {!expanded && completedCount > 0 && <button type="button" className="agent-run-more" onClick={() => setExpanded(true)}>{t('展开查看已完成的 {count} 项操作', { count: completedCount })}<ChevronRight size={13} /></button>}
    </div>}
  </section>
}

export default memo(AgentRunActivity)
