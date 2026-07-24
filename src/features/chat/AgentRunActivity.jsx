import { memo, useEffect, useState } from 'react'
import {
  AlertTriangle,
  Check,
  Clock3,
  RefreshCw,
  Square,
} from 'lucide-react'
import { useI18n } from '../../app/use-i18n.js'
import { formatTokenCount } from '../../lib/format.js'
import { activityDurationMs, formatRunDuration, primaryRunActivity, runDurationMs } from './run-activity.js'

const EMPTY_LIST = []

const TOOL_ACTIVITY_LABELS = {
  read: '正在读取文件',
  grep: '正在搜索内容',
  find: '正在查找文件',
  ls: '正在浏览目录',
  edit: '正在修改文件',
  write: '正在写入文件',
  bash: '正在运行命令',
  memory_search: '正在搜索记忆',
  memory_remember: '正在保存记忆',
  spawn_agent: '正在启动子 Agent',
  list_agents: '正在检查子 Agent',
  send_message: '正在向子 Agent 发送消息',
  followup_task: '正在追加子 Agent 任务',
  wait_agent: '正在等待子 Agent',
  interrupt_agent: '正在中断子 Agent',
  get_task_list: '正在读取计划',
  update_task_list: '正在更新计划',
  browser_automation: '正在操作浏览器',
  generate_visual: '正在生成视觉内容',
}

const AGENT_ROLE_LABELS = {
  explorer: '探索',
  reviewer: '审查',
  worker: '执行',
  tester: '验证',
}

