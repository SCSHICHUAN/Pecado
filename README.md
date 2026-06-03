# Hello Electron!

一个简单的 Electron 应用程序（Pecado AI 界面）。

## 项目结构

```
firstElectron/
├── assets/icons/          # 打包用图标等资源
├── config/                # electron-builder 等构建配置
├── src/                   # 全部应用源码
│   ├── main/              # 主进程：main.js、ipc/、mcp/（MCP 与 Xcode 集成）
│   ├── preload/           # preload.js、mcp-bridge.js
│   ├── shared/            # ipc-channels.js（QQ / 火山方舟通道）
│   ├── renderer/          # app.html、chat.js、volc-chat.js、mcp/（前端 MCP 客户端）
│   └── scripts/           # init-env、shell 启动、electron 调试小脚本
├── release/               # electron-builder 输出目录（npm run build）
├── package.json
└── README.md
```

## 安装依赖

```bash
npm install
```

如需国内镜像，可在环境变量中设置 `ELECTRON_MIRROR`（参见 `package.json` 的 `config` 字段），或使用 `npm config set electron_mirror ...`。

## 运行应用

```bash
npm start
```

或使用 shell 脚本（从仓库根目录执行）：

```bash
chmod +x src/scripts/shell/start.sh src/scripts/shell/quick-start.sh
./src/scripts/shell/quick-start.sh
```

## 开发

- 编辑 `src/renderer/app.html`、`app.css`、`chat.js`、`volc-chat.js`、`command-handlers.js` 修改界面与对话（助手回复为 **流式豆包 + 实时 Markdown**，见下文「豆包流式对话与 Markdown」）
- 豆包 bots：① `npm run env:init` 后编辑根目录 `.env` 填 `VOLC_ARK_API_KEY`（勿留空行值）② 或复制 `config/secrets.example.json` 为 `config/secrets.json` 填 `volcArkApiKey`。发消息前会重新加载环境文件；终端见 `[env]` 日志
- 编辑 `src/main/main.js`（窗口与生命周期）、`src/main/ipc/`（主进程 IPC 实现）
- 编辑 `src/preload/preload.js`（向页面暴露的安全 API）、`src/shared/ipc-channels.js`（通道名常量）

## 构建打包

```bash
npm run build
```

产物在 `release/` 目录。

## 技术栈

- **Electron**: 见 `package.json` 中 `devDependencies`
- **HTML / CSS / JavaScript**
- **markdown-it**、**highlight.js**（`dependencies`）：Markdown 解析 + 代码围栏高亮（preload 内仅注册 **cpp**）

---

## 豆包流式对话与 Markdown 实时渲染（实现摘要）

本仓库在 **主进程** 调用火山方舟 **Bots Chat Completions** 接口时使用 **`stream: true`**，通过 **SSE（`data:` 行）** 解析增量；**密钥与 `fetch` 仅存在于主进程**，渲染进程不接触 API Key。

### 主进程（`src/main/ipc/ark-chat.js`）

- 每次 IPC 前会按 `load-env.js` 的规则合并 `.env` / `config/secrets.json`，并回退到 `volc-user-config.js` 的 `getResolvedApiKey()` / `getResolvedModel()`。
- 对 `https://ark.cn-beijing.volces.com/api/v3/bots/chat/completions` 发起 **流式 POST**，用 `ReadableStream` 按行解析：
  - 支持标准 **`data: {json}`** SSE；
  - 兼容 **整行即一条 JSON** 的 NDJSON。
- 从每条 JSON 中取出 **`choices[0].delta.content`**（及常见变体）作为增量文本。
- 通过 **`webContents.send`** 向当前窗口推送 **`VOLC_ARK.BOTS_STREAM_EVENT`**（载荷含 `streamId`、`phase: 'delta' | 'error'`、`text` / `error`）。
- 同一 IPC **`invoke`**（`VOLC_ARK.BOTS_CHAT_COMPLETION`）在流完全结束后返回 **`{ content: 全文 }`** 或 **`{ error }`**，便于与指令解析等收尾逻辑对齐。

### Preload（`src/preload/preload.js`）

