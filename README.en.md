<p align="right"><a href="./README.md">简体中文</a> · <strong>English</strong></p>

<a id="top"></a>

<p align="center">
  <img src="docs/brand/vesper-logo.svg" width="112" alt="Vesper project logo" />
</p>

<h1 align="center">Vesper</h1>

<p align="center"><strong>When daylight fades, ideas stay awake.</strong></p>
<p align="center">A local-first multi-agent workspace where conversations, tools, memory, and workflows move together in one constellation.</p>

<p align="center">
  <img src="https://img.shields.io/badge/Node.js-17141F?style=flat-square&logo=nodedotjs&logoColor=F59E0B" alt="Node.js" />
  <img src="https://img.shields.io/badge/React-17141F?style=flat-square&logo=react&logoColor=F59E0B" alt="React" />
  <img src="https://img.shields.io/badge/Electron-17141F?style=flat-square&logo=electron&logoColor=F59E0B" alt="Electron" />
  <img src="https://img.shields.io/badge/Vite-17141F?style=flat-square&logo=vite&logoColor=F59E0B" alt="Vite" />
  <img src="https://img.shields.io/badge/i18next-17141F?style=flat-square&logo=i18next&logoColor=F59E0B" alt="i18next" />
</p>

<p align="center">
  <a href="#about">The Evening Star</a> ·
  <a href="#glance">Vesper at a Glance</a> ·
  <a href="#capabilities">Constellation of Capabilities</a> ·
  <a href="#architecture">Code Map</a> ·
  <a href="#start">Begin Here</a> ·
  <a href="#contributing">Contributing</a>
</p>

---

<a id="about"></a>

## ✦ The Evening Star

**Vesper** takes its name from evening—and from the first star to appear at dusk.

When the noise of daylight recedes, a small light remains beside unfinished work. Vesper is built to be that kind of presence: quiet, lucid, and always within reach, gathering scattered models, tools, and context into a workspace you can see, control, and continue to shape.

Vesper is a **local-first multi-agent workspace**. Run independent sessions in parallel, each with its own model, permissions, context, and working directory. Arrange them in an IDE-style workspace with draggable tabs, `Split Left` / `Split Right`, adjustable panes, and layouts that restore automatically.

> Let every agent follow its own orbit, and every thought find a place to return to.

- **Parallel without disorder** — Sessions stay independent, with clear state, context, and permissions.
- **Automation without overreach** — Schedules and workflows carry repetitive work; sensitive actions remain yours to approve.
- **Memory without noise** — Preferences, facts, decisions, and file relationships settle into local, durable memory.
- **Connection without surrender** — MCP, plugins, and channels expand the workspace while staying inside visible permission boundaries.

---

<a id="glance"></a>

## ✦ Vesper at a Glance

![Vesper product demo](./docs/show.gif)

<table>
  <tr>
    <td width="50%" align="center">
      <img src="./docs/shots/chat-grid.png" alt="Vesper multi-session dock workspace" />
      <br />
      <sub><strong>Dock workspace</strong> · Run tasks in parallel with tabs, splits, and drag-to-dock panels</sub>
    </td>
    <td width="50%" align="center">
      <img src="./docs/shots/memory.png" alt="Vesper memory view" />
      <br />
      <sub><strong>Memory</strong> · Keep meaningful thoughts and decisions glowing within reach</sub>
    </td>
  </tr>
  <tr>
    <td width="50%" align="center">
      <img src="./docs/shots/workflow-builder.png" alt="Vesper workflow builder" />
      <br />
      <sub><strong>Workflows</strong> · Turn an idea into a reusable path that can run</sub>
    </td>
    <td width="50%" align="center">
      <img src="./docs/shots/channels.png" alt="Vesper channels view" />
      <br />
      <sub><strong>Two-way channels</strong> · Bring Vesper into Feishu and personal Weixin</sub>
    </td>
  </tr>
</table>

---

<a id="capabilities"></a>

## ✦ Constellation of Capabilities

