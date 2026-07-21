<p align="right"><strong>简体中文</strong> | <a href="./README.en.md">English</a></p>

<div id="top">

<!-- HEADER STYLE: MODERN -->
<div align="left" style="position: relative; width: 100%; height: 100%; ">

<img src="docs/brand/vesper-logo.svg" width="30%" style="position: absolute; top: 0; right: 0;" alt="Vesper 项目标志"/>

# Vesper

<em>让大胆的想法成为持续的行动。</em>

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

Vesper 是一个用于构建、扩展和自动化 AI Agent 工作流的全栈工作台。它将持久上下文、外部工具、定时执行与多渠道集成统一到简洁的开发者界面中。

**为什么选择 Vesper？**

Vesper 在保障集成、自动化和数据可控的同时，降低了编排智能 Agent 的复杂度。核心能力包括：

- **🟣 Agent Runtime：** 使用可配置模型、工具、文档和持久会话运行具备上下文能力的编码 Agent。
- **🔵 MCP 集成：** 发现并安全连接外部 Model Context Protocol 服务和工具。
- **🟢 工作流自动化：** 通过 Prompt、判断、审批、并行分支和通知设计并监控工作流。
- **🟡 定时任务与渠道：** 自动执行周期任务，并通过浏览器、飞书或微信发送结果。
- **🟠 Skills 与 Subagent：** 使用可复用技能扩展 Agent，并将边界清晰的任务委派给专业子 Agent。
- **🔴 本地记忆：** 通过限定作用域的本地存储和敏感信息脱敏，长期保留项目知识、决策、风险与偏好。

---

## 🔥 功能

|      | 模块 | 说明 |
| :--- | :--- | :--- |
| 💬 | **对话** | 持久会话、分页历史、Markdown 渲染、文件与图片附件、模型切换、工作目录和多会话平铺。 |
| 🧠 | **Agent Runtime** | 集成 Pi Coding Agent，支持权限控制、结构化工具活动、Goal、可复用 Skills 与隔离的 Subagent 委派。 |
| 🔌 | **工具与 MCP** | 内置及应用工具注册表、插件控制、MCP 服务管理，以及不暴露凭据的结构化配置。 |
| 🌌 | **记忆** | 按工作空间隔离的轻量本地 SQLite 记忆，支持搜索、主动保存、编辑和对话记忆提取。 |
| 🎨 | **多模态** | 分析图片、文档和代码，并通过已配置的 OpenAI 兼容、Gemini、Imagen、Veo 或 xAI 模型生成视觉内容。 |
| ⚡ | **自动化** | 定时任务与可视化工作流，支持模型选择、重试、超时、失败策略、执行历史和通知。 |
| 📡 | **渠道** | 飞书和个人微信双向通信，可配置渠道回复模型、工作目录、附件传输与复用通知模板。 |
| 🛡️ | **安全** | 会话级权限模式、敏感操作审批、服务端凭据脱敏，以及仓库外的用户数据存储。 |

---

## 🌅 项目结构

```text
vesper/
├─ docs/                 # 项目文档与品牌资源
├─ public/               # 公共静态资源
├─ shared/               # 前后端共享的工作流图逻辑
├─ server/
│  ├─ http/              # HTTP API、SSE 与静态资源响应
│  ├─ runtime/           # Pi Agent 会话与模型运行时
│  ├─ security/          # 凭据与输出脱敏
│  ├─ services/          # 领域服务与外部集成
│  ├─ storage/           # 本地持久化工具
│  ├─ tests/             # Node.js 测试
│  └─ tools/             # 内置工具与应用工具注册表
└─ src/
   ├─ app/               # 路由、导航与国际化
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
