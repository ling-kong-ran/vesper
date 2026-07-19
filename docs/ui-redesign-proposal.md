# Vesper UI 品牌重塑与整体优化方案

> 状态：**已执行** · P1–P5 全部落地，五阶段独立 commit（30efe9c → 8de0297），可逐阶段回滚
> 概念图：`generated/visuals/2026-07-19T02-32-33-vesper-ui-concept-duotone.png`
> Logo 定稿：`docs/brand/vesper-logo.svg`
>
> 执行偏差说明：
> - §4 可选的 Space Grotesk 自托管未引入（方案允许纯系统栈）
> - §7 skeleton shimmer 标注「按需」，本次未新增
> - 执行中补充 `--star-strong`（`#B45309` / 暗色 `#FCD34D`）用于软底色上的小字与图标，保证对比度
> - 对话页以概念图为准二次对齐（d4a8856 之后）：agent 消息卡片化（solid 卡 + 小 logo 角色头，取代 §6.3 的“纯排版”描述）、typing 三点金脉冲放大、暗色导航选中改中性灰底 + 金条；跨行大发送按钮实测过重，后续回退为紧凑方形图标按钮

---

## 1. 设计概念：「一件墨色工具，一颗暖星」

Vesper = 暮星（黄昏时第一颗亮星）。品牌语言定为：

- **界面即夜空**——大面积中性暖灰/墨色，克制、安静、工具感
- **星金即品牌**——唯一的暖金强调色 `#F59E0B`，只出现在关键动作与品牌时刻
- **星形即符号**——四角星 ✦ 贯穿 logo、加载态、空状态、图谱节点、暗色微光

与现状（通用 Tailwind 蓝 + 蓝灰石板色 + 黑块选中态）彻底区隔，辨识度来自"少"，而不是"多"。

## 2. 品牌资产

| 资产 | 内容 | 落点（执行时） |
|---|---|---|
| Logo | 墨 V + 右上暖金四角星，单图形双色扁平，手写 SVG 两条 path | `public/favicon.svg`、`BrandLogo.jsx`（React 组件） |
| 自适应 | SVG 内嵌 `prefers-color-scheme`：暗色下墨色自动反白 `#F4F2EC`、星金提亮 `#FBBF24` | favicon 在深色浏览器 UI 下不消失 |
| 应用内 | ink 用 `currentColor`、星用 `var(--star)`，一处变色全局生效 | 侧边栏品牌区、启动屏、欢迎页、空状态 |

## 3. 色彩系统（Design Tokens）

### 3.1 品牌与语义色

| Token | Light | Dark | 用途 |
|---|---|---|---|
| `--star`（品牌强调） | `#F59E0B` | `#FBBF24` | 主按钮、激活指示、focus ring、loading、logo 星 |
| `--star-hover` | `#D97706` | `#FCD34D` | 强调色 hover |
| `--star-soft` | `#FEF3E2` | `rgba(251,191,36,.12)` | 激活态底色、tint 背景 |
| `--star-border` | `#FCD34D` | `rgba(251,191,36,.4)` | 激活态描边 |
| `--on-accent` | `#17141F` | `#17141F` | **金底上永远用墨字**（对比度 8:1+） |
| `--success` | `#16A34A` | `#4ADE80` | 成功 |
| `--danger` | `#DC2626` | `#F87171` | 危险/删除 |
| `--warning` | `#EA580C` | `#FB923C` | 警告（**改为橙**，与品牌金区分开） |
| info 语义 | 并入中性灰 | 同左 | toast info、说明性 badge 不再用蓝 |

### 3.2 中性色（暖调，替换现在的蓝灰 slate）

| Token | Light | Dark |
|---|---|---|
| `--bg` | `#F7F6F3`（暖纸白） | `#121017`（暖墨黑） |
| `--panel` | `rgba(255,255,255,.78)` | `rgba(26,23,33,.72)` |
| `--solid` | `#FFFFFF` | `#1C1926` |
| `--stroke` / `--stroke-soft` | `#E7E4DE` / `#EFEDE8` | `#2C2837` / `#262230` |
| `--text` | `#17141F` | `#F4F2EC` |
| `--text-soft` | `#3A3644` | `#D8D4CC` |
| `--muted` | `#7A746C` | `#9B948A` |
| `--ink-strong`（代码块/深底） | `#17141F` | `#0C0A11` |

