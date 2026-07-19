import { useRef, useState } from 'react'
import { Bell, Bot, ChevronDown, ChevronRight, CircleDot, Clock3, Code2, Copy, File, FileCode2, GitBranch, Grid2X2, Image, MessageSquare, Network, Package, Pencil, Plus, RefreshCw, Rocket, Save, Search, Send, Server, ShieldCheck, Sparkles, Square, Trash2, Upload, Wrench, Zap } from 'lucide-react'
import { useI18n } from '../../app/i18n.jsx'
import { Badge, InputLabel, Metric, Panel, PreviewNotice, SectionTitle, Segmented, SelectLabel, Toggle } from '../../components/ui.jsx'

const TOOL_ROWS = [
  ['get_editor_state', 'Pencil · 读取画布状态', '低风险', true],
  ['batch_design', 'Pencil · 修改 .pen 文件', '高风险', true],
  ['read_file', 'Filesystem · 读取工作区文件', '中风险', true],
  ['write_file', 'Filesystem · 写入文件', '高风险', true],
  ['create_issue', 'GitHub · 创建 issue', '中风险', false],
  ['search_docs', 'Hermes Docs · 搜索文档', '低风险', true],
  ['query_table', 'Database · 读取数据表', '高风险', false],
]

const INSTALLED_SKILLS = [
  ['imagegen', '生成或编辑位图视觉资产', Image, true],
  ['openai-docs', '官方 OpenAI 文档查询', FileCode2, true],
  ['plugin-creator', '创建 Codex 插件结构', Package, true],
  ['skill-creator', '创建和维护技能', Wrench, true],
  ['skill-installer', '从市场安装技能', Upload, false],
]

export function McpPage({ notify }) {
  const { t } = useI18n()
  const services = [
    ['Pencil', 'mcp.pencil.local', '在线', 'green'], ['Filesystem', 'stdio://filesystem', '在线', 'green'],
    ['GitHub', 'https://mcp.github.com', '离线', 'red'], ['Browser', 'stdio://browser', '受限', 'amber'],
    ['Hermes Docs', 'https://mcp.hermesagent.org.cn/v1', '在线', 'green'], ['Database', 'stdio://postgres', '未授权', 'gray'],
  ]
  const [selected, setSelected] = useState(0)

  return <div className="preview-page">
    <PreviewNotice>MCP 页面当前展示的是交互原型数据，尚未连接真实服务状态。</PreviewNotice>
    <div className="mcp-layout">
      <Panel className="selection-list"><SectionTitle title={t('服务')} />{services.map((service, index) => <button className={`service-row ${selected === index ? 'active' : ''}`} onClick={() => setSelected(index)} key={service[0]}><span className="list-icon"><Server size={15} /></span><span><strong>{service[0]}</strong><small>{service[1]}</small></span><Badge tone={service[3]}>{t(service[2])}</Badge></button>)}</Panel>
      <div className="mcp-center">
        <div className="metric-grid"><Metric value="6" label={t('在线服务')} note="8 total" tone="blue" /><Metric value="38" label={t('可用工具')} note="5 restricted" tone="green" /><Metric value="0.8%" label={t('错误率')} note="24h" tone="amber" /></div>
        <Panel><SectionTitle title={t('工具能力')} />{TOOL_ROWS.map((row) => <div className="tool-row" key={row[0]}><span className="list-icon"><Wrench size={15} /></span><span><strong>{row[0]}</strong><small>{t(row[1])}</small></span><Badge tone={row[2] === '高风险' ? 'red' : row[2] === '中风险' ? 'amber' : 'green'}>{t(row[2])}</Badge><Toggle defaultOn={row[3]} /></div>)}</Panel>
      </div>
      <div className="detail-stack">
        <Panel><SectionTitle title={t('当前服务')} /><h2>{services[selected][0]}</h2><p className="muted-copy">{t('用于读取、生成和验证 .pen 设计文件。当前连接稳定，允许设计编辑工具。')}</p>{[['Transport', 'Streamable HTTP'], ['Latency', '42 ms'], ['Last Ping', '12 seconds ago'], ['Auth', 'Local session']].map((row) => <div className="key-value" key={row[0]}><span>{row[0]}</span><strong>{row[1]}</strong></div>)}<button className="button secondary wide" onClick={() => notify(t('演示页面尚未连接真实 MCP 服务'), 'info')}><RefreshCw size={14} />{t('测试连接')}</button></Panel>
        <Panel><SectionTitle title={t('最近调用')} />{[['snapshot_layout', '14:28 · OK'], ['batch_design', '14:26 · OK'], ['get_screenshot', '14:22 · OK'], ['export_html', '14:18 · Skipped']].map((activity) => <div className="activity-row" key={activity[0]}><CircleDot size={14} /><span><strong>{activity[0]}</strong><small>{activity[1]}</small></span></div>)}</Panel>
      </div>
    </div>
  </div>
}