const TOOL_COMPLETED_LABELS = {
  read: '已读取文件',
  grep: '已完成搜索',
  find: '已完成查找',
  ls: '已浏览目录',
  edit: '已修改文件',
  write: '已写入文件',
  bash: '命令执行完成',
  spawn_agent: '子 Agent 已启动',
  wait_agent: '子 Agent 状态已更新',
  update_task_list: '计划已更新',
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

function cleanInline(value) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

function toolDetail(tool) {
  const args = tool?.args || {}
  if (tool?.name === 'bash') return { text: String(args.command || '').trim(), command: true }
  if (['read', 'edit', 'write', 'ls'].includes(tool?.name)) return { text: cleanInline(args.path) }
  if (tool?.name === 'grep') return { text: [args.pattern ? `“${cleanInline(args.pattern)}”` : '', cleanInline(args.path)].filter(Boolean).join(' · ') }
  if (tool?.name === 'find') return { text: [cleanInline(args.pattern), cleanInline(args.path)].filter(Boolean).join(' · ') }
  if (tool?.name === 'browser_automation') return { text: [cleanInline(args.action), cleanInline(args.url || args.selector)].filter(Boolean).join(' · ') }
  if (tool?.name === 'spawn_agent') return { text: cleanInline(args.taskName) }
  if (['send_message', 'followup_task', 'wait_agent', 'interrupt_agent'].includes(tool?.name)) return { text: cleanInline(args.target) }
  if (tool?.name === 'generate_visual') return { text: cleanInline(args.outputName || args.kind) }
  return { text: '' }
}

function planProgress(taskList, t) {
  const items = taskList?.items || []
  const completed = taskList?.counts?.completed ?? items.filter((item) => item.status === 'completed').length
  const active = taskList?.counts?.inProgress ?? items.filter((item) => item.status === 'in_progress').length
  return [
    items.length ? t('{completed}/{total} 已完成', { completed, total: items.length }) : '',
    active ? t('{count} 项进行中', { count: active }) : '',
  ].filter(Boolean).join(' · ') || t('计划已清空')
}

function planChangeText(change, t) {
  if (change.kind === 'removed') return t('移除：{title}', { title: change.title })
  if (change.status === 'completed') return t('完成：{title}', { title: change.title })
  if (change.status === 'in_progress') return t('进行中：{title}', { title: change.title })
  if (change.status === 'blocked') return t('阻塞：{title}', { title: change.title })
  if (change.kind === 'added') return t('新增：{title}', { title: change.title })
  return t('待处理：{title}', { title: change.title })
}

function compactionText(compaction, t) {
  if (compaction?.active) {
    return t(compaction.reason === 'overflow'
      ? '上下文已满，压缩后将自动重试'
      : compaction.reason === 'manual'
        ? '正在按请求整理较早消息'
        : '上下文接近上限，正在摘要较早消息')
  }
  if (compaction?.tokensBefore != null && compaction?.estimatedTokensAfter != null) {
    return t('上下文已压缩：{before} → {after} tokens', {
      before: formatTokenCount(compaction.tokensBefore),
      after: formatTokenCount(compaction.estimatedTokensAfter),
    })
  }
  return t('正在整理较早消息')
}

function activityPresentation(activity, { t, text, thinkingText, compaction, error, stopped, notice, lastActivityAt, now }) {
  let tone = 'running'
  let title = t('正在理解任务')
  let detail = notice || ''
  let output = ''
  let command = false
  let startedAt = activity.startedAt
  let changes = EMPTY_LIST

  if (activity.type === 'tool') {
    const failed = activity.status === 'error'
    const completed = activity.status === 'done'
    tone = failed ? 'failed' : completed ? 'completed' : 'running'
    title = failed
      ? t('{tool}执行失败', { tool: t(TOOL_ACTIVITY_LABELS[activity.name] || activity.name || '工具') })
      : completed
        ? t(TOOL_COMPLETED_LABELS[activity.name] || '当前操作已完成')
        : t(TOOL_ACTIVITY_LABELS[activity.name] || '正在使用 {tool}', { tool: activity.name || t('工具') })
    const toolInfo = toolDetail(activity)
    detail = toolInfo.text
    command = toolInfo.command
    output = cleanInline(activity.message)
  } else if (activity.type === 'plan') {
    tone = 'plan'
    title = t('已更新计划')
    changes = activity.changes || EMPTY_LIST
    detail = changes.length ? t('{count} 项计划变更', { count: changes.length }) : planProgress(activity.taskList, t)
  } else if (activity.type === 'agent') {
    const agent = activity.agent || {}
    const name = agent.canonicalName || agent.taskName || t('子 Agent')
    const role = t(AGENT_ROLE_LABELS[agent.role] || agent.role || '执行')
    if (agent.status === 'queued') { title = t('{name} 等待调度', { name }); tone = 'waiting' }
    else if (agent.status === 'starting') title = t('{name} 正在启动', { name })
    else if (agent.status === 'running') title = t('{name} 正在运行', { name })
    else if (agent.status === 'completed') { title = t('{name} 已完成', { name }); tone = 'completed' }
    else if (agent.status === 'interrupted') { title = t('{name} 已中断', { name }); tone = 'stopped' }
    else { title = t('{name} 执行失败', { name }); tone = 'failed' }
    const nestedTool = agent.currentActivity?.type === 'tool' ? toolDetail(agent.currentActivity).text || agent.currentActivity.name : ''
    const waiting = agent.status === 'queued' && agent.dependsOn?.length ? t('等待 {count} 个依赖 Agent', { count: agent.dependsOn.length }) : ''
    detail = [role, waiting || nestedTool || cleanInline(agent.message || agent.error)].filter(Boolean).join(' · ')
    output = agent.status === 'running' ? cleanInline(agent.output) : ''
    startedAt = agent.startedAt || startedAt
  } else if (activity.type === 'compaction') {
    tone = 'compacting'
    title = t('正在压缩上下文')
    detail = compactionText(activity.compaction || compaction, t)
  } else if (activity.type === 'retry') {
    tone = 'waiting'
    title = t('正在重试请求')
    detail = activity.message || notice || ''
  } else {
    const inactiveMs = Math.max(0, now - new Date(lastActivityAt || now).getTime())
    if (error) { tone = 'failed'; title = t('本轮执行失败'); detail = error }
    else if (stopped) { tone = 'stopped'; title = t('已停止运行') }
    else if (inactiveMs >= 10_000) { tone = 'waiting'; title = t('正在等待模型响应'); detail = t('{count} 秒无新进度', { count: Math.floor(inactiveMs / 1000) }) }
    else if (activity.stage === 'responding') title = t('正在整理回复')
    else if (activity.stage === 'processing_result') title = t('正在处理工具结果')
    else if (activity.stage === 'working') title = t('正在推进任务')
    else title = t(String(thinkingText || '').trim() ? '正在推理下一步' : String(text || '').trim() ? '正在整理回复' : '正在理解任务')
    if (String(thinkingText || '').trim()) detail = cleanInline(thinkingText)
  }

  return { tone, title, detail, output, command, startedAt, changes }
}

function ActivityIcon({ tone }) {
  if (tone === 'failed') return <AlertTriangle size={14} />
  if (tone === 'stopped') return <Square size={12} />
  if (['completed', 'plan'].includes(tone)) return <Check size={14} />
  return <RefreshCw className="spin" size={14} />
}

function AgentRunActivity({ streaming, text, thinkingText, currentActivity, activityFeed = EMPTY_LIST, compaction, error, stopped, notice, startedAt, lastActivityAt, finishedAt, compact = false }) {
  const { t, language } = useI18n()
  const now = useRunActivityClock(streaming)
  if (!streaming) return null

  const primaryActivity = primaryRunActivity({ currentActivity, compaction, text, thinkingText, lastActivityAt })
  const primary = activityPresentation(primaryActivity, { t, text, thinkingText, compaction, error, stopped, notice, lastActivityAt, now })
  const primaryDuration = formatRunDuration(runDurationMs(startedAt, finishedAt, now), language)
  const primaryDetail = primary.command && activityFeed.length
    ? t('{count} 项实时操作', { count: activityFeed.length })
    : primary.detail

  return <section className={`agent-run-activity ${compact ? 'compact' : ''}`} aria-live="polite">
    <div className={`agent-run-overview ${primary.tone}`}>
      <span className="agent-run-status-icon"><ActivityIcon tone={primary.tone} /></span>
      <span className="agent-run-copy"><strong>{primary.title}</strong>{primaryDetail && <small title={primaryDetail}>{primaryDetail}</small>}</span>
      <span className="agent-run-duration"><Clock3 size={12} />{primaryDuration}</span>
    </div>
    {activityFeed.length > 0 && <div className="agent-run-feed">
      {activityFeed.map((activity, index) => {
        const presentation = activityPresentation(activity, { t, text, thinkingText, compaction, error, stopped, notice, lastActivityAt, now })
        const duration = formatRunDuration(activityDurationMs(activity, startedAt, now), language)
        const key = `${activity.type}-${activity.id || activity.agent?.id || activity.updatedAt || index}-${activity.status || activity.stage || activity.agent?.status || ''}`
        return <div className={`agent-run-summary ${presentation.tone} ${index === activityFeed.length - 1 ? 'current' : ''}`} key={key}>
          <span className="agent-run-status-icon"><ActivityIcon tone={presentation.tone} /></span>
          <span className="agent-run-copy">
            <strong>{presentation.title}</strong>
            {presentation.detail && (presentation.command
              ? <code className="agent-run-command" title={presentation.detail}>$ {presentation.detail}</code>
              : <small title={presentation.detail}>{presentation.detail}</small>)}
            {presentation.changes.length > 0 && <span className="agent-run-plan-changes">
              {presentation.changes.slice(0, 4).map((change) => <small key={`${change.id}-${change.kind}-${change.status}`}>{planChangeText(change, t)}</small>)}
              {presentation.changes.length > 4 && <small>{t('还有 {count} 项变更', { count: presentation.changes.length - 4 })}</small>}
            </span>}
            {presentation.output && presentation.output !== presentation.detail && <small className="agent-run-output" title={presentation.output}>{presentation.output}</small>}
          </span>
          <span className="agent-run-duration"><Clock3 size={12} />{duration}</span>
        </div>
      })}
    </div>}
  </section>
}

export default memo(AgentRunActivity)