- **`volcArkBotsChatStream(messages, streamId)`**：`invoke` 启动流式请求（必须带 `streamId` 以便与事件关联）。
- **`onVolcArkStreamEvent(callback)`**：订阅主进程推送的流事件，返回 **取消订阅函数**。
- **`renderMarkdown(src)`**：使用 **markdown-it**（**`html: false`**、**`linkify: false`**、**`breaks: true`**）生成 HTML；围栏代码由 **highlight.js** 着色——仅注册 **C++** 语法，**未标注或不受支持的语言一律按 C++ 规则高亮**。主题使用 **`github-dark.min.css`**（在 `app.html` 中相对路径链入）。**不在渲染进程 `require` 依赖**，便于与 `contextIsolation` 搭配。

### 渲染进程（`src/renderer/volc-chat.js` + `chat.js`）

- **`volc-chat.js`**：生成 `streamId`，先注册 `onVolcArkStreamEvent`，再 `invoke`；可选 **`onDelta`** 回调；最终仍返回 **`{ content }` / `{ error }`**（与 `complete()` 兼容）。
- **`chat.js`**：
  - 流式阶段用 **`requestAnimationFrame` 节流**：同一帧内多次 `delta` 合并为一次 **`renderMarkdown(累积文本)`**，更新助手气泡 **`innerHTML`**，并加上 **`markdown-body`** 样式类，实现 **边下边排版**（标题、代码块、列表等实时跟进）。每次渲染后为每个 **`<pre>`** 外包 **`code-block-wrap`**，并加 **「复制」** 按钮（优先 **`navigator.clipboard.writeText`**，失败则 **`execCommand('copy')`**）；给 **`code`** 增加 **`hljs`** 类以匹配主题。
  - 流结束后 **`cancelAnimationFrame`**，避免最后一帧覆盖最终展示；再执行 **`command-handlers.js`** 的 **`handleAssistantContent`**（如 JSON 指令打开 QQ 音乐），最后用 **`setAssistantBubbleMarkdown`** 刷新为处理后的文案。
- **用户消息**仍为纯文本 **`textContent`**，不对用户输入做 HTML 渲染。

### 样式（`src/renderer/app.css` + `app.html`）

- **`.message-bubble.markdown-body`** 下对 `h1–h4`、列表、`hr`、`blockquote`、`table`、`a` 等做了暗色主题适配。
- **代码块**：`github-dark`（hljs）+ **`.code-block-wrap` / `.code-copy-btn`**（与 `pre` 内边距配合，避免文字与按钮重叠）。

### 共享常量（`src/shared/ipc-channels.js`）

- **`VOLC_ARK.BOTS_CHAT_COMPLETION`**：`invoke` 通道名。
- **`VOLC_ARK.BOTS_STREAM_EVENT`**：主进程 → 渲染进程 **单向推送** 通道名（与 `invoke` 分离）。

### 构建（`config/electron-builder.json`）

- 打包 **`dependencies`**（含 **markdown-it**、**highlight.js** 等），preload 在成品应用中可正常 **`require('markdown-it')`** / **`require('highlight.js/...')`**；请勿再排除整个 **`node_modules`**，否则流式、Markdown 与高亮会在安装包内失效。

### 相关文件一览

| 能力 | 主要文件 |
|------|-----------|
| SSE 流式请求与解析 | `src/main/ipc/ark-chat.js` |
| 环境变量与用户密钥回退 | `src/main/load-env.js`、`src/main/ipc/volc-user-config.js` |
| IPC 注册 | `src/main/main.js` |
| 暴露给页面的 API | `src/preload/preload.js` |
| 通道名 | `src/shared/ipc-channels.js` |
| 组装消息与订阅流 | `src/renderer/volc-chat.js` |
| Markdown、代码高亮与复制按钮 | `src/preload/preload.js`、`src/renderer/chat.js`（`enhanceAssistantCodeBlocks`）、`src/renderer/app.css`、`src/renderer/app.html`（hljs 主题） |
| 助手 JSON 指令 | `src/renderer/command-handlers.js` |

---

## MCP 文件系统 + 火山 Function Calling + Xcode 集成（2026-06 摘要）

Pecado AI 在本阶段接入了 **Anthropic MCP `server-filesystem`**，通过 **火山方舟 SSE 流式 API** 的 **Function Calling（结构化 tool 调用）** 读写本地工程，并在 macOS 上将代码 **实时写入磁盘 / Xcode**，以及 **自动加入 `.xcodeproj`**。

### MCP 依赖与 server-filesystem

`npm install` 会安装以下 MCP 相关依赖（见 `package.json`）：