| Area | Capability |
| :--- | :--- |
| **Multi-session chat** | Run independent Agent sessions in parallel with distinct models, permissions, context, and working directories, plus tab groups, left/right splits, drag-to-dock panels, resizing, and layout restoration. |
| **Agent Runtime** | Built on Pi Coding Agent with permission controls, structured tool activity, goals, reusable skills, and isolated subagent delegation. |
| **Tools & MCP** | Bring built-in tools, application plugins, and MCP services into one capability layer, with credential-safe structured configuration. |
| **Memory** | Store preferences, facts, decisions, and tasks in lightweight local SQLite memory, scoped by workspace and searchable, editable, or captured from conversations. |
| **Multimodal** | Read images, documents, and code, then generate or edit visual content through configured OpenAI-compatible, Gemini, Imagen, Veo, or xAI models. |
| **Automation** | Let scheduled tasks and visual workflows carry repetitive work with model selection, retries, timeouts, failure policies, run history, and notifications. |
| **Two-way channels** | Connect Feishu and personal Weixin with per-channel reply models, workspace routing, attachments, and reusable notification templates. |
| **Desktop app** | Use a native Electron window with single-instance behavior, branded icons, in-app release notes, and GitHub Releases update support. |
| **Security boundaries** | Per-session permission modes, approval gates for sensitive actions, server-side secret redaction, and local user data stored outside the repository. |

---

<a id="architecture"></a>

## ✦ Code Map

```text
vesper/
├─ .github/              # CI, release notes, and cross-platform releases
├─ docs/                 # Documentation, screenshots, and brand assets
├─ electron/             # Electron main process and secure preload
├─ public/               # Public static assets
├─ scripts/              # Icon generation, packaging, and release scripts
├─ shared/               # Workflow graph logic shared by client and server
├─ server/
│  ├─ http/              # HTTP API, SSE, and static responses
│  ├─ prompts/           # Agent system prompts and runtime identity
│  ├─ runtime/           # Pi Agent session and model runtime
│  ├─ security/          # Credential and output redaction
│  ├─ services/          # Channels, memory, workflows, and integrations
│  ├─ storage/           # Local persistence helpers
│  ├─ tests/             # Node.js test suites
│  └─ tools/             # Built-in and application tool registry
└─ src/
   ├─ app/               # Routing, navigation, branding, and localization
   ├─ assets/            # Frontend static assets
   ├─ components/        # Shared React components
   ├─ features/          # Feature pages and interactions
   ├─ hooks/             # Shared React hooks
   └─ lib/               # API and formatting utilities
```

---

<a id="start"></a>

## ✦ Begin Here

### Prerequisites

- Node.js 20 or later
- npm
- At least one supported model provider and API key

### Installation

```bash
git clone https://github.com/ling-kong-ran/vesper.git
cd vesper
npm install
```

### Web

Start the development server:

```bash
npm run dev
```

When the service is ready, the terminal prints its URL clearly. Open `http://127.0.0.1:5173` in a browser. Vesper does not create a browser tab by default; set `VESPER_OPEN_BROWSER=1` if you want it to open automatically.

On startup, the Web app compares its current Git commit with GitHub `main` rather than waiting for a Release tag. If remote commits have not been synced, the number of missing commits appears at the bottom of the left navigation; click it to review the difference. The check is informational only: it never forces a refresh, downloads files, or overwrites local source code.

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

### Desktop

Start or package the desktop app:

```bash
npm run desktop:dev
npm run desktop:pack
```

The desktop app checks for updates shortly after startup and shows new-version status in the left navigation. Updates are never downloaded automatically; the user chooses when to begin and can review the release notes first.

To publish a release, the script updates and commits `package.json` and `package-lock.json`, creates a Git tag, then lets GitHub Actions generate release notes and publish Windows, macOS, and Linux packages:

```bash
npm run release -- patch
# minor, major, or an explicit version such as 1.2.0 are also supported
```

### Local Data

Vesper stores configuration, conversations, memory, and runtime data in:

```text
~/.vesper/agent
```

Set `VESPER_AGENT_DIR` to use another location.

### Verification

```bash
npm run lint
npm test
npm run build
```

The test suite uses the Node.js built-in test runner and lives under `server/tests/`.

---

<a id="contributing"></a>

## ✦ Walk with Vesper

Issues and pull requests are welcome:

- [Report an issue](https://github.com/ling-kong-ran/vesper/issues)
- [Open a pull request](https://github.com/ling-kong-ran/vesper/pulls)
- [View contributors](https://github.com/ling-kong-ran/vesper/graphs/contributors)

Before submitting a change, run the lint, test, and build commands above. Do not commit API keys, bot credentials, local session data, or any files from `~/.vesper/agent`.

---

<a id="acknowledgements"></a>

## ✦ Acknowledgments · Where the Light Comes From

Vesper is built on the [Pi Coding Agent](https://github.com/earendil-works/pi/tree/main/packages/coding-agent) runtime and illuminated by open-source projects including Node.js, React, Electron, Vite, and i18next.

<p align="right"><a href="#top">Back to top ↑</a></p>