export function SkillsPage({ notify }) {
  const { t } = useI18n()
  const [selected, setSelected] = useState(0)
  const [enabled, setEnabled] = useState(INSTALLED_SKILLS.map((skill) => skill[3]))
  const filters = ['全部', '已安装', '可安装', '设计', '代码', '文档', '高权限']
  const market = [
    ['browser-research', '网页调研、引用整理与资料归档', 'Research'], ['figma-import', '同步 Figma 组件并生成设计 token', 'Design'],
    ['db-admin', '读取 schema、生成安全 SQL 草案', 'Data'], ['release-writer', '根据 commits 生成 changelog 和发布说明', '已安装'],
    ['test-author', '为变更生成 focused tests', 'Code'], ['prompt-auditor', '检查系统 prompt 漏洞和冲突', 'Safety'],
  ]

  return <div className="skills-page">
    <PreviewNotice>Skills 页面当前展示的是交互原型，安装数量和市场内容不是实时数据。</PreviewNotice>
    <Segmented options={filters.map(t)} value={t('全部')} onChange={() => {}} />
    <div className="skills-layout">
      <Panel><SectionTitle title={t('已安装技能')} />{INSTALLED_SKILLS.map((skill, index) => { const Icon = skill[2]; return <button className={`skill-row ${selected === index ? 'selected' : ''}`} onClick={() => setSelected(index)} key={skill[0]}><span className="list-icon"><Icon size={15} /></span><span><strong>{skill[0]}</strong><small>{t(skill[1])}</small></span><Toggle value={enabled[index]} onChange={() => setEnabled(enabled.map((item, itemIndex) => itemIndex === index ? !item : item))} /></button>})}</Panel>
      <Panel><div className="card-head"><SectionTitle title={t('技能市场')} /><a>18 available</a></div>{market.map((skill) => <div className="market-row" key={skill[0]}><span className="list-icon"><Sparkles size={15} /></span><span><strong>{skill[0]}</strong><small>{t(skill[1])}</small></span><Badge tone={skill[2] === '已安装' ? 'green' : 'blue'}>{t(skill[2])}</Badge></div>)}</Panel>
      <div className="detail-stack">
        <Panel><SectionTitle title={t('选中技能')} /><h2>{INSTALLED_SKILLS[selected][0]}</h2><p className="muted-copy">{t('当任务需要 AI 生成位图、编辑图片、做贴图或视觉素材时自动触发。')}</p>{[[t('触发方式'), t('自动 + 手动')], [t('权限'), t('生成图片')], [t('版本'), 'system / latest'], [t('来源'), t('内置技能')]].map((row) => <div className="key-value" key={row[0]}><span>{row[0]}</span><strong>{row[1]}</strong></div>)}<button className="button primary wide" onClick={() => notify(t('演示页面尚未接入技能运行时'), 'info')}><Save size={14} />{t('保存设置')}</button></Panel>
        <Panel><SectionTitle title={t('触发条件')} />{['请求生成图片', '编辑已有图片', '需要 SVG 图标', '仅文本解释'].map((item, index) => <label className="check-row" key={item}><input type="checkbox" defaultChecked={index < 2} /><span>{t(item)}</span></label>)}</Panel>
      </div>
    </div>
  </div>
}