| 包名 | 用途 |
|------|------|
| `@modelcontextprotocol/sdk` | 主进程 MCP 客户端（stdio 传输、listTools / callTool） |
| `@modelcontextprotocol/server-filesystem` | 官方 MCP 文件系统 Server，由主进程 **stdio 子进程** 拉起 |

主进程 **`filesystem-client.js`** 通过 `require.resolve('@modelcontextprotocol/server-filesystem/package.json')` 定位入口，以子进程方式启动 **server-filesystem**，并将用户 **Open Folder** 选中的目录作为唯一可访问根路径（沙箱）。无需单独安装或配置外部 MCP 服务。

### System 提示词（MCP 模式）

启用 MCP tools 时，渲染进程会把 **system 消息** 换成工程助手提示，而非默认的 `You are a helpful assistant.`：

| 文件 | 说明 |
|------|------|
| `src/renderer/mcp/prompts.js` | 定义 `MCP_TOOLS_SYSTEM`，挂载到 `window.mcpPrompts` |
| `src/renderer/volc-chat.js` | `useMcpTools: true` 时用 `MCP_TOOLS_SYSTEM` 作为 `messages[0].content` |
| `src/renderer/app.html` | 脚本顺序：`mcp/prompts.js` → `mcp/index.js` → `volc-chat.js`（须先加载 prompts） |

可在 `prompts.js` 中修改 system 文案，例如强调优先 `edit_file` / `write_file`、不要编造文件内容、新建时 Xcode 弹窗等。

未连接 MCP 时（未 Open Folder），仍走纯对话：`volc-chat.js` 使用默认 system，并可把 `mcp/index.js` 拼好的 **directory_tree + 关键文件** 作为 `projectContext` 追加进 system（只读上下文，无 Function Calling）。

### 如何启用 MCP 集成

1. 启动应用 → 菜单 **File → Open Folder**，选择工程根目录（建议选与 `.xcodeproj` 同级或包含它的目录）。
2. 主进程连接 server-filesystem 子进程；渲染进程收到 `mcp-fs-project-changed`，对话区展示 **directory_tree**。
3. 用户发消息时，`chat.js` 调用 `mcpClient.isMcpConnected()`；若为 `true`，则 `volcChat.runBotAgent(..., { useMcpTools: true })`。
4. 主进程 `ark-chat.js` 见 `useMcpTools` 后转 **`mcp/agent-loop.js`**：拉取 MCP tools → 火山 `stream:true` + `tools[]` → 多轮 tool calling。

未 Open Folder 时不会走 MCP Function Calling，仅普通豆包流式对话。

### 整体架构

```
用户对话
  ↓
渲染进程 chat.js / volc-chat.js
  ↓ IPC（VOLC_ARK.BOTS_CHAT_COMPLETION）
主进程 ark-chat.js
  ├─ useMcpTools=false → 纯 SSE 对话
  └─ useMcpTools=true  → mcp/agent-loop.js（Function Calling 循环）
         ↓
     火山方舟 stream:true + tools[]（由 MCP listTools 转换）
         ↓ SSE delta.tool_calls
     stream-tool-acc.js 解析 arguments JSON
         ├─ phase: tool_stream → 聊天气泡实时显示代码
         ├─ xcode-write-stream.js → 磁盘流式落盘（Xcode 监听刷新）
         └─ executeMcpTool → MCP filesystem / Xcode 工程引入
```

### MCP 模块（`src/main/mcp/`）

| 文件 | 职责 |
|------|------|
| `index.js` | MCP 统一入口：注册 IPC、菜单、导出方舟集成 API |
| `filesystem-client.js` | stdio 拉起 `@modelcontextprotocol/server-filesystem` 子进程 |
| `filesystem-ipc.js` | Open Folder、directory_tree、read/write、listTools |
| `ipc-channels.js` | MCP 专用 IPC 通道名 |
| `tools-schema.js` | MCP `listTools` → 火山 Function Calling `tools` 数组 |
| `agent-loop.js` | 多轮 tool calling 循环（最多 12 轮），全程 SSE |
| `stream-tool-acc.js` | 流式聚合 `tool_calls`，边收边解析 `write_file` 的 path/content |
| `tool-result.js` | MCP 工具结果格式化为 `role: tool` 消息 |
| `project-path.js` | 路径限制在已打开工程目录内 |
| `chat-integration.js` | 方舟对话与 MCP agent 循环的桥接 |
| `xcode-write-stream.js` | macOS：每片 delta 立即 write + fsync + close，供 Xcode 实时刷新 |
| `xcode-stream-target.js` | 解析 `@file.swift` 等流式写入目标；新/旧文件策略 |
| `sse-xcode-stream.js` | 非 MCP 纯对话时的 Xcode 流式写入 |
| `xcode-project.js` | 修改 `project.pbxproj`，将新文件/目录加入 Xcode 工程 |
| `xcode-prompt.js` | 创建文件/目录前弹窗：加入 Xcode / 仅磁盘 / 取消 |
| `app-menu.js` | macOS 菜单 File → Open Folder |
| `context.js` | 主窗口引用（弹窗挂到 Pecado 窗口） |