### 3.3 关键取舍

- **全站去蓝**：链接 = 墨色 + 下划线；`--blue` 系列在 token 层别名映射到 `--star`，存量 `var(--blue)` 引用自动换色，再逐处修正语义（平滑过渡，降低改动风险）
- **用户气泡**：Light = 墨底纸白字；Dark = 纸白底墨字（呼应概念图），不再用彩色渐变
- **暗色微星点**：`main-surface` 背景加极淡星点纹理（纯 CSS radial-gradient，透明度 ≤ .06），"夜空感"暗色专属
- 顶部 `main-glow` 由蓝色光带改为暖金极淡渐变（≤ .05 透明度）

## 4. 字体与排版

| 项 | 方案 |
|---|---|
| 中文 | 保持现状（PingFang SC / 微软雅黑系统栈） |
| 西文/数字（可选增强） | 自托管 Space Grotesk 子集（~15KB woff2），仅用于页标题、品牌字标、数据数字；不引入则纯系统栈也可接受 |
| 字阶 | 11（标签）/ 12（辅助）/ 13（正文）/ 14（对话）/ 16（卡标题）/ 20（页标题）/ 28（欢迎页），收敛现有混乱字号 |
| 数字 | token 数、用量等一律 `ui-monospace` + 等宽数字 |

## 5. 圆角 / 阴影 / 动效 Tokens

```
--r-xs: 6px   --r-sm: 9px   --r-md: 13px   --r-lg: 18px   --r-pill: 999px
--sh-1: 0 1px 2px rgba(23,20,31,.05)
--sh-2: 0 10px 28px -16px rgba(23,20,31,.25)
--sh-star: 0 6px 20px -8px rgba(245,158,11,.55)   /* 金按钮微光 */
--ease-out: cubic-bezier(.22,1,.36,1)
--ease-spring: cubic-bezier(.34,1.35,.44,1)
--d1: 140ms  --d2: 220ms  --d3: 360ms
```

替换现状 5/6/7/8/9/10/13/14/17px 混用的圆角与不统一阴影。

## 6. 布局改造

### 6.1 侧边栏
- **品牌区**：新 SVG logo（22px）+ "Vesper" 字标；移除黑底等宽 "V" 方块
- **导航分组**（`navigation.jsx` 加分组字段）：
  - 工作区：对话 / 资产 / 渠道 / 定时任务
  - 能力：插件 / 记忆 / MCP / 技能 / 工作流
  - 系统：配置
  - 组标题 11px muted、大写感
- **选中态**：左侧 3px 金条 + `--star-soft` 底 + 墨/纸白字，**去掉黑块**；hover 暖灰底
- **底部状态卡**：token 数值 mono，前缀小星 icon；演示页"尚未接入"标记改 muted（避免与品牌金撞色）

### 6.2 页头
- 高度 84→72px，页标题 24→20px/700，描述 12px；留白收紧
- 搜索框 focus 时金 ring + 微 glow（Ctrl/⌘K 聚焦同理）

### 6.3 对话页（主战场）
- **欢迎页**：大 logo（星光 3s 呼吸微脉冲）+ 问候语 + 4 个快捷 chip（解释代码 / 写单测 / 重构 / 查 bug），点击直接填入 composer
- **消息**：agent 消息卡片化（solid 卡 + 描边，头部小 logo + VESPER mono 角色标，对齐概念图）；用户气泡见 §3.3
- **typing/流式**：三点金脉冲替换蓝色 typing-dot
- **composer**：`focus-within` 金描边 + `--sh-star` 微光；底部工具栏仅保留图标（附件 / 模型 / 权限 / 发送），发送按钮为紧凑金底方形图标按钮，hover 加强 glow，active `scale(.96)`
- **历史会话**：参考 Kimi，将主导航与会话历史拆成两个同级 Section；独立“最近会话”标题行用箭头折叠最近 4 条，右侧“查看全部”在主页面打开完整历史列表（支持搜索、打开、加入/移出平铺、重命名与删除），当前会话行使用金条/暖灰强调