export function WorkflowsPage({ navigate, notify }) {
  const { t } = useI18n()
  const filters = ['全部', '预设', '自定义', '运行中', '失败', '草稿']
  const templates = [
    ['代码审查', '读取 diff → 运行测试 → 生成 review', Code2], ['PR 修复', '定位失败 → 修改代码 → 回归测试', GitBranch],
    ['资料调研', '搜索资料 → 提取引用 → 点亮星忆', Search], ['日报周报', '汇总会话 → 生成摘要 → 渠道通知', File],
    ['资产生成', '生成图片 → 存入资产库 → 通知验收', Image], ['发布准备', '版本检查 → changelog → 创建发布单', Rocket],
  ]
  const runs = [
    ['PR 修复 #284', '回归测试', 72, 'blue'], ['资料调研：MCP Auth', '整理引用', 46, 'violet'],
    ['资产生成：活动页', '等待验收', 88, 'green'], ['发布准备 v2.8', '生成 changelog', 31, 'amber'],
  ]

  return <div className="workflows-page">
    <PreviewNotice>Workflows 页面当前是产品原型，运行数、队列和进度均为演示数据。</PreviewNotice>
    <Segmented options={filters.map(t)} value={t('全部')} onChange={() => {}} />
    <div className="workflow-top">
      <Panel><div className="card-head"><SectionTitle title={t('常见预设')} /><a>6 templates</a></div><div className="template-grid">{templates.map((template) => { const Icon = template[2]; return <button onClick={() => { navigate('workflowCreate'); notify(t('已载入「{name}」演示模板', { name: t(template[0]) }), 'info') }} key={template[0]}><span className="list-icon"><Icon size={15} /></span><span><strong>{t(template[0])}</strong><small>{t(template[1])}</small></span><ChevronRight size={14} /></button>})}</div></Panel>
      <Panel className="workflow-preview"><div className="card-head"><SectionTitle title={t('自定义工作流')} /><button className="text-button" onClick={() => navigate('workflowCreate')}>{t('空白创建')}</button></div><WorkflowMiniMap /></Panel>
    </div>
    <div className="workflow-bottom">
      <Panel><div className="card-head"><SectionTitle title={t('并行运行')} /><a>3 running · 5 queued</a></div>{runs.map((run) => <div className="run-row" key={run[0]}><span><strong>{t(run[0])}</strong><small>{t(run[1])}</small></span><div className="run-progress"><i className={run[3]} style={{ width: `${run[2]}%` }} /></div><em>{run[2]}%</em><button onClick={() => notify(t('演示任务没有真实运行实例'), 'info')}><Square size={12} />{t('停止')}</button></div>)}</Panel>
      <Panel><SectionTitle title={t('队列与限制')} />{[[t('最大并发'), '4', t('当前 3 个运行')], [t('失败重试'), t('2 次'), t('指数退避')], [t('默认模型'), 'GPT-5-Codex', t('可按步骤覆盖')], [t('完成推送'), t('已启用'), t('工作流结束后发送模板消息')]].map((row) => <div className="setting-row" key={row[0]}><span><strong>{row[0]}</strong><small>{row[2]}</small></span><button>{row[1]} <ChevronDown size={12} /></button></div>)}</Panel>
    </div>
  </div>
}