渲染进程 **`src/renderer/mcp/`**：目录树格式化、工程上下文注入、Open Folder 监听。  
Preload **`src/preload/mcp-bridge.js`**：暴露 `mcpFs*` / `onMcpFsProjectChanged` API。

### 火山引擎结构化请求

1. **Open Folder** 连接 MCP 后，`agent-loop.js` 调用 `listTools()`，经 `tools-schema.js` 转为火山兼容的 **`tools` 数组** 放进请求体。
2. 请求 **`stream: true`**，模型返回结构化 **`tool_calls`**（如 `list_directory`、`read_file`、`write_file`、`edit_file`、`create_directory`）。
3. 主进程执行 MCP 工具，结果以 **`role: tool`** 塞回 `messages`，继续下一轮直到模型输出最终文本。
4. 聊天 UI 通过 **`phase: delta` / `tool_stream`** 实时显示；气泡侧为前端 rAF + Markdown 渲染。

### Xcode 写入策略

| 场景 | 行为 |
|------|------|
| **新文件** + MCP `write_file` | SSE 边解析 `arguments` 边落盘；聊天与磁盘同节奏 |
| **已有文件** + `write_file` | 流式阶段不写盘（避免先清空）；工具结束时一次性替换 |
| **局部修改** | 优先 `edit_file`（MCP patch，非流式） |
| **纯对话 + `@path`** | 文本 delta 也可流式写入指定源码文件 |

落盘细节见 `xcode-write-stream.js`（无人为 80 字/16ms 节流；每片 delta 写完后关 fd，触发 FSEvents）。

### 加入 Xcode 工程

新建 **文件** 或 **目录** 时：

1. 弹窗询问：**加入 Xcode 工程** / **仅写入磁盘** / **取消**
2. 选「加入 Xcode」→ 用 **`xcode`** npm 包修改 **`project.pbxproj`**（PBXGroup + Compile Sources）
3. 分组带 `path` 时，文件引用只写 **basename**，避免路径叠两层导致 Xcode 文件名变红
4. 完成后 **`open *.xcodeproj`** 打开 Xcode

依赖：`xcode`（见 `package.json` `dependencies`）。

### 使用方式

1. 启动应用，`File → Open Folder` 选择 Xcode 工程根目录（与 `.xcodeproj` 同级或包含它的目录）
2. 对话区会展示 **directory_tree** 目录结构
3. 向 AI 描述需求；模型会自动调用 MCP 工具读/写代码
4. 新建文件/文件夹时会弹窗确认是否加入 Xcode

### MCP 相关文件一览

| 能力 | 主要文件 |
|------|-----------|
| MCP 子进程与工具调用 | `src/main/mcp/filesystem-client.js` |
| Open Folder / IPC | `src/main/mcp/filesystem-ipc.js`、`src/preload/mcp-bridge.js` |
| Function Calling 循环 | `src/main/mcp/agent-loop.js` |
| 流式 tool_calls 解析 | `src/main/mcp/stream-tool-acc.js` |
| 方舟入口 | `src/main/ipc/ark-chat.js` |
| Xcode 流式落盘 | `src/main/mcp/xcode-write-stream.js` |
| 加入 Xcode 工程 | `src/main/mcp/xcode-project.js`、`src/main/mcp/xcode-prompt.js` |
| 前端 MCP 客户端 | `src/renderer/mcp/index.js`、`src/renderer/mcp/prompts.js` |
| 是否启用 MCP tools | `chat.js` 检测 `mcpFsGetStatus().connected` → `useMcpTools: true` |
| MCP system 提示词 | `src/renderer/mcp/prompts.js` |
| server-filesystem 子进程 | `src/main/mcp/filesystem-client.js`（依赖 `@modelcontextprotocol/server-filesystem`） |
