# Hello Electron!

一个简单的 Electron 应用程序（Pecado AI 界面）。

## 项目结构

```
firstElectron/
├── assets/icons/          # 打包用图标等资源
├── config/                # electron-builder 等构建配置
├── src/
│   ├── main/              # 主进程入口 + bootstrap/ config/ prompts/ agent/ llm-volc/ mcp-filesystem/ xcode/
│   ├── preload/           # preload.js
│   ├── shared/            # ipc-channels.js、format-tree.js（主进程 + 渲染进程共用）
│   ├── renderer/          # html/、css/、js/（纯 UI + 薄 IPC 客户端）
│   └── electron/          # init 环境、shell 启动、window 调试脚本
├── release/               # electron-builder 输出目录（npm run build）
├── package.json
└── README.md
```

## 安装依赖

```bash
npm install
```

如需国内镜像，可在环境变量中设置 `ELECTRON_MIRROR`（参见 `package.json` 的 `config` 字段）。

## 运行应用

```bash
npm start
```

或使用 shell 脚本（从仓库根目录执行）：

```bash
chmod +x src/electron/shell/quick-start.sh
./src/electron/shell/quick-start.sh
```

## 开发

- 界面：`src/renderer/html/app.html`、`src/renderer/css/app.css`、`src/renderer/js/chat.js`
- 豆包密钥：`npm run env:init` 后编辑根目录 `.env` 填 `VOLC_ARK_API_KEY`，或复制 `config/secrets.example.json` 为 `config/secrets.json`
- 主进程：`src/main/main.js`、`src/main/agent/router.js`（选模式 + 对话入口）
- Preload：`src/preload/preload.js`；通道名：`src/shared/ipc-channels.js`

## 构建打包

```bash
npm run build
```

产物在 `release/` 目录。

## 技术栈

- **Electron**: 见 `package.json` 中 `devDependencies`
- **markdown-it**、**highlight.js**（preload 内 Markdown 渲染，仅注册 cpp 语法）

---

## 对话架构（摘要）

```
渲染进程 chat.js
  ↓ runBotAgent → volcArkBotsChatStream({ streamId, userText, history })
主进程 agent/router.js
  ├─ MCP 已连接 → agent 模式 → agent/agent-loop.js（Function Calling 多轮）
  ├─ 未连接但有工程上下文 → context 模式 → agent/plain-stream.js
  └─ 否则 → plain 模式 → agent/plain-stream.js
  ↓ llm-volc/（HTTP + SSE）
火山方舟 Bots Chat Completions（stream: true）
  ↓ BOTS_STREAM_EVENT 推送
渲染进程实时 Markdown 渲染（preload renderMarkdown + chat.js rAF 节流）
```

### 对话模式（主进程自动选择）

| 模式 | 条件 | 行为 |
|------|------|------|
| **agent** | File → Open Folder 后 MCP 已连接 | SSE + MCP tools 多轮 Function Calling |
| **context** | 未 Open Folder，但有本地工程上下文 | SSE + system 拼 directory_tree / 关键文件 |
| **plain** | 无工程上下文 | 纯 SSE 对话 |

System 提示词见 `src/main/prompts/`（`agent.js` / `default.js`）。

### MCP 文件系统

1. 菜单 **File → Open Folder** 选择工程根目录（主进程 `mcp-filesystem/ipc.js`）
2. 主进程拉起 `@modelcontextprotocol/server-filesystem` 子进程
3. 渲染进程收到 `PROJECT_CHANGED`，展示目录树气泡（`renderer/js/index.js`）
4. Agent 模式下工具读写经主进程 `mcp-filesystem/` + `agent/tool-executor.js`

macOS 新建文件/目录时可弹窗加入 Xcode 工程（`main/xcode/`）。

### 相关文件一览

| 能力 | 主要文件 |
|------|-----------|
| 选模式 + 对话入口 | `src/main/agent/router.js` |
| Agent 多轮 tool calling | `src/main/agent/agent-loop.js` |
| 纯 SSE 对话 | `src/main/agent/plain-stream.js` |
| 火山 HTTP/SSE | `src/main/llm-volc/` |
| MCP 子进程与读写 | `src/main/mcp-filesystem/` |
| Open Folder 菜单 | `src/main/mcp-filesystem/ipc.js` |
| 工程上下文拼 system | `src/main/mcp-filesystem/project-context.js` |
| Xcode 集成 | `src/main/xcode/` |
| 助手指令（如打开 QQ 音乐） | `src/main/agent/agent-commands.js` |
| 渲染 UI + 流式 Markdown | `src/renderer/js/chat.js` |
| IPC 客户端 | 内联于 `src/renderer/js/chat.js`（`runBotAgent`） |
| Preload API | `src/preload/preload.js` |
| IPC 通道名 | `src/shared/ipc-channels.js` |
| 目录树 ASCII 格式化 | `src/shared/format-tree.js` |