### 6.4 特色页
- **记忆页（星座图）**：图谱节点改为"恒星"造型——圆点 + 光晕（box-shadow glow），active 节点金星 + 脉冲环；连线虚线；暗色下叠微星点背景。全站最有记忆点的一页
- **工作流画布**：节点 active 改金环脉冲；mini-map 连线暖灰；节点类型色保留但降饱和
- **空状态**：统一星轨线条 SVG 插画（logo 元素衍生）+ 品牌文案，替换现状纯文字
- **启动屏**：logo + "正在唤醒 Vesper…" + 星呼吸动画；`index.html` 防闪烁内联脚本背景色同步新 `--bg`

## 7. 交互与动效清单

| 场景 | 现状 | 改为 |
|---|---|---|
| 按钮 hover | 全部 `translateY(-1px)` | 取消位移；亮度/阴影变化；active `scale(.97)` |
| 卡片 hover | 无或不统一 | `translateY(-2px)` + `--sh-2` + 描边转 `--star-border` |
| focus-visible | 蓝色 outline | 统一 2px 金 outline 或 3px 金 ring |
| 页面切换 | 无过渡 | `.page-content` fade-up（opacity + 4px 位移，180ms） |
| Modal | 直接出现 | `scale(.96)→1` + fade，180ms |
| Toggle on | 蓝底 | 金底 |
| 进度条 | 蓝 | 金 |
| Toast info | 蓝色调 | 中性灰调 |
| skeleton | 无 | 暖灰 shimmer（按需） |
| reduced-motion | 已有媒体查询 | 保留并覆盖所有新动画 |

## 8. 文件改动映射

| 文件 | 改动 | 阶段 |
|---|---|---|
| `src/index.css` | token 层重写（§3/§5）+ 组件样式调整，**主体工作量，纯 CSS** | P1/P3/P4/P5 |
| `docs/brand/vesper-logo.svg` → `public/favicon.svg` | 替换 | P2 |
| `src/components/BrandLogo.jsx`（新增） | SVG React 组件 | P2 |
| `src/App.jsx` | Sidebar 品牌区/分组渲染、欢迎页、启动屏文案 | P2/P3 |
| `src/app/navigation.jsx` | NAV_ITEMS 加分组 | P3 |
| `index.html` | 防闪烁脚本背景色（`data-theme` 机制不动） | P2 |
| `src/components/ui.jsx` | 大部分经 token 自动生效；个别语义色手改 | P1/P4 |

## 9. 实施阶段

| 阶段 | 内容 | 性质 |
|---|---|---|
| **P1** | Token 换血：`:root` / `[data-theme='dark']` 重写 + `--blue`→`--star` 别名映射 | 纯 CSS，全局换色完成 ~80%，风险最低 |
| **P2** | 品牌资产：favicon、BrandLogo 组件、启动屏、欢迎页 | 小范围 JSX |
| **P3** | 布局：侧边栏分组与选中态、页头瘦身、对话页细节 | CSS + 少量 JSX |
| **P4** | 动效：过渡统一、focus 环、modal/toast/页面切换 | 纯 CSS |
| **P5** | 特色页：记忆星座图、工作流节点、空状态插画 | CSS + SVG |

## 10. 约束与风险

- **不动**：`vesper-*` localStorage 键、`data-theme` 主题机制、路由与 DOM 结构（优先纯 CSS 达成）
- 金底白字对比度不足 → 强调色上文字一律墨色 `--on-accent`
- warning 橙与品牌金邻近 → 仅在语义组件出现，且文字用 `--warning-strong` 深色
- 暗色下星金降透明度/提亮度双轨（`#FBBF24` + soft 用 rgba），避免刺眼
- 每阶段独立 commit，可单独回滚