export function WorkflowBuilder({ notify }) {
  const { t } = useI18n()
  const canvasRef = useRef(null)
  const [nodes, setNodes] = useState([
    { id: 1, label: 'Git push', type: '触发器', x: 65, y: 45 }, { id: 2, label: '读取 diff', type: '任务', x: 235, y: 45 },
    { id: 3, label: '是否需要测试', type: '判断', x: 405, y: 45 }, { id: 4, label: '测试 + lint', type: '并行', x: 235, y: 160 },
    { id: 5, label: '生成修复计划', type: '任务', x: 405, y: 160 }, { id: 6, label: '修改代码', type: '任务', x: 235, y: 280 },
    { id: 7, label: '人工确认', type: '审批', x: 405, y: 280 }, { id: 8, label: '发送结果', type: '通知', x: 320, y: 385 },
  ])
  const [selected, setSelected] = useState(6)
  const palette = [['Git Push', Zap], ['定时', Clock3], ['手动输入', Pencil], ['运行 Prompt', Bot], ['读写文件', FileCode2], ['调用 MCP', Server], ['发送通知', Bell], ['条件判断', GitBranch], ['并行分支', Network], ['等待审批', ShieldCheck]]
  const drop = (event) => {
    event.preventDefault()
    const data = JSON.parse(event.dataTransfer.getData('text/plain') || '{}')
    const box = canvasRef.current.getBoundingClientRect()
    const x = Math.max(10, event.clientX - box.left - 60)
    const y = Math.max(10, event.clientY - box.top - 25)
    if (data.id) setNodes(nodes.map((node) => node.id === data.id ? { ...node, x, y } : node))
    else if (data.label) { const id = Date.now(); setNodes([...nodes, { id, label: data.label, type: '节点', x, y }]); setSelected(id) }
  }
  const current = nodes.find((node) => node.id === selected) || nodes[0]

  return <div className="preview-page">
    <PreviewNotice>工作流编辑器当前仅用于交互预览，发布和试运行不会启动真实工作流。</PreviewNotice>
    <div className="builder-layout">
      <Panel className="node-library"><SectionTitle title={t('节点库')} />{palette.map(([label, Icon], index) => <div key={label}><small>{[0, 3, 7].includes(index) ? t(['触发', '动作', '控制'][[0, 3, 7].indexOf(index)]) : ''}</small><button draggable onDragStart={(event) => event.dataTransfer.setData('text/plain', JSON.stringify({ label }))}><Icon size={15} />{t(label)}<span>{t('拖拽')}</span></button></div>)}</Panel>
      <Panel className="builder-canvas" ref={canvasRef} onDragOver={(event) => event.preventDefault()} onDrop={drop}><div className="canvas-tools"><button><Plus size={14} /></button><button>−</button><button><Grid2X2 size={13} /></button></div><svg viewBox="0 0 620 520"><path d="M125 70 H235 M355 70 H405 M465 95 L465 160 M405 185 H355 M295 210 V280 M355 305 H405 M465 330 L380 385 M295 330 L320 385" /></svg>{nodes.map((node) => <button draggable onDragStart={(event) => event.dataTransfer.setData('text/plain', JSON.stringify({ id: node.id }))} onClick={() => setSelected(node.id)} className={`flow-node ${selected === node.id ? 'active' : ''} type-${node.type}`} style={{ left: node.x, top: node.y }} key={node.id}><small>{t(node.type)}</small><strong>{t(node.label)}</strong></button>)}</Panel>
      <div className="detail-stack inspector">
        <Panel><SectionTitle title={t('完成后通知')} /><div className="toggle-line"><span><MessageSquare size={15} />{t('微信研发群')}</span><Toggle defaultOn /></div><div className="toggle-line"><span><Send size={15} />{t('飞书 On-call')}</span><Toggle defaultOn /></div><label className="field-label">{t('模板')}<textarea defaultValue={t('{{workflow.name}} 已完成，耗时 {{duration}}，产物 {{asset.count}} 个。')} /></label></Panel>
        <Panel><SectionTitle title={t('选中节点')} /><h2>{t(current.label)}</h2><p className="muted-copy">{t('配置该步骤使用的模型、插件权限、输入输出和失败处理。')}</p><SelectLabel label={t('模型')} options={['GPT-5-Codex', 'GPT-5', 'DeepSeek']} /><InputLabel label={t('插件')} value="Read, Write, Grep" /><InputLabel label={t('超时')} value={t('20 分钟')} /><SelectLabel label={t('失败处理')} options={[t('重试 2 次'), t('立即停止'), t('跳过')]} /><label className="field-label">Prompt<textarea defaultValue={t('根据测试结果和 diff 修改代码，保留用户已有改动，不执行破坏性命令。')} /></label><div className="button-row"><button className="button secondary" onClick={() => { const id = Date.now(); setNodes([...nodes, { ...current, id, x: current.x + 25, y: current.y + 25 }]); notify(t('节点已复制'), 'info') }}><Copy size={14} />{t('复制节点')}</button><button className="button danger" onClick={() => { setNodes(nodes.filter((node) => node.id !== selected)); setSelected(nodes[0]?.id); notify(t('节点已删除'), 'info') }}><Trash2 size={14} />{t('删除节点')}</button></div></Panel>
      </div>
    </div>
  </div>
}

function WorkflowMiniMap() {
  const { t } = useI18n()
  const nodes = [['触发器', 'Git push'], ['任务', '运行测试'], ['判断', '测试通过?'], ['任务', '生成报告'], ['通知', '飞书 + 微信']]
  return <div className="workflow-mini-map"><svg viewBox="0 0 520 170"><path d="M90 85 H190 M250 85 H330 M390 85 H460 M220 110 V142 H330" /></svg>{nodes.map((node, index) => <span className={`mini-node mn-${index}`} key={node[1]}><small>{t(node[0])}</small><strong>{t(node[1])}</strong></span>)}</div>
}
