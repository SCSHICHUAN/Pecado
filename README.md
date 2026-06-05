# Pecado

基于 Electron 的桌面 AI 编程助手：对接**火山方舟 Bots** 流式对话，支持本地工程 **MCP 文件系统**、**Function Calling 多轮 Agent**，以及在 macOS 上将生成代码**实时写入磁盘并集成 Xcode 工程**。

---

## 功能概览

| 能力 | 说明 |
|------|------|
| **流式对话** | SSE 增量输出，渲染进程 Markdown 实时渲染（markdown-it + highlight.js） |
| **三种对话模式** | plain（纯聊）/ context（拼工程上下文）/ agent（MCP tools 多轮）— 主进程自动选择 |
| **Open Folder** | 菜单打开工程目录，拉起 MCP server-filesystem，展示目录树 |
| **Agent 工具** | read / write / edit / create_directory 等，经主进程沙箱执行 |
| **Xcode 集成**（macOS） | 新建文件流式落盘、弹窗加入 `.xcodeproj`、自动 `open` Xcode |
| **本地指令** | 助手 JSON 指令（如打开 QQ 音乐）— `agent-commands.js` |

---

## 依赖包

### 运行时（`dependencies`）

| 包 | 用途 |
|----|------|
| [`@modelcontextprotocol/sdk`](https://www.npmjs.com/package/@modelcontextprotocol/sdk) | MCP 客户端：stdio 传输、`callTool` / `listTools`（`mcp-filesystem/mcp-transport.js`） |
| [`@modelcontextprotocol/server-filesystem`](https://www.npmjs.com/package/@modelcontextprotocol/server-filesystem) | MCP 文件系统服务端：由主进程 spawn 子进程，限定在 Open Folder 目录内读写 |
| [`markdown-it`](https://www.npmjs.com/package/markdown-it) | Preload 内将助手回复渲染为 HTML（`preload/preload.js` → `renderMarkdown`） |
| [`highlight.js`](https://www.npmjs.com/package/highlight.js) | 代码块语法高亮（Preload 仅注册 `cpp`，未知语言 fallback） |
| [`xcode`](https://www.npmjs.com/package/xcode) | 解析/修改 `project.pbxproj`，将新建源文件/目录加入 Xcode 工程（`main/xcode/project.js`） |

HTTP/SSE 请求使用 Node/Electron 内置 **`fetch`**，未额外引入 axios 等。

### 开发 / 打包（`devDependencies`）

| 包 | 用途 |
|----|------|
| [`electron`](https://www.npmjs.com/package/electron) | 桌面壳：主进程、BrowserWindow、IPC |
| [`electron-builder`](https://www.npmjs.com/package/electron-builder) | `npm run build` 打包；配置见 `config/electron-builder.json` |

---

## 项目结构

```
pecado/
├── assets/icons/              # 打包图标等
├── config/                    # electron-builder、secrets.example.json
├── src/
│   ├── main/
│   │   ├── main.js            # 主进程入口
│   │   ├── bootstrap/         # load-env（.env / secrets.json）
│   │   ├── config/            # 火山 API 凭证 volc-user-config.js
│   │   ├── prompts/           # plain/context / agent system 提示词
│   │   ├── llm-server/        # 火山 HTTP/SSE + 消息/tools 格式化
│   │   ├── agent/             # 路由、Agent 循环、tool 执行、UI 流推送
│   │   ├── mcp-filesystem/    # MCP 连接、读写、Open Folder IPC、工程上下文
│   │   └── xcode/             # macOS 流式写盘 + pbxproj 集成
│   ├── preload/preload.js     # contextBridge → window.electronAPI
│   ├── shared/                # ipc-channels.js、format-tree.js（双端共用）
│   ├── renderer/              # html/、css/、js/（对话 UI）
│   └── electron/init/         # npm run env:init
├── release/                   # electron-builder 输出
├── package.json
└── README.md
```

各源文件开头有 **【功能 / 调用方 / 对外能力】** 说明，便于跳转阅读。

> 仓库中 `llm-volc/`、`features/volc/`、`project-io/` 等为历史遗留目录，**当前未接入** `main.js`，以 `llm-server/` + `mcp-filesystem/` 为准。

---

## 安装与运行

```bash
npm install
npm start          # 或 npm run dev
```

国内 Electron 镜像可在环境变量中设置 `ELECTRON_MIRROR`（见 `package.json` → `config.electron_mirror`）。

Shell 启动（可选）：

```bash
chmod +x src/electron/shell/quick-start.sh
./src/electron/shell/quick-start.sh
```

打包：

```bash
npm run build      # 产物在 release/
```

---

## 配置 API 密钥

任选其一（优先级：环境变量 > `config/secrets.json` > userData JSON）：

1. **推荐**：`npm run env:init` 生成根目录 `.env`，填写：
   ```env
   VOLC_ARK_API_KEY=你的密钥
   VOLC_ARK_MODEL=bot-xxxx   # 可选，默认见 volc-user-config.js
   ```
2. 复制 `config/secrets.example.json` → `config/secrets.json`，填 `volcArkApiKey`
3. 应用 userData 内 `volc-user-config.json`（若后续接入设置页）

运行时由 `bootstrap/load-env.js` 合并进 `process.env`；每次发消息前 router 会再次加载以刷新密钥。

---

## 架构

### 分层职责

| 层 | 目录 | 职责 |
|----|------|------|
| **渲染** | `renderer/` + `preload/` | 对话 UI、IPC 客户端、Markdown 渲染 |
| **Agent** | `main/agent/` | 模式路由、多轮 tool 编排、tool 执行、推流到 UI |
| **LLM** | `main/llm-server/` | 火山 HTTP/SSE **吞吐**；messages / mcpTools **格式化**（agent 只传原始数据） |
| **工程 I/O** | `main/mcp-filesystem/` | MCP 子进程、读写的路径沙箱、Open Folder |
| **Xcode** | `main/xcode/` | macOS 流式写文件、pbxproj、确认对话框 |

### 对话数据流

```
renderer/js/chat.js
  ↓ volcArkBotsChatStream({ streamId, userText, history })
main/agent/router.js          ← 选 plain | context | agent
  ├─ agent  → agent/agent-loop.js → llm-server/streamChat + tool-executor
  ├─ context/plain → agent/plain-stream.js → llm-server/collectPlainChat
  ↓
llm-server/  →  火山方舟 Bots Chat Completions (stream: true)
  ↓ VOLC_ARK.BOTS_STREAM_EVENT
renderer  ← preload renderMarkdown + chat.js 流式跟读
  ↓ 回合结束
agent-commands（可选 JSON 指令，如打开 QQ 音乐）
```

### 对话模式（自动选择）

| 模式 | 条件 | 行为 |
|------|------|------|
| **agent** | File → Open Folder 后 MCP 已连接 | SSE + MCP tools，最多 12 轮 Function Calling |
| **context** | 未 Open Folder，但能读到工程上下文 | SSE + system 附加 directory_tree / 关键文件 / @path |
| **plain** | 无工程上下文 | 单轮 SSE 纯对话 |

System 提示词：`src/main/prompts/agent.js`、`default.js`。

### MCP 与 Xcode

1. **File → Open Folder**（`mcp-filesystem/ipc.js`）选择工程根
2. 主进程 spawn `@modelcontextprotocol/server-filesystem`，持久化路径至 userData
3. 渲染进程 `PROJECT_CHANGED` → `renderer/js/index.js` 展示目录树气泡
4. Agent 模式：`listTools` → llm-server 转 Function Calling schema → 模型调 tool → `tool-executor` 执行
5. macOS：`write_file` 可流式写入磁盘；新建路径弹窗选择是否加入 Xcode（`xcode/prompt.js` + `xcode/project.js`）

---

## 主要文件索引

| 能力 | 文件 |
|------|------|
| 主进程入口 | `src/main/main.js` |
| 模式路由 + IPC | `src/main/agent/router.js` |
| Agent 多轮循环 | `src/main/agent/agent-loop.js` |
| 流事件消费 / write_file 解析 | `src/main/agent/agent-stream-consumer.js` |
| plain/context 单轮 | `src/main/agent/plain-stream.js` |
| Tool 执行 | `src/main/agent/tool-executor.js` |
| 推流到渲染进程 | `src/main/agent/stream-ui.js` |
| 本地 JSON 指令 | `src/main/agent/agent-commands.js` |
| 火山 HTTP/SSE | `src/main/llm-server/` |
| MCP 读写 + 门面 | `src/main/mcp-filesystem/` |
| Open Folder 菜单 | `src/main/mcp-filesystem/ipc.js` |
| 工程上下文拼 system | `src/main/mcp-filesystem/project-context.js` |
| Xcode 集成 | `src/main/xcode/` |
| 对话 UI | `src/renderer/js/chat.js` |
| Preload API | `src/preload/preload.js` |
| IPC 通道常量 | `src/shared/ipc-channels.js` |
| 目录树 ASCII | `src/shared/format-tree.js` |

---

## 开发提示

- **改 IPC 通道名**：只改 `src/shared/ipc-channels.js`，同步 preload 与主进程
- **改 LLM 适配**：优先改 `llm-server/`，agent 不应直接做 messages sanitize
- **改 tool 行为**：`agent/tool-executor.js` + `mcp-filesystem/`
- **界面**：`renderer/html/app.html`、`css/app.css`、`js/chat.js`
- **macOS 滚动条**：`main.js` 已 `disable-features=OverlayScrollbar`，配合 `app.css` 自定义轨道

## License

MIT
