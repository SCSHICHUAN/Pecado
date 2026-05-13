# Hello Electron!

一个简单的 Electron 应用程序（Pecado AI 界面）。

## 项目结构

```
firstElectron/
├── assets/icons/          # 打包用图标等资源
├── config/                # electron-builder 等构建配置
├── scripts/
│   ├── electron/          # 本地调试用的 Electron 小脚本
│   └── shell/             # 命令行快速启动脚本
├── src/                   # 全部应用源码
│   ├── main/              # 主进程：main.js、ipc/（按功能的 IPC，如 qq-music.js）
│   ├── preload/           # preload.js（暴露 electronAPI，与 shared 通道名对齐）
│   ├── shared/            # 主进程与 preload 共用（如 ipc-channels.js）
│   └── renderer/          # app.html、app.css、chat.js、volc-chat.js、command-handlers.js
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
chmod +x scripts/shell/start.sh scripts/shell/quick-start.sh
./scripts/shell/quick-start.sh
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
- **markdown-it**（`dependencies`）：在 preload 中将助手 Markdown 转为 HTML，供聊天气泡使用

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
- **`renderMarkdown(src)`**：使用 **markdown-it**（**`html: false`**、**`linkify: false`**、**`breaks: true`**）生成 HTML，降低模型输出中的 XSS 风险；**不在渲染进程 `require` 依赖**，便于与 `contextIsolation` 搭配。

### 渲染进程（`src/renderer/volc-chat.js` + `chat.js`）

- **`volc-chat.js`**：生成 `streamId`，先注册 `onVolcArkStreamEvent`，再 `invoke`；可选 **`onDelta`** 回调；最终仍返回 **`{ content }` / `{ error }`**（与 `complete()` 兼容）。
- **`chat.js`**：
  - 流式阶段用 **`requestAnimationFrame` 节流**：同一帧内多次 `delta` 合并为一次 **`renderMarkdown(累积文本)`**，更新助手气泡 **`innerHTML`**，并加上 **`markdown-body`** 样式类，实现 **边下边排版**（标题、代码块、列表等实时跟进）。
  - 流结束后 **`cancelAnimationFrame`**，避免最后一帧覆盖最终展示；再执行 **`command-handlers.js`** 的 **`handleAssistantContent`**（如 JSON 指令打开 QQ 音乐），最后用 **`setAssistantBubbleMarkdown`** 刷新为处理后的文案。
- **用户消息**仍为纯文本 **`textContent`**，不对用户输入做 HTML 渲染。

### 样式（`src/renderer/app.css`）

- **`.message-bubble.markdown-body`** 下对 `h1–h4`、`pre/code`、列表、`hr`、`blockquote`、`table`、`a` 等做了暗色主题适配，与聊天布局一致。

### 共享常量（`src/shared/ipc-channels.js`）

- **`VOLC_ARK.BOTS_CHAT_COMPLETION`**：`invoke` 通道名。
- **`VOLC_ARK.BOTS_STREAM_EVENT`**：主进程 → 渲染进程 **单向推送** 通道名（与 `invoke` 分离）。

### 构建（`config/electron-builder.json`）

- 打包 **`dependencies`**（含 **markdown-it** 及其传递依赖），preload 在成品应用中可正常 **`require('markdown-it')`**；请勿再排除整个 **`node_modules`**，否则流式与 Markdown 会在安装包内失效。

### 相关文件一览

| 能力 | 主要文件 |
|------|-----------|
| SSE 流式请求与解析 | `src/main/ipc/ark-chat.js` |
| 环境变量与用户密钥回退 | `src/main/load-env.js`、`src/main/ipc/volc-user-config.js` |
| IPC 注册 | `src/main/main.js` |
| 暴露给页面的 API | `src/preload/preload.js` |
| 通道名 | `src/shared/ipc-channels.js` |
| 组装消息与订阅流 | `src/renderer/volc-chat.js` |
| 气泡 UI、流式 Markdown 节流 | `src/renderer/chat.js` |
| 助手 JSON 指令 | `src/renderer/command-handlers.js` |
| Markdown 气泡样式 | `src/renderer/app.css` |
