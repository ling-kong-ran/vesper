<p align="right"><strong>简体中文</strong> | <a href="./README.en.md">English</a></p>

<div id="top">

<!-- HEADER STYLE: MODERN -->
<div align="left" style="position: relative; width: 100%; height: 100%; ">

<img src="docs/brand/vesper-logo.svg" width="30%" style="position: absolute; top: 0; right: 0;" alt="Vesper 项目标志"/>

# Vesper

<em>同时运行多个独立会话的本地优先 AI Agent 工作台。</em>

<!-- BADGES -->
<em>主要技术与工具：</em>

<img src="https://img.shields.io/badge/JSON-000000.svg?style=flat-square&logo=JSON&logoColor=white" alt="JSON">
<img src="https://img.shields.io/badge/npm-CB3837.svg?style=flat-square&logo=npm&logoColor=white" alt="npm">
<img src="https://img.shields.io/badge/JavaScript-F7DF1E.svg?style=flat-square&logo=JavaScript&logoColor=black" alt="JavaScript">
<img src="https://img.shields.io/badge/i18next-26A69A.svg?style=flat-square&logo=i18next&logoColor=white" alt="i18next">
<img src="https://img.shields.io/badge/React-61DAFB.svg?style=flat-square&logo=React&logoColor=black" alt="React">
<img src="https://img.shields.io/badge/Vite-646CFF.svg?style=flat-square&logo=Vite&logoColor=white" alt="Vite">

</div>
</div>
<br clear="right">

---

## ☀️ 目录

