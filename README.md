# Pi Coder

Pi Coder 是基于 React、Vite 和 `@earendil-works/pi-coding-agent` 的桌面式 Agent 工作台。

## 开发

```bash
npm install
npm run dev
```

默认地址为 `http://127.0.0.1:5173`。生产构建使用：

```bash
npm run build
npm start
```

## 目录结构

```text
server/
├── index.mjs                    # 服务入口与生命周期
├── http/                        # API、SSE 和静态资源响应
├── runtime/                     # Agent 会话与模型运行时
├── services/                    # 跨请求领域服务
├── storage/                     # 配置和数据持久化工具
└── tools/
    ├── builtin-catalog.mjs      # Pi 内置工具元数据和预设
    ├── registry.mjs             # 应用工具统一注册表
    └── app/                     # Pi Coder 自己实现的工具

src/
├── app/                         # 导航和应用级配置
├── components/                  # 通用 UI 组件
├── features/                    # 按业务功能组织的页面与逻辑
├── lib/                         # API、格式化等无 UI 依赖模块
├── App.jsx                      # 应用外壳和未迁移页面
└── main.jsx                     # 前端入口
```

## 添加应用工具

1. 在 `server/tools/app/` 中为工具创建独立文件。
2. 导出工具 `manifest` 和 `create...Tool(context)` 工厂。
3. 在 `server/tools/app/index.mjs` 注册 manifest 与工厂。
4. 插件页面会从服务端注册表读取工具，无需在前端重复维护目录。

工具使用 `defineTool()` 定义，并通过 `customTools` 注入 Agent。权限状态由 `ToolPluginService` 保存；`agent-runtime` 只负责按当前会话工作目录创建已启用工具。

`visual-generate.mjs` 展示了如何把领域服务注入工具。视觉模型调用分别位于 `server/services/visual-generation/` 的模型选择、OpenAI 兼容、Google 和输出模块中。新增高风险工具时，应准确填写 `risk`、`scope` 和 `capability`，并默认保持关闭。

## 视觉生成工具

`generate_visual` 会从已启用且已配置认证的视觉模型中自动选模，也可以由 Agent 指定 `provider/model`。配置页添加模型时将“模型用途”设为图像生成或视频生成即可；常见的 GPT Image、Sora、Gemini/Imagen、Veo 和 Grok Imagine 模型 ID 也能自动识别。

- OpenAI、xAI 及兼容服务通过 Images/Videos 兼容接口调用。
- Gemini/Imagen 使用 `generateContent`，Veo 使用长任务接口并自动轮询下载。
- OpenRouter 图像模型通过带 `image` modality 的 Chat Completions 调用。
- 结果写入会话工作目录的 `generated/visuals/`，同时加入资产索引。
- 生成完成后通过 SSE 追加到当前 Agent 回复，图片直接展示、视频直接播放；重新打开历史会话时会从资产索引恢复。

该工具会消耗外部 Provider 额度并写文件，因此默认保持关闭，需要在插件页手动启用。

## 双向渠道

渠道页只提供能够与 Agent 双向通信的平台连接，不提供单向 Webhook。目前支持：

- 飞书应用机器人：调用飞书官方 Node SDK 的一键注册能力，扫码确认后自动创建机器人应用，并通过 WebSocket 长连接接收私聊或群聊 @ 消息。无需手工填写 App ID、App Secret，也不需要公网 IP、域名或回调地址。
- 个人微信：使用腾讯官方 iLink Bot 协议扫码登录，通过 `getupdates` 持续长轮询接收私聊消息，并使用同一连接回复文字、图片、视频和文件。它不是企业微信，也不是 WebSocket 帧传输。

每个渠道中的聊天对象会映射到独立的 Pi Coder 会话，文字、图片和文档可以交给 Agent 分析，Agent 生成的媒体和文件也会回传原渠道。默认仅允许扫码创建者使用；每个渠道可以分别设置访问范围、新会话工作目录和回复模型。修改回复模型不会重建渠道连接，后续消息会在对应 Agent 会话中切换到所选模型。

渠道页还提供可复用的事件通知模板。目前内置定时任务完成/失败、工作流完成/失败四类事件。每类事件可以分别为飞书和微信设置内容，发送时会自动定位该渠道最近活跃的会话，无需维护接收人列表。模板支持 `{{task.name}}`、`{{workflow.runId}}` 等变量，并提供预览和测试发送。后续业务服务可通过 `AgentRuntimeService.notifyChannels(event, data)` 触发通知。

## 用户数据

Provider、模型、工具权限、会话、资产和渠道默认保存在用户目录下的 Pi Agent 配置目录中；可通过 `PI_CODING_AGENT_DIR` 覆盖。飞书/微信登录凭据、渠道级模型设置、会话映射和通知模板位于 `pi-coder-channels.json`，接口只返回脱敏信息。不要把 API Key、Bot Token 或应用密钥写入仓库文件。
