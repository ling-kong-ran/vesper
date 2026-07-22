<p align="right"><a href="./README.md">简体中文</a> | <strong>English</strong></p>

<div id="top">

<!-- HEADER STYLE: MODERN -->
<div align="left" style="position: relative; width: 100%; height: 100%; ">

<img src="docs/brand/vesper-logo.svg" width="30%" style="position: absolute; top: 0; right: 0;" alt="Vesper project logo"/>

# Vesper

<em>An AI agent application for running independent sessions in parallel.</em>

<!-- BADGES -->
<em>Built with the tools and technologies:</em>

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

## ☀️ Table of Contents

- [🌞 Overview](#-overview)
- [🎬 Product Demo](#-product-demo)
- [🔥 Features](#-features)
- [🌅 Project Structure](#-project-structure)
- [🚀 Getting Started](#-getting-started)
    - [🌟 Prerequisites](#-prerequisites)
    - [⚡ Installation](#-installation)
    - [🔆 Usage](#-usage)
    - [🌠 Testing](#-testing)
- [🤝 Contributing](#-contributing)
- [✨ Acknowledgments](#-acknowledgments)

---

## 🌞 Overview

Vesper is an AI agent application that runs coding agents across multiple independent sessions and manages models, tools, memory, workflows, schedules, and two-way channels.

---

## 🎬 Product Demo

![Vesper product demo](./docs/show.gif)

---

## 🔥 Features

|      | Component | Details |
| :--- | :--- | :--- |
| 💬 | **Multi-session Chat** | Run multiple independent Agent sessions in parallel, each with its own model, permissions, context, and working directory, in grid or focus mode. |
| 🧠 | **Agent Runtime** | Pi Coding Agent integration with configurable permissions, structured tool activity, goals, reusable skills, and isolated subagent delegation. |
| 🔌 | **Tools & MCP** | Built-in and application tool registry, plugin controls, MCP service management, and credential-safe structured configuration. |
| 🌌 | **Memory** | Lightweight local SQLite memory scoped by workspace, with search, manual capture, editing, and conversation-derived memories. |
| 🎨 | **Multimodal** | Image, document, and code analysis plus visual generation through configured OpenAI-compatible, Gemini, Imagen, Veo, or xAI models. |
| ⚡ | **Automation** | Recurring schedules and visual workflows with model selection, retries, timeouts, failure policies, execution history, and notifications. |
| 📡 | **Channels** | Two-way Feishu and personal Weixin connections with per-channel reply models, workspace routing, attachments, and reusable notification templates. |
| 🖥️ | **Desktop App** | Native Electron window, single-instance runtime, branded icons, in-app release notes, and GitHub Releases auto-update. |
| 🛡️ | **Security** | Per-session permission modes, approval gates for sensitive actions, server-side secret redaction, and user data stored outside the repository. |

---

## 🌅 Project Structure

```text
vesper/
├─ .github/              # CI, release notes, and cross-platform releases
├─ docs/                 # Project documentation and brand assets
├─ electron/             # Electron main process and secure preload
├─ public/               # Public static assets
├─ scripts/              # Icon generation, packaging, and release scripts
├─ shared/               # Workflow graph logic shared by client and server
├─ server/
│  ├─ http/              # HTTP API, SSE, and static responses
│  ├─ runtime/           # Pi agent session and model runtime
│  ├─ security/          # Credential and output redaction
│  ├─ services/          # Domain services and integrations
│  ├─ storage/           # Local persistence helpers
│  ├─ tests/             # Node.js test suites
│  └─ tools/             # Built-in and application tool registry
└─ src/
   ├─ app/               # Routing, navigation, and localization
   ├─ components/        # Shared React components
   ├─ features/          # Feature pages and interactions
   ├─ hooks/             # Shared React hooks
   └─ lib/               # API and formatting utilities
```

---

## 🚀 Getting Started

### 🌟 Prerequisites

- Node.js 20 or later
- npm
- At least one supported model provider and API key

### ⚡ Installation

```bash
git clone https://github.com/ling-kong-ran/vesper.git
cd vesper
npm install
```

### 🔆 Usage

#### Web

Start the development server:

```bash
npm run dev
```

When the server is ready, the terminal clearly prints its URL. Open `http://127.0.0.1:5173` in a browser. Vesper does not create a browser tab by default; set `VESPER_OPEN_BROWSER=1` to opt into automatic browser launching.

On startup, the Web app compares its current Git commit with GitHub `main` instead of waiting for a Release tag. When remote commits have not been synced, the number of missing commits appears at the bottom of the left navigation; click it to review the comparison. The check is informational only: it does not force a refresh, download files, or overwrite local source code.

Commit or stash local changes before updating the source, then run:

```bash
git pull
npm install
```

Create and run a production Web build:

```bash
npm run build
npm start
```

Vesper stores local configuration and runtime data in `~/.vesper/agent` by default. Set `VESPER_AGENT_DIR` to use another location.

#### Desktop

Start or package the desktop app:

```bash
npm run desktop:dev
npm run desktop:pack
```

The desktop app checks for updates shortly after startup and shows new-version status in the left navigation. Updates are never downloaded automatically; the user chooses when to download and can review the release notes in the app.

To publish a release, the script updates and commits `package.json` and `package-lock.json`, creates a Git tag, then lets GitHub Actions generate the release notes and publish Windows, macOS, and Linux packages:

```bash
npm run release -- patch
# minor, major, or an explicit version such as 1.2.0 are also supported
```

### 🌠 Testing

```bash
npm run lint
npm test
npm run build
```

The test suite uses the Node.js built-in test runner and lives under `server/tests/`.

---

## 🤝 Contributing

Issues and pull requests are welcome:

- [Report an issue](https://github.com/ling-kong-ran/vesper/issues)
- [Open a pull request](https://github.com/ling-kong-ran/vesper/pulls)
- [View contributors](https://github.com/ling-kong-ran/vesper/graphs/contributors)

Before submitting a change, run the lint, test, and build commands above. Do not commit API keys, bot credentials, local session data, or files from `~/.vesper/agent`.

---

## ✨ Acknowledgments

Vesper is built on the [Pi Coding Agent](https://github.com/earendil-works/pi/tree/main/packages/coding-agent) runtime and the open-source libraries listed above.

<div align="right">

[![][back-to-top]](#top)

</div>

[back-to-top]: https://img.shields.io/badge/-BACK_TO_TOP-151515?style=flat-square