- [🌞 概览](#-概览)
- [🎬 项目演示](#-项目演示)
- [🔥 功能](#-功能)
- [🌅 项目结构](#-项目结构)
- [🚀 快速开始](#-快速开始)
    - [🌟 环境要求](#-环境要求)
    - [⚡ 安装](#-安装)
    - [🔆 使用](#-使用)
    - [🌠 测试](#-测试)
- [🤝 参与贡献](#-参与贡献)
- [✨ 致谢](#-致谢)

---

## 🌞 概览

Vesper 是一款本地优先的 AI Agent 工作台，支持在多个独立会话中并行运行编码 Agent，并统一管理模型、工具、记忆、工作流、定时任务和双向通信渠道。

**为什么选择 Vesper？**

Vesper 在保障集成、自动化和数据可控的同时，降低了编排智能 Agent 的复杂度。核心能力包括：

- **🧩 多会话并行：** 每个会话独立选择模型、权限、上下文和工作目录，通过平铺模式同时观察并操作多个 Agent。
- **🟣 Agent Runtime：** 使用可配置模型、工具、文档和持久会话运行具备上下文能力的编码 Agent。
- **🔵 MCP 集成：** 发现并安全连接外部 Model Context Protocol 服务和工具。
- **🟢 工作流自动化：** 通过 Prompt、判断、审批、并行分支和通知设计并监控工作流。
- **🟡 定时任务与渠道：** 自动执行周期任务，并通过浏览器、飞书或微信发送结果。
- **🟠 Skills 与 Subagent：** 使用可复用技能扩展 Agent，并将边界清晰的任务委派给专业子 Agent。
- **🔴 本地记忆：** 通过限定作用域的本地存储和敏感信息脱敏，长期保留项目知识、决策、风险与偏好。

---

## 🎬 项目演示

[![Vesper 产品演示](./docs/show.gif)](./docs/show.html)

点击动画可打开 [交互式产品演示](./docs/show.html)。演示首先展示多个独立 Agent 会话并行运行，并继续巡览对话、资产、渠道、定时任务、插件、星忆、MCP、技能、工作流，以及配置中的模型、通知、界面和更新子页面。全部画面均来自当前 React 应用的真实页面，支持离线播放、暂停、前后切换和键盘控制。

---

## 🔥 功能

|      | 模块 | 说明 |
| :--- | :--- | :--- |
| 💬 | **多会话对话** | 多个独立 Agent 会话并行运行；每个会话拥有自己的模型、权限、上下文和工作目录，并支持平铺或聚集查看。 |
| 🧠 | **Agent Runtime** | 集成 Pi Coding Agent，支持权限控制、结构化工具活动、Goal、可复用 Skills 与隔离的 Subagent 委派。 |
| 🔌 | **工具与 MCP** | 内置及应用工具注册表、插件控制、MCP 服务管理，以及不暴露凭据的结构化配置。 |
| 🌌 | **记忆** | 按工作空间隔离的轻量本地 SQLite 记忆，支持搜索、主动保存、编辑和对话记忆提取。 |
| 🎨 | **多模态** | 分析图片、文档和代码，并通过已配置的 OpenAI 兼容、Gemini、Imagen、Veo 或 xAI 模型生成视觉内容。 |
| ⚡ | **自动化** | 定时任务与可视化工作流，支持模型选择、重试、超时、失败策略、执行历史和通知。 |
| 📡 | **渠道** | 飞书和个人微信双向通信，可配置渠道回复模型、工作目录、附件传输与复用通知模板。 |
| 🖥️ | **桌面应用** | Electron 原生窗口、单实例运行、品牌图标、应用内更新日志与 GitHub Releases 自动更新。 |
| 🛡️ | **安全** | 会话级权限模式、敏感操作审批、服务端凭据脱敏，以及仓库外的用户数据存储。 |

---

## 🌅 项目结构

```text
vesper/
├─ .github/              # CI、Release Notes 与全平台发布工作流
├─ docs/                 # 项目文档与品牌资源
├─ electron/             # Electron 主进程与安全 preload
├─ public/               # 公共静态资源
├─ scripts/              # 图标生成、桌面打包与版本发布脚本
├─ shared/               # 前后端共享的工作流图逻辑
├─ server/
│  ├─ http/              # HTTP API、SSE 与静态资源响应
│  ├─ prompts/           # Agent 系统提示词与运行时身份注入
│  ├─ runtime/           # Pi Agent 会话与模型运行时
│  ├─ security/          # 凭据与输出脱敏
│  ├─ services/          # 渠道、记忆、工作流等领域服务与外部集成
│  ├─ storage/           # 本地持久化工具
│  ├─ tests/             # Node.js 测试
│  └─ tools/             # 内置工具与应用工具注册表
└─ src/
   ├─ app/               # 路由、导航与国际化
   ├─ assets/            # 前端静态资源
   ├─ components/        # 通用 React 组件
   ├─ features/          # 功能页面与交互
   ├─ hooks/             # 通用 React Hooks
   └─ lib/               # API 与格式化工具
```

---

## 🚀 快速开始

### 🌟 环境要求

- Node.js 20 或更高版本
- npm
- 至少一个受支持的模型 Provider 和 API Key

### ⚡ 安装

```bash
git clone https://github.com/ling-kong-ran/vesper.git
cd vesper
npm install
```

### 🔆 使用

启动开发服务，默认地址为 `http://127.0.0.1:5173`：

```bash
npm run dev
```

构建并运行生产版本：

```bash
npm run build
npm start
```

Vesper 默认将本地配置和运行数据保存在 `~/.vesper/agent`。可以通过 `VESPER_AGENT_DIR` 指定其他目录。

启动或打包桌面应用：

```bash
npm run desktop:dev
npm run desktop:pack
```

发布新版本时，脚本会更新并提交 `package.json` 与 `package-lock.json`，创建 Git Tag，然后由 GitHub Actions 生成更新日志并发布 Windows、macOS 和 Linux 安装包：

```bash
npm run release -- patch
# 也可使用 minor、major 或明确版本号，例如 1.2.0
```

### 🌠 测试

```bash
npm run lint
npm test
npm run build
```

项目使用 Node.js 内置测试运行器，测试文件位于 `server/tests/`。

---

## 🤝 参与贡献

欢迎提交 Issue 和 Pull Request：

- [报告问题](https://github.com/ling-kong-ran/vesper/issues)
- [提交 Pull Request](https://github.com/ling-kong-ran/vesper/pulls)
- [查看贡献者](https://github.com/ling-kong-ran/vesper/graphs/contributors)

提交修改前，请运行上方的 lint、测试和构建命令。请勿提交 API Key、机器人凭据、本地会话数据或 `~/.vesper/agent` 中的文件。

---

## ✨ 致谢

Vesper 基于 [Pi Coding Agent](https://github.com/earendil-works/pi/tree/main/packages/coding-agent) 运行时及上方列出的开源项目构建。

<div align="right">

[![][back-to-top]](#top)

</div>

[back-to-top]: https://img.shields.io/badge/-返回顶部-151515?style=flat-square
