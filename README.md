# Pecado

基于 Electron 的桌面 AI 编程助手：对接 **OpenAI 兼容 LLM**（火山 / DeepSeek / 通用模型等）流式对话，支持本地工程 **MCP 文件系统**、**Function Calling 多轮 Agent**，以及在 macOS 上将生成代码**实时写入磁盘并集成 Xcode 工程**。

```mermaid
flowchart LR
  U[用户] --> P[Pecado / CodX / Git UI]
  P -->|IPC| R[pecado router]
  R -->|agent| L[agent-loop]
  R -->|plain| LLM[llm-server]
  L --> LLM
  L --> MCP[MCP 文件]
  L --> XC[Xcode macOS]
  LLM -->|SSE| P
```

---

## 功能概览

| 能力 | 说明 |
|------|------|
| **流式对话** | SSE 增量输出，渲染进程 Markdown 实时渲染（markdown-it + highlight.js） |
| **四种对话模式** | plain / context / agent / **git** — 主进程 `selectChatMode` 自动选择 |
| **Open Folder** | 菜单打开工程目录，拉起 MCP server-filesystem；主 Pecado 展示目录树气泡 |
| **Agent 工具** | Open Folder 后向 LLM 提供 **27** 个 Function（macOS，含 MCP / Skill / CodX / Xcode / UI / `finish_task`），见下文 |
| **Figma 设计稿 → 代码** | CodX 底栏 **UI** 按钮选取设计稿；`read_UI_layer` 分层读取压缩 JSON；编辑区生成对应 UI 代码 |
| **多媒体识别** | `read_media_file` 读取图片/SVG 为 Base64 送入 LLM 多模态上下文 |
| **Skill 注入** | Workflow 侧栏 **Skill** Tab（数据层历史名 `devDocs`）；勾选「加入 AI」**常驻 Layer 树** + Instructions；正文用 `read_skill_section` 按需读 — 见 [Skill 设计](#skill-开发文档分层读-markdown-的设计) |
| **Token 策略** | LLM 自行编排多轮 tools，以 **`finish_task(summary)`** 结束；`write-guard` 改码前强制 read；无运行意图勿调 `xcode_run` — 见 [Token 消耗优化](#token-消耗优化) |
| **Workflow** | 局域网**文件服务**、文件归类、PPT 大纲、定时任务；**Xcode 模拟器管理（仅 macOS）** — 见 [src/workflow/README.md](src/workflow/README.md) |
| **Xcode 集成**（仅 macOS） | 新建弹窗加入 `.xcodeproj`；`xcode_build` / `xcode_run` / `xcode_test`；模拟器偏好。Windows/Linux **不暴露**这些工具与 UI |
| **本地指令** | `commands/` — 助手 JSON 指令（如打开 QQ 音乐），与 Agent Loop 无关 |
| **Git 面板** | 自研 SVG 提交时间线 + 底部 status / log / pecado 助手；Pull / Push / Commit、节点 Git 操作；**Pecado 思考流实时展示** |
| **CodX 编辑区** | 底栏 **打开编程** → Monaco 全屏编辑；文件树 + Tab + AI 行级改码；**⌘S** / **↥** 写磁盘；**SSE 中断自动续写** — 见 [src/codX/README.md](src/codX/README.md)。Windows 可用 |

---

## 依赖包

### 运行时（`dependencies`）

| 包 | 用途 |
|----|------|
| [`@modelcontextprotocol/sdk`](https://www.npmjs.com/package/@modelcontextprotocol/sdk) | MCP 客户端：stdio 传输、`callTool` / `listTools` |
| [`@modelcontextprotocol/server-filesystem`](https://www.npmjs.com/package/@modelcontextprotocol/server-filesystem) | MCP 文件系统服务端（Open Folder 后 spawn） |
| [`markdown-it`](https://www.npmjs.com/package/markdown-it) | Preload 内 Markdown 渲染 |
| [`highlight.js`](https://www.npmjs.com/package/highlight.js) | 代码块语法高亮 |
| [`xcode`](https://www.npmjs.com/package/xcode) | 解析/修改 `project.pbxproj` |
| [`monaco-editor`](https://www.npmjs.com/package/monaco-editor) | CodX 编程视图 Monaco 编辑区 |

HTTP/SSE 使用 Node/Electron 内置 **`fetch`**。

### 开发 / 打包（`devDependencies`）

| 包 | 用途 |
|----|------|
| [`electron`](https://www.npmjs.com/package/electron) | 桌面壳 |
| [`electron-builder`](https://www.npmjs.com/package/electron-builder) | `npm run build` 打包 |

---

## 平台差异

| 能力 | macOS | Windows / Linux |
|------|-------|-----------------|
| Open Folder / MCP / Agent / CodX / Git / Workflow 基础 | ✅ | ✅ |
| `write_file` / `codx_edit` 写磁盘 | ✅ 流式 | ✅ 流式 |
| Xcode 工具、▶ Run、Workflow「Xcode」Tab、加入 `.xcodeproj` | ✅ | 隐藏 / 不注册 |

打包（本机可同时出 mac + Windows 解压目录）：

```bash
npm run build          # mac + win（x64 dir）
npm run build:mac      # 仅 mac → release/mac/Pecado.app
npm run build:win      # 仅 win → release/win-unpacked/Pecado.exe
```

Windows 配置了 `signAndEditExecutable: false`，避免在 macOS 上交叉打包时依赖 `winCodeSign`/`rcedit`（易因网络或二进制失败）。产物为未签名的 `dir`，可直接拷贝运行；正式签名建议在 Windows CI 上做。

平台常量：`src/shared/platform.js`（`HAS_XCODE`）。

---

## 项目结构

```
Pecado/
├── assets/icons/
├── config/                    # electron-builder、secrets.example.json
├── src/
│   ├── main/                  # 主进程入口 + 主窗口壳
│   │   ├── js/main.js         # ← package.json main；模块 IPC 注册
│   │   ├── js/bootstrap/load-env.js
│   │   ├── html/index.html
│   │   └── css/index.css
│   ├── pecado/                # 对话层（入口 + UI + 模式路由）
│   │   ├── css/index.css
│   │   └── js/                # register、router、plain-stream、stream-ui、prompts
│   ├── agent-loop/            # Agent 多轮编排（见 agent-loop/README.md）
│   ├── llm-server/            # Volc HTTP/SSE；INFER + PARSE（EXECUTE_* / FEED_*）
│   ├── mcp-filesystem/        # MCP 子进程、读写沙箱、tool-executor（EXEC）
│   ├── xcode/                 # macOS 流式写盘、pbxproj、确认对话框
│   ├── commands/js/           # 本地 JSON 后置指令
│   ├── gitgraph/              # Git 面板（自研 SVG 时间线，见 gitgraph/README.md）
│   ├── codX/                  # Monaco 编程视图（见 codX/README.md）
│   ├── markdown/              # Skill Layer 树解析（skill-layer.js）
│   ├── workflow/              # Workflow 面板（文件服务、归类、PPT、定时任务，见 workflow/README.md）
│   ├── settings/              # Preferences（html/css/js + register）
│   ├── preload/preload.js
│   ├── shared/                # ipc-channels、format-tree、stream-text-reveal、prompt-language、codx-edit-*
│   └── electron/              # dev 启动、env:init
├── package.json
└── README.md
```

各源文件开头有 **【功能 / 职责 / 注册 / 调用方】** 说明。

### 子模块 README

| 文档 | 内容 |
|------|------|
| [src/agent-loop/README.md](src/agent-loop/README.md) | Agent 多轮编排（INFER / PARSE / DISPATCH / EXEC / FEED） |
| [src/gitgraph/README.md](src/gitgraph/README.md) | Git 提交图谱 UI、SVG 布局、节点菜单、IPC |
| [src/workflow/README.md](src/workflow/README.md) | Workflow 面板：Skill、文件服务、归类、PPT、定时任务 |
| [src/workflow/skill/README.md](src/workflow/skill/README.md) | Skill 模块：保存、Layer 树、资源脚本执行 |
| [src/codX/README.md](src/codX/README.md) | CodX 编程视图：Monaco、文件树、AI 行级改码、Preferences |

Skill **分层树设计、建树原理、省 token 策略** 以本文 **[§ Skill 开发文档](#skill-开发文档分层读-markdown-的设计)** 为准；子 README 只做模块索引，不重复设计说明。

---

## 安装与运行

```bash
npm install
npm start          # 或 npm run dev
npm run build      # 产物在 release/
```

国内 Electron 镜像：`ELECTRON_MIRROR`（见 `package.json` → `config.electron_mirror`）。

配置 LLM：**Preferences → LLM 配置**（`~/Library/Application Support/pecado/volc-user-config.json`）。

OpenAI 兼容多厂商：预制 **火山** / **DeepSeek** / **通用模型**；每厂商含 Base URL、多路径、`pathModels`（路径对应模型）、API Key。请求地址为 `{Base URL}{路径}`。

---

## LLM Function Calling（Agent 工具）

**Open Folder 且 MCP 已连接** 时进入 **agent 模式**。每轮 LLM 的 `tools` 由主进程组装（`app-agent-loop.js` → `listTools()` + 本地 tools），**不是** renderer 调用。

```mermaid
flowchart LR
  subgraph assemble [app-agent-loop 组装 tools]
    F[finish_task ×1]
    M[MCP listTools ×14]
    S[Skill ×5]
    C[CodX ×2]
    X[Xcode ×4 macOS]
  end
  assemble --> API[Volc Chat Completions]
  API -->|tool_calls| DISPATCH[task-dispatcher]
```

### 数量

| 来源 | 数量 | 条件 |
|------|------|------|
| **`finish_task`** | **1** | 任务结束信号（`finish-tool.js`） |
| **MCP server-filesystem** | **14** | Open Folder 后 `listTools()`（含已废弃 `read_file`，请用 `read_text_file`） |
| **Workflow Skill** | **5** | `workflow/skill/agent/tools.js` |
| **CodX 行级编辑** | **2** | `codx_edit_plan`、`codx_edit` |
| **CodX UI 设计稿** | **1** | `read_UI_layer`（分层读取压缩 Figma JSON） |
| **Pecado Xcode** | **4** | 仅 **macOS** |
| **合计（macOS Agent）** | **27** | |
| **合计（非 macOS）** | **23** | 无 Xcode 四工具 |

### MCP 工具（14，来自 server-filesystem）

| 工具名 | 用途 | 备注 |
|--------|------|------|
| `read_text_file` | 读文本（可选 head/tail） | **推荐** |
| `read_file` | 同 read_text_file | **已废弃**，仍随 listTools 暴露 |
| `read_media_file` | 读图片/音频（base64） | |
| `read_multiple_files` | 批量读文件 | |
| `write_file` | 新建或覆盖写文件 | |
| `edit_file` | 按片段编辑已有文件 | |
| `create_directory` | 创建目录 | |
| `list_directory` | 列目录 | |
| `list_directory_with_sizes` | 列目录（含大小） | |
| `move_file` | 移动/重命名 | |
| `search_files` | 递归搜索 | |
| `directory_tree` | 递归目录树 JSON | path 用 `"."` |
| `get_file_info` | 文件元数据 | |
| `list_allowed_directories` | 当前允许访问的根目录 | |

包版本：`@modelcontextprotocol/server-filesystem`（见 `package.json` / `node_modules`）。

### Skill 工具（5）

定义于 `src/workflow/skill/agent/tools.js`，经 `task-dispatcher` 的 `dev_docs_tool` 分发至 `skill` 模块：

| 工具名 | 用途 |
|--------|------|
| `read_skill_layer` | 拉 Layer JSON（system 已有树时一般不必调） |
| `read_skill_section` | 按 path 读一节正文 |
| `read_dev_doc_resources` | 读 Resources 全文 |
| `read_skill_resource_file` | 读 Skill 附属资源文件 |
| `run_skill_resource_script` | 执行 Skill 资源目录内脚本 |

### finish_task（1）

| 工具名 | 用途 |
|--------|------|
| `finish_task` | 用户意图全部完成时调用；`summary` 为给用户的最终结果说明 |

### CodX 工具（2）

定义于 `src/codX/agent/tools.js`，经 `task-dispatcher` 的 `codx_tool` 分发；流式内容经 `stream-bridge.js` 写入 Monaco。

| 工具名 | 用途 |
|--------|------|
| `codx_edit_plan` | 第一轮：`path` + `edits[]`（`line_start`、`op`、`line_end`；大行号在前）；op 为 `insert_code` / `edit_code` / `del_code` / `insert_blanks` |
| `codx_edit` | 第二轮：同 path 流式 `text`，段序与 plan 一致，段末 `pecado_block_end`；Monaco + 对话代码块实时显示 |

### CodX UI 工具（1）

定义于 `src/codX/ui/tools.js`，分层读取压缩后的 Figma 设计稿 JSON。

| 工具名 | 用途 |
|--------|------|
| `read_UI_layer` | 分层读取 Figma JSON：默认返回骨架（前3层完整节点），传 `nodeId + layer` 可深入指定节点 |

**落盘时机**（非空文件流式阶段只改 Monaco，不实时写盘）：

```mermaid
flowchart LR
  A[codx_edit 流式] --> B[Monaco 实时显示]
  B --> C{codx_edit 工具结束}
  C --> D[codx-disk-sync flush 磁盘]
  D --> E{xcode_build / xcode_run?}
  E -->|有 pending plan| F[编译前再 flush]
```

约定见 `src/agent-loop/capability-prompt.js`（经 `pecado/js/prompts/agent.js` 注入 system）。

### Xcode 工具（4，macOS）

定义于 `src/xcode/agent/tools.js`，经 `task-dispatcher` 的 `xcode_tool` 分发：

| 工具名 | 用途 |
|--------|------|
| `xcode_project_status` | scheme / 工程路径 |
| `xcode_build` | `xcodebuild` 编译 |
| `xcode_run` | `xcodebuild` + `simctl` 编译并在模拟器启动 |
| `xcode_test` | `xcodebuild test` |

### DISPATCH

| `parsedTask.type` | 执行模块 |
|-------------------|----------|
| `mcp_tool` | `mcp-filesystem/tool-executor.js` |
| `dev_docs_tool` | `workflow/skill/agent/tools.js`（module: `skill`） |
| `codx_tool` | `codX/agent/tools.js` |
| `codx_ui_tool` | `codX/ui/tools.js` |
| `xcode_tool` | `xcode/agent/tools.js` |

`finish_task` 在 loop 内处理，不经过外部 EXEC 模块。

---

## Agent 工程上下文

Open Folder 后，不同入口拿到的工程信息不同。**MCP 已连接时一律走 agent 模式**（不会走 context）。

```mermaid
flowchart TB
  OF[File → Open Folder] --> MCP[MCP 连接 + 缓存目录树]

  subgraph main [主 Pecado]
    M1[目录树气泡 → chat history]
  end

  subgraph codx [CodX 底栏]
    C1[独立 history，无气泡]
    C2[system: 工程锚点 + CodX 当前文件]
    C3[codxChat: 中文 reasoning 提醒]
  end

  MCP --> M1
  MCP --> C2
  C2 --> C3

  subgraph agent [agent 模式共用]
    A1["buildProjectContextForAi('', { agentAnchorOnly: true })"]
    A2[【工程锚点】+ 缓存目录树 ASCII]
  end

  MCP --> A1 --> A2
```

| 入口 | 目录树 / 上下文来源 |
|------|---------------------|
| **主 Pecado** | Open Folder 时目录树 **气泡写入 chat history** |
| **CodX 底栏** | 无气泡；system 注入锚点 + `codxActiveFile` + `codxChat` 语言块 |
| **agent 模式** | 工程锚点 + `@` 引用 + CodX 当前文件（见上） |
| **context 模式** | MCP **未连接**且仍有缓存时：`buildProjectContextForAi` 拼 system（少见） |

MCP 工具 `path` 须用 `"."` 或相对路径；`mcp-filesystem/read.js` 的 `prepareMcpToolPath` 会校正 LLM 拼错的绝对路径。

---

## Token 消耗优化

Agent 每多一轮 INFER 都会带上 **history + 全套 tools**，Coding Plan 下轮次越多越慢、越费额度。

当前策略（`app-agent-loop.js` + `finish-tool.js` + `write-guard.js`）：

| 场景 | 行为 |
|------|------|
| **多步任务** | LLM 自行编排 tools，最多 **12 轮**；完成后须 **`finish_task(summary)`** |
| **无 tool 纯文字** | 收到 `FINISH_NUDGE`；闲聊等可一轮结束（`shouldReturnPlainTextReply`） |
| **改已有文件** | `write-guard.js`：须先 `read_text_file`，同轮 `write_file` / `edit_file` 延后 |
| **编译 / Run** | 模型按需调 `xcode_build` / `xcode_run`；**写代码后不会本地自动 build** |
| **CodX 落盘** | `codx_edit` 结束后 flush；`xcode_build` / `xcode_run` 前若仍有 pending plan 再 flush |

**不消耗 LLM token 的操作**：`xcode_build`、`xcode_run`、MCP `callTool` 本地执行；只有 **tool 结果写回 conv 后的下一轮 INFER** 才计 token。

**仍会增加 context 的因素**：对话 history 过长、目录树进 history / system、单次 tool 观测里的 build 日志尾部（约 12k 字符上限，见 `xcode/build-runner.js` `LOG_TAIL_MAX`）。

Prompt 约定见 `src/agent-loop/capability-prompt.js`（无运行意图勿调 `xcode_run`；`directory_tree` 的 path 用 `"."` 或相对路径）。

### Skill 分层树：省 context token

开发文档 Skill 另有一套 **按 Layer 树按需读** 的策略（与上文「少轮 Agent」互补，省的是 **system / tool 上下文体积**，不是 LLM 轮次）。

**常驻 system 的是 Layer 树（目录导航）+ Instructions（若有 `## Instructions` 段）**；**正文不进 system**，Agent 用 `read_skill_section(path)` 按需读。

| 内容 | 默认是否常驻 system | 如何读取 |
|------|----------------------|----------|
| **Layer 树**（`{skillName}.json`） | **是**（单篇约 8k，树内只有 path/label） | `buildDevDocsContextForAi()` 注入 |
| **Instructions** | **是**（若有；单篇约 6k） | 同上 |
| **Resources / 各小节正文** | **否** | `read_skill_section(path)` 或 `read_dev_doc_resources` |
| **整份 Skill .md** | 仅勾选「原文」时（单篇约 120k） | 全文注入 system |

| 对比 | 无分层树（全文进 system） | 有分层树（默认） |
|------|---------------------------|------------------|
| 勾选「加入 AI」 | 整份 `{skillName}.md` 常驻 system | **Layer 树常驻** + Instructions（若有）；正文按需读 |
| Resources / 长附录 | 每次对话都占 token | **不进 system** |
| 导航 | 模型在全文里找 | system 里已有 Layer 树 → `read_skill_section(path)` 拉正文 |

**省 token 的本质**：`.json` 只存 **目录（path + label）**，不存正文；长文留在磁盘 `.md`，Agent 用到哪一节才通过 tool 拉进对话。多份 Skill、万字文档也不会一次性塞满 context。建树与按需读取见 [Skill 开发文档 § 原始 Markdown 如何生成 Layer 树](#原始-markdown-如何生成-layer-树)。

---

## Skill 开发文档：分层读 Markdown 的设计

Workflow **开发文档** Tab：链接 / 文件 / 手写 → 规范 Skill（`{skillName}.md` + `{skillName}.json`）。`.md` 是正文唯一来源；`.json` 是从 `.md` 解析出的 **Layer 索引树**（只含 path，不含正文），供 Agent 导航。

实现：`src/markdown/skill-layer.js`、`src/workflow/skill/`（见 [skill/README.md](src/workflow/skill/README.md)）。

### 原始 Markdown 如何生成 Layer 树

保存 Skill 时自动执行，从用户输入到 `{skillName}.json`：

```
① 来源            链接 / 本地 .md·.html / 手写
                      ↓  readResourceData（HTML → htmlToMarkdown）
② 原始 Markdown     内存 data（尚未落盘）
                      ↓  generateSkillFromData（markdown 模式补 frontmatter；其他模式 LLM → buildSkillDocument）
③ 规范 Skill .md    frontmatter + ## Instructions + ## Resources → 写入磁盘
                      ↓  buildMarkdownLayerTree(skillMd)     ← skill-layer.js
④ Layer 树 .json    解析标题 → 只写 path 目录 → writeLayerJson
                      ↓  Agent 对话
⑤ 按需读取          system 里已有 Layer 树；正文用 read_skill_section(path)
```

**第 ③ 步 `.md` 长什么样**（`## Instructions` / `## Resources` 为分界）：

```markdown
---
name: my-skill
description: "…skill内容分层,markdown-layer-tree,按需要获取对应信息"
---
# 标题
## Instructions
- 操作要点（默认注入 system，见 Token 节）
## Resources
长原文、附录…
```

**第 ④ 步 `buildMarkdownLayerTree` 在做什么**（不用 npm 包建树；`markdown-it` 仅 UI 预览）：

| 子步骤 | 函数 | 说明 |
|--------|------|------|
| 切大块 | `splitFrontmatter` / `extractH2SectionBody` | `---` → metadata；Instructions 段；Resources 段 |
| 扫标题 | `parseHeadingTree` | 每段逐行 for + 栈：`#`～`######` 开节点，子级压栈，同级弹栈；跳过 ` ``` ` 内假标题 |
| 写索引 | `layerNodesFromHeadingTree` | 每节点算 `path`（如 `resources/章节名`）；无子标题时用正文首行命名；**JSON 不存正文** |

纯 Markdown 原文（尚无 Instructions 段）走同逻辑：frontmatter → `metadata`，正文标题 → `resources/…`（`buildLayerTreeFromMarkdown`）。

**树形示例**：

```
metadata → metadata/name, metadata/description
instructions → instructions/…
resources → resources/章节名
```

### read_skill_section：按 path 读节点内容

1. **分层树**是按 Markdown **标题**（`#`）生成的树。
2. **读节点**时：读原 `.md`，按标题生成 path，匹配树里的 path；

```
read_skill_section(skill_name, "resources/pdf-processing-guide")
        │
        ├─ 1. 读本地 .md 文件
        │
        ├─ 2. 按 # 标题 → parseHeadingTree（和建树时同一套规则）→ 匹配 json 的 path
        │
        ├─ 3. 如果 标题/标题 == path
        │
        └─ 4. 命中节点 → 取该 # 下的 content → 拼成 Markdown 返回
```

实现上会加默认 **大范围**（`metadata` / `instructions` / `resources`），用 `resources` 等包一层：

```
path: resources/pdf-processing-guide/overview
       └─ 大范围 ─┘ └─ 在这个范围里按 # 找 ─────────┘
```

本地操作，不用 npm 解析包；`read_skill_section` 单次返回 ≤ **6k** 字符（`MAX_TOOL_BODY`）；脚本观测尾部约 12k（`MAX_RUN_OBSERVATION`）。

### Agent tool（正文按需读）

Layer 树 **已在 system** 中作为导航。正文不在 system，Agent 模式注册 Skill tools（`workflow/skill/agent/tools.js`）：

| Tool | 作用 |
|------|------|
| `read_skill_layer` | 重新拉 Layer JSON（system 已有时一般不必调） |
| `read_skill_section` | 按 `path` 读一节 **正文** |
| `read_dev_doc_resources` | 整段 Resources |
| `read_skill_resource_file` | 读 Skill 附属资源文件（文本） |
| `run_skill_resource_script` | 执行 Skill 资源目录内 `.sh` / `.py` 脚本 |

列表 Switch 切 **「原文」**（`aiContextMode: full`）才会把整份 `.md` 常驻 system（单篇约 120k），一般不必开。

---

## 架构

### 模块边界（职责一览）

| 模块 | 目录 | 职责 | 不做 |
|------|------|------|------|
| **主框架** | `main/` + `preload/` | 窗口、`index.html`、IPC 桥、模块注册 | 对话逻辑、LLM、MCP |
| **pecado** | `pecado/` | IPC 入口、模式选择、prompts、UI sink、plain 单轮 | 不调 Volc HTTP、不执行 tool、不 DISPATCH |
| **agent-loop** | `agent-loop/` | 多轮 conv、DISPATCH、`stream-hooks` → UI/xcode | 不解析 SSE、不实现 MCP tool |
| **llm-server** | `llm-server/` | HTTP/SSE、INFER、PARSE（`EXECUTE_*` / `FEED_*`） | 不依赖 pecado / mcp / xcode |
| **mcp-filesystem** | `mcp-filesystem/` | MCP 连接、读写沙箱、工程上下文、`EXECUTE_execute_tool` | 不选对话模式、不注册 VOLC IPC |
| **xcode** | `xcode/` | 流式写盘、pbxproj、创建确认、Agent build/run | 不注册 VOLC IPC |
| **codX** | `codX/` | Monaco 编辑、底栏对话、Agent 工具实现与 IPC、**Figma 设计稿导入与分层读取** | 不含 loop 代码；**tools 由 agent-loop 调度** |
| **workflow** | `workflow/` | Skill 面板、文件服务、归类/PPT/定时任务、**Xcode 模拟器管理**、**设计稿导入** | 不进 pecado 路由 |
| **markdown** | `markdown/` | Skill Layer 树解析（`skill-layer.js`） | — |
| **commands** | `commands/` | 回合结束后 JSON 本地指令 | 不进 Agent Loop |
| **gitgraph** | `gitgraph/` | Git 时间线、Pull/Push/Commit、节点 Git 操作、工程路径栏 | 不进 Agent Loop |
| **settings** | `settings/` | Volc 配置、菜单、Preferences 窗口 | — |

### 主进程模块注册

入口：`src/main/js/main.js` → `app.whenReady()` 内顺序：

| 顺序 | 模块 | 注册文件 | IPC / 能力 |
|------|------|----------|------------|
| 1 | pecado | `pecado/js/register.js` | `VOLC_ARK.BOTS_CHAT_COMPLETION` |
| 2 | commands | `commands/js/register.js` | `QQ_MUSIC.HANDLE_BOT_COMMAND` |
| 3 | settings | `settings/js/register.js` | `SETTINGS.*` |
| 4 | mcp-filesystem | `mcp-filesystem/ipc.js` | `MCP_FS.*` + Open Folder |
| 5 | gitgraph | `gitgraph/js/register.js` | `GIT.*`（含 `NODE_ACTION`） |
| 6 | workflow | `workflow/register.js` | `WORKFLOW.*`（文件服务等） |
| 7 | codX | `codX/ipc.js` | 语法检查等 |
| 8 | settings | `settings/js/app-menu.js` | 应用菜单栏 |

渲染进程脚本（`main/html/index.html`）：`pecado/js/index.js`、`gitgraph/js/git-chat.js`、`gitgraph/js/index.js`；CodX 激活时加载 `codX/js/*`。

---

## 路由结构、命名与方法

Pecado 的路由分**三层**，每层只做一件事；扩展新能力时按层插入，不跨层调用。

### 三层路由

| 层 | 位置 | 路由什么 | 方式 |
|----|------|----------|------|
| **L1 模块注册** | `main/js/main.js` | 哪个 IPC 通道由哪个模块处理 | 启动时 `register(ipcMain)` |
| **L2 对话模式** | `pecado/js/agent/router.js` | plain / context / agent / git | `selectChatMode()` 读 MCP 状态 |
| **L3 任务分发** | `agent-loop/task-dispatcher.js` | tool 任务交给哪个业务模块 | `route_task()` 按 `task.type` |

```mermaid
flowchart TB
  subgraph L1 [L1 模块注册 — main.js]
    IPC[ipcMain.handle 通道名]
  end

  subgraph L2 [L2 对话模式 — pecado/router]
    MODE{selectChatMode}
    MODE -->|agent| LOOP[runAppAgentLoop]
    MODE -->|plain/context| PLAIN[runPlainSession]
  end

  subgraph L3 [L3 任务分发 — agent-loop]
    TYPE{route_task by type}
    TYPE -->|mcp_tool| MCP[mcp-filesystem]
    TYPE -->|dev_docs_tool| SK[skill]
    TYPE -->|codx_tool| CX[codX edit]
    TYPE -->|codx_ui_tool| CXU[codX UI]
    TYPE -->|xcode_tool| XC[xcode]
  end

  IPC --> MODE
  LOOP --> TYPE
```

**L1** 只管「通道 → 模块」，不管对话逻辑。  
**L2** 只管「这一轮走单轮还是 Agent 多轮」，不执行 tool。  
**L3** 只管「解析出的 task 交给谁」，只在 agent 模式、且模型返回 `tool_calls` 时出现。

### 命名语言

| 术语 | 含义 | 出现在 |
|------|------|--------|
| **register** | 模块向主进程绑定 IPC handler | `*/register.js`、`mcp-filesystem/ipc.js` |
| **router** | 对话入口：选模式、组 messages、调下游 | `pecado/js/agent/router.js` |
| **CHAT_MODES** | `plain` \| `context` \| `agent` \| `git` | router |
| **uiSink** | 主进程 → 渲染进程的流式 UI 回调对象 | `stream-ui.js` 创建，传给 loop |
| **INFER / PARSE / DISPATCH / EXEC / FEED** | Agent 五节点（LangGraph 风格） | loop + llm-server + mcp |
| **EXECUTE_*** | 业务模块**入口**：Loop 调用的执行函数 | `llm-server`、`mcp-filesystem` |
| **FEED_*** | 业务模块**出口**：结构化结果回 Loop | 同上 |
| **route_task** | Loop **内部**分发，不带 EXECUTE 前缀 | `task-dispatcher.js` |
| **feed_observation** | Loop **内部**写 tool 结果进 conv | `context-feeder.js` |
| **parsedTask** | PARSE 产出：`{ id, type, name, args }` | 不含 exec 策略 |
| **routedTask** | DISPATCH 产出：`{ module, task }` | 供 EXEC 使用 |
| **streamHooks** | INFER 流式副作用注入（UI/xcode） | 由 loop 创建，传给 llm-server |

约定：**EXECUTE_/FEED_ 只挂在业务模块**；Loop 自己用普通动词（`route_task`、`feed_observation`）。

### 方法：怎么写新路由

1. **新 IPC 能力** → 在 `shared/ipc-channels.js` 加通道名 → 新建或扩展模块 `register(ipcMain)` → 在 `main.js` 里调用。
2. **新对话模式** → 在 `CHAT_MODES` 加枚举 → `selectChatMode` 加分支 → router handler 里调对应 runner。
3. **新 tool 类型** → PARSE 产出带新 `type` 的 task → `route_task` 加 `case` → 目标模块实现 `EXECUTE_*` / `FEED_*` → loop 里按 `module` 调用（或扩展现有 EXEC）。

依赖始终单向：**pecado → agent-loop → llm-server / mcp**；业务模块不 require pecado。

### 结构代码示例

以下为**模式示意**，展示接口形状与注册方式，不是运行时完整实现。

#### 1. 模块注册（L1）

```js
// main/js/main.js — 启动时装配
app.whenReady().then(() => {
  pecado.register(ipcMain);      // VOLC_ARK
  commands.register(ipcMain);    // QQ_MUSIC
  mcpFilesystemIpc.register(ipcMain, () => mainWindowRef);
});

// pecado/js/register.js — 每个模块一个 register
function register(ipcMain) {
  router.register(ipcMain);  // 内部绑定 ipcMain.handle(...)
}
module.exports = { register };
```

#### 2. IPC 通道单一数据源

```js
// shared/ipc-channels.js
module.exports = {
  VOLC_ARK: {
    BOTS_CHAT_COMPLETION: 'volc-ark-bots-chat-completion',
    BOTS_STREAM_EVENT: 'volc-ark-bots-stream-event',
  },
  MCP_FS: { DIRECTORY_TREE: 'mcp-fs-directory-tree', PROJECT_CHANGED: 'mcp-fs-project-changed' },
};
```

#### 3. 对话模式路由（L2）

```js
// pecado/js/agent/router.js — 模式决策 + 分发到 runner
const CHAT_MODES = { PLAIN: 'plain', CONTEXT: 'context', AGENT: 'agent', GIT: 'git' };

async function selectChatMode({ userText, history }) {
  if (projectIo.getStatus().connected) {
    // agent：注入工程锚点 + @ 引用 + CodX 当前文件
    return { mode: CHAT_MODES.AGENT, messages: buildChatMessages('agent', userText, history), xcodeStreamPath: '...' };
  }
  const ctx = await buildProjectContextForAi(userText);
  const mode = ctx.trim() ? CHAT_MODES.CONTEXT : CHAT_MODES.PLAIN;
  return { mode, messages: buildChatMessages(mode, userText, history, ctx), xcodeStreamPath: null };
}

// handler 内
if (mode === CHAT_MODES.AGENT) {
  const uiSink = createUiStreamSink(sender, streamId);
  return runAppAgentLoop(uiSink, { apiKey, model, apiMode, endpoint }, messages, {
    xcodeStreamPath,
    userText,
    codxChat: Boolean(payload?.codxChat),
  });
}
return runPlainSession({ apiKey, model, apiMode, endpoint, messages, uiSink, xcodeAbsPath });
```

#### 4. uiSink：UI 旁路（不是 EXEC 节点）

```js
// pecado/js/agent/stream-ui.js — 主进程推流到 renderer
function createUiStreamSink(sender, streamId) {
  return {
    onTextDelta(text) { sender.send(VOLC_ARK.BOTS_STREAM_EVENT, { streamId, phase: 'delta', text }); },
    onTool(info)     { sender.send(VOLC_ARK.BOTS_STREAM_EVENT, { streamId, phase: 'tool', ...info }); },
    onError(error)   { sender.send(VOLC_ARK.BOTS_STREAM_EVENT, { streamId, phase: 'error', error }); },
  };
}
```

#### 5. 业务模块契约：EXECUTE / FEED

```js
// llm-server — INFER 节点
async function EXECUTE_call_llm(chatOpts, streamHooks) { /* streamChat + hooks */ }
function FEED_infer_round(inferRaw, streamContext) { return { ok: true, data: { ... } }; }

// llm-server — PARSE 节点
function EXECUTE_parse_command(inferRound) {
  return { tasks: [{ id, type: 'mcp_tool', name, args }], assistantMessage, finishReason };
}
function FEED_parsed_command(parsedRaw) { return { ok: true, data: parsedRaw }; }

// mcp-filesystem — EXEC 节点
async function EXECUTE_execute_tool(routedTask, execOpts) {
  if (routedTask.module !== 'mcp-filesystem') return { isError: true, content: [...] };
  return projectIo.callTool(routedTask.task.name, routedTask.task.args);
}
function FEED_tool_result(execRaw) { return { ok: !execRaw?.isError, observation: '...' }; }
```

#### 6. 任务分发（L3）

```js
// agent-loop/task-dispatcher.js
function route_task(parsedTask) {
  switch (parsedTask.type) {
    case 'mcp_tool':
      return { module: 'mcp-filesystem', task: parsedTask };
    case 'codx_ui_tool':
      return { module: 'codx-ui', task: parsedTask };
    // case 'git_op':
    //   return { module: 'gitgraph', task: parsedTask };
    default:
      return { error: `DISPATCH：未知任务 type「${parsedTask.type}」` };
  }
}
```

#### 7. Loop 编排骨架（只展示调用关系）

```js
// agent-loop — 每轮固定流水线，不含实现细节
for (let round = 0; round < MAX_TOOL_ROUNDS; round++) {
  const inferFeed = FEED_infer_round(await EXECUTE_call_llm(chatOpts, hooks), streamContext);
  const parseFeed = FEED_parsed_command(EXECUTE_parse_command(inferFeed.data));
  if (parseFeed.data.finishReason !== 'tool_calls') return { content: parseFeed.data.content };

  feed_assistant_tool_calls(conv, parseFeed.data.assistantMessage);
  for (const parsedTask of parseFeed.data.tasks) {
    const routed = route_task(parsedTask);
    const toolFeed = FEED_tool_result(await EXECUTE_execute_tool(routed, { streamContext }));
    feed_observation(conv, parsedTask, toolFeed);
  }
  chatOpts.messages = conv;
}
```

#### 8. 回合后本地指令（独立于 Agent）

```js
// renderer — 对话结束后可选 JSON 指令，不走 loop
const { displayText } = await electronAPI.handleBotCommand(reply);

// commands/js/local-commands.js — 主进程解析 { "cmd": "open qq music" }
ipcMain.handle(QQ_MUSIC.HANDLE_BOT_COMMAND, (_e, { rawContent }) => handleBotCommand(rawContent));
```

---

### 依赖方向

```mermaid
flowchart LR
  subgraph renderer [Renderer]
    PUI[pecado/js/index.js]
  end

  subgraph main [Main Process]
    Router[pecado/router]
    Loop[agent-loop]
    LLM[llm-server]
    MCP[mcp-filesystem]
    Xcode[xcode]
    Cmd[commands]
  end

  PUI -->|invoke BOTS_CHAT| Router
  Router -->|agent| Loop
  Router -->|plain/context| LLM
  Loop --> LLM
  Loop --> MCP
  Loop --> Xcode
  Loop -.->|uiSink hooks| PUI
  PUI -->|post-chat JSON| Cmd

  LLM -.x.-> Router
  MCP -.x.-> Loop
  Loop -.x.-> Router
```

> `-.x.-` 表示**不应**出现的反向依赖（当前代码已遵守）。

---

## 流程图

### 1. 端到端：用户发消息

```mermaid
sequenceDiagram
  participant R as pecado/js/index.js
  participant Pre as preload
  participant Rt as pecado/router
  participant L as agent-loop
  participant LLM as llm-server
  participant MCP as mcp-filesystem

  R->>Pre: volcArkBotsChatStream
  Pre->>Rt: invoke BOTS_CHAT_COMPLETION
  alt MCP 已连接 agent
    Rt->>L: runAppAgentLoop(uiSink)
    loop 每轮最多 12 次
      L->>LLM: EXECUTE_call_llm
      LLM-->>L: FEED_infer_round
      L->>LLM: EXECUTE_parse_command
      LLM-->>L: FEED_parsed_command
      alt finishReason = tool_calls
        L->>L: route_task → EXEC tools
        L->>L: feed_observation(conv)
        alt 含 finish_task
          L-->>Rt: content = summary（结束 loop）
        else 无 finish_task
          L->>L: 下一轮 INFER（最多 12 轮）
        end
      else 无 tool_calls
        L-->>Rt: content 或 FINISH_NUDGE 后再 INFER
      end
    end
  else plain / context
    Rt->>LLM: collectPlainChat
    LLM-->>Rt: content
  end
  Rt-->>Pre: { content } | { error }
  Note over LLM,R: INFER 期间 stream-hooks → uiSink → BOTS_STREAM_EVENT → R（或 codX/codx-chat.js）
  R->>Pre: handleBotCommand（可选 JSON）
```

### 2. Agent Loop 五节点（每轮）

```mermaid
flowchart TB
  START([runAppAgentLoop]) --> INFER

  subgraph INFER [INFER — llm-server]
    E1[EXECUTE_call_llm]
    F1[FEED_infer_round]
    E1 --> F1
  end

  INFER --> PARSE

  subgraph PARSE [PARSE — llm-server]
    E2[EXECUTE_parse_command]
    F2[FEED_parsed_command]
    E2 --> F2
  end

  PARSE --> DEC{tool_calls?}
  DEC -->|否| DONE([return content])
  DEC -->|是| DISPATCH

  subgraph DISPATCH [DISPATCH — agent-loop]
    RT[route_task]
    RT -->|mcp_tool| MOD[mcp-filesystem]
    RT -->|dev_docs_tool| SK[skill]
    RT -->|codx_tool| CX[codX edit]
    RT -->|codx_ui_tool| CXU[codX UI]
    RT -->|xcode_tool| XC[xcode]
  end

  DISPATCH --> EXEC

  subgraph EXEC [EXEC — mcp-filesystem]
    E3[EXECUTE_execute_tool]
    F3[FEED_tool_result]
    E3 --> F3
  end

  EXEC --> FEED

  subgraph FEED [FEED — agent-loop]
    FA[feed_assistant_tool_calls]
    FO[feed_observation]
    FA --> FO
  end

  FEED --> INFER

  subgraph SIDE [旁路 — agent-loop/stream-hooks]
    UI[uiSink.onTextDelta / onToolStream]
    XC[xcode live-stream 写盘]
  end

  INFER -.-> SIDE
```

### 3. 对话模式

```mermaid
flowchart TD
  MSG[用户消息] --> SEL[pecado/router selectChatMode]

  SEL -->|payloadMode=git| GIT[git 模式]
  SEL -->|MCP 已连接| AGENT[agent 模式 — 常见路径]
  SEL -->|MCP 未连 + 有缓存上下文| CTX[context 模式 — 少见]
  SEL -->|无工程上下文| PLAIN[plain 模式]

  AGENT --> LOOP[agent-loop/runAppAgentLoop]
  LOOP --> TOOLS[MCP + Skill + CodX + Xcode tools]

  CTX --> PLAIN流[plain-stream/runPlainSession]
  PLAIN --> PLAIN流
  GIT --> PLAIN流
  PLAIN流 --> LLM[llm-server/collectPlainChat]
  CTX --> PC[project-context 拼 system]
  AGENT --> ANCHOR[工程锚点 + 缓存目录树]
```

### 4. EXECUTE / FEED 命名约定

| 节点 | 模块 | 入口（Loop 调用） | 出口（回 Loop） | Loop 内部 |
|------|------|-------------------|-----------------|-----------|
| INFER | llm-server | `EXECUTE_call_llm` | `FEED_infer_round` | — |
| PARSE | llm-server | `EXECUTE_parse_command` | `FEED_parsed_command` | — |
| DISPATCH | agent-loop | — | — | `route_task` |
| EXEC | mcp-filesystem | `EXECUTE_execute_tool` | `FEED_tool_result` | — |
| 写 conv | agent-loop | — | — | `feed_observation` |

`EXECUTE_*` / `FEED_*` 只出现在**业务模块**；Loop 内部方法不带此前缀。

---

## MCP 与 Xcode

1. **File → Open Folder**（`mcp-filesystem/ipc.js`）选择工程根
2. 主进程 spawn MCP server-filesystem，推送 `MCP_FS.PROJECT_CHANGED`
3. Agent 模式：`route_task` → `EXECUTE_execute_tool` → MCP `callTool` 或 macOS 本地写盘
4. INFER 流式 `write_file`：`stream-hooks` + `xcode/stream.js` 增量落盘
5. 新建路径：`xcode/prompt.js` 确认是否加入 `.xcodeproj`

### Xcode 编译到模拟器（xcode_run）

`xcode_run` 走纯 CLI：**不依赖 Xcode GUI / AppleScript**。实现见 `src/xcode/build-runner.js`。

**触发方式**

| 方式 | 说明 |
|------|------|
| Agent 工具 | 模型调用 `xcode_run`，或用户说「运行 / run」 |
| 直调 | `xcode_run`、`运行`、`run` 跳过 LLM，直接执行 |
| 底栏 ▶ | Pecado 输入区旁绿色播放按钮，等同 `xcode_run` |

**执行流程**

```text
resolveScheme → pickIosSimulator → [可选] xcodebuild
  → 解析 .app → simctl install → simctl launch → 进程检测
```

**编译与 Run 加速**

| 策略 | 效果 |
|------|------|
| 跳过编译 | `.app` 签名 + `lastSourceMtime` 未变时不跑 `xcodebuild`（约 2s 快速启动） |
| 跳过安装 | 同一模拟器 + bundleId + 产物签名未变时只 `simctl launch` |
| DerivedData 复用 | `-derivedDataPath` 指向已有缓存，避免冷编译 |
| 模拟器 xcconfig | `.pecado/simulator-run.xcconfig`：Manual 签名、关 Index Store、增量 Swift 等 |
| generic destination | `generic/platform=iOS Simulator,arch=arm64`，减少 destination 切片 |
| 并行 | 编译期间 boot 模拟器；build 日志出现 `.app` 时提前 install+launch |
| 缓存 | `.pecado/xcode-cache.json` 存 scheme、bundleId、DerivedData、上次安装签名 |

**日志**：Run 分步进度与 `[耗时]` 诊断写入 Skill 日志面板；聊天气泡只显示阶段摘要，不含耗时明细。

**常见问题**：build log 出现 `DVTPortal … session has expired (1100)` 时，请在 **Xcode → Settings → Accounts** 重新登录 Apple ID，可显著缩短 `xcodebuild` 时间。

更多细节见 **[src/xcode/README.md](src/xcode/README.md)**。

---

## Git 面板（gitgraph 模块）

侧栏 **Git** 使用**自研 SVG 时间线**（`src/gitgraph/`，不依赖 `@gitgraph/js`）。与 **File → Open Folder** 共用工程根目录（`userData/mcp-project.json`）。详细布局与滚动策略见 **[src/gitgraph/README.md](src/gitgraph/README.md)**。

### 打开方式

1. 侧栏点击 **Git**（与 **Pecado** 同级，全页切换）
2. 菜单 **View → Git 面板**（`Cmd/Ctrl+2`）；**View → Pecado**（`Cmd/Ctrl+1`）
3. Git 页内窗口底栏图标：展开/收起底部 **status | log | pecado** 区域

### 前置条件

1. **File → Open Folder** 打开 Git 仓库根目录。
2. 顶栏 **meta 栏**（`#git-message`）显示分支、操作进度与仓库状态摘要。
3. **Preferences → 通用 → Git 提交图条数**：100 / 200 / 500 / 1000 / 1500 / 5000。

### 面板结构

| 区域 | 功能 |
|------|------|
| **工具栏** | Push、Pull、Commit（`git push` / `git pull` / `git add -A && commit`） |
| **Meta 栏** | 实时操作进度与完成状态（如「拉取完成 · 已是最新 · 工作区干净」）；右侧当前分支 |
| **时间线** | SVG 分支图 + 轨道 tint + commit 色块 + subject 文字（四层叠放） |
| **底部双滚动条** | 左：图区横向滚动；右：commit 文字起始位置（与图区解耦） |
| **底部 Dock — status** | 选中节点后展示 commit 详情；未选中时显示 `git status` |
| **底部 Dock — log** | 仅 Git 命令输出与错误（不含 Pecado 对话内容） |
| **底部 Dock — pecado** | Git 专用助手：可点击 push/pull/status/commit/branch；shell 命令需「同意」；多条命令可「按顺序全部执行」 |

### 节点交互

| 操作 | 行为 |
|------|------|
| **悬浮节点圆** | 节点上方显示作者姓名（独立 `fixed` 浮层，背景 `#000`） |
| **单击节点圆** | 选中 commit（白描边）；底部 Status 切换为该 commit 信息；关闭已打开的右键菜单 |
| **右键 / 双指点击节点圆** | 弹出 Git 操作菜单（独立 `fixed` 浮层，菜单左上角对齐节点圆心；超出窗口时自动平移以保证完整可见） |

仅 SVG **圆点**可交互；轨道条、色块、文字层 `pointer-events: none`，不抢点击。

### 节点右键菜单

主进程经 `GIT.NODE_ACTION` → `git-runner.runNodeAction` 执行，完成后刷新图谱与 Status。

| 菜单项 | `action` | 说明 |
|--------|----------|------|
| Checkout this commit | `checkout` | `git checkout <hash>`（确认框） |
| Create branch here | `branch` | 输入分支名 → `git branch <name> <hash>` |
| Cherry pick commit | `cherry-pick` | `git cherry-pick <hash>` |
| Reset … to this commit | `reset` | 子菜单 Mixed / Soft / Hard → `git reset --<mode> <hash>` |
| Revert commit | `revert` | `git revert --no-edit <hash>` |
| Copy commit sha | — | 剪贴板写入完整 hash（渲染进程） |
| Copy link … on remote: origin | — | 由 `remoteOriginUrl` 生成 HTTPS commit 链接（无 origin 时禁用） |
| Create patch from commit | `format-patch` | `git format-patch -1` 输出复制到剪贴板 |
| Create tag here | `tag` | 输入标签名 → `git tag <name> <hash>` |
| Create annotated tag here | `tag-annotated` | 输入名与说明 → `git tag -a` |

### 显示策略（摘要）

为兼容极端情况（超长 commit 信息、多 lane、大量提交），横向可滚区域**故意加宽**：

| 区域 | 可滚 inner 宽度 | 作用 |
|------|-----------------|------|
| **节点图** | **3 × 窗宽**（左留白 1W + SVG + 右留白 1W） | 任意节点/分支线可出现在屏幕从左到右任意 x |
| **Commit 文字** | 左留白 1W +（最长 subject 宽 **+ 1W**） | 文字左缘可出现在屏幕任意 x（默认 W×1/2） |

**节点 ↔ commit 对应**：每一行共享同一 `row-index` — SVG 圆点、轨道 tint（节点竖线 → 右缘）、commit 色块/文字为同一 hash。图区 scroll 与 commit scroll **解耦**（轨道只随图区滚）。

默认锚点：最新节点圆心 **W×1/4**；commit 文字左缘 **W×1/2**。

| 层 | 显示方式 | 滚动 |
|----|----------|------|
| **节点** | 每行圆点（lane 色 + 作者首字母）；仅圆点可点选 | 随图区横向滚 |
| **轨道** | 半透明 tint：节点竖线 → 窗口右缘 | 固定视口；随图区 scroll 更新 |
| **Commit 色块** | 实色（lane 24% 叠 `#161616`）：文字列起点 → 右缘 | 固定视口；左缘随 commit 滑块 |
| **Commit 文字** | 白/灰 subject，左内边距 28px | inner 可滚 |

横向滚轮只滚图区；滚动/缩放窗口时关闭节点浮层菜单。

### IPC（`GIT.*`）

| 通道 | 用途 |
|------|------|
| `GET_PANEL_HTML` | 读取 `gitgraph/html/index.html` 注入 `#panel-git` |
| `GET_STATE` | 分支、`git status`、图谱数据、`remoteOriginUrl` |
| `PULL` / `PUSH` / `COMMIT` | 工具栏 Git 命令 |
| `RUN_SHELL` | Pecado 助手确认后执行 shell（`git` / `cd` / `mkdir` 等） |
| `NODE_ACTION` | 节点右键菜单：`{ action, hash, branchName?, resetMode?, tagName?, tagMessage?, projectRoot? }` |

渲染端：`preload/preload.js` → `gitGetState`、`gitPull`、`gitPush`、`gitCommit`、`gitNodeAction` 等。

### Push 到远端

**用户工程（应用内）**：Open Folder → Git 面板 → **Push**（`git push`）。

**本仓库（终端）**：

```bash
git add -A
git commit -m "描述本次改动"
git push origin main
```

新分支首次：`git push -u origin <branch>`。

---

## 主要文件索引

| 能力 | 文件 |
|------|------|
| 主进程入口 + 注册 | `src/main/js/main.js` |
| 主窗口尺寸记忆 | `src/main/js/window-state.js` |
| CodX 编程视图 | `src/codX/js/index.js`、`src/codX/js/editor.js` |
| CodX Agent 工具 | `src/codX/agent/tools.js` |
| CodX 流式桥接 | `src/codX/js/stream-bridge.js` |
| 行级编辑共享逻辑 | `src/shared/codx-stream-ops.js`、`src/shared/codx-edit-plan.js`、`src/shared/codx-edit-ops.js` |
| CodX 对话代码块 | `src/codX/js/codx-code-block.js` |
| 对话 IPC + 模式路由 | `src/pecado/js/agent/router.js` |
| 对话 UI（renderer） | `src/pecado/js/index.js` |
| Agent 编排 | `src/agent-loop/app-agent-loop.js`（详见 [src/agent-loop/README.md](src/agent-loop/README.md)） |
| 写代码直调 Xcode 回复 | `src/agent-loop/agent-reply.js`（`composeAgentReply`，直调 xcode 工具时用） |
| 写入前 read 守卫 | `src/agent-loop/write-guard.js` |
| INFER | `src/llm-server/llm-infer-service.js` |
| PARSE | `src/llm-server/command-parser.js` |
| DISPATCH | `src/agent-loop/task-dispatcher.js` |
| EXEC | `src/mcp-filesystem/tool-executor.js` |
| stream-hooks（UI/xcode） | `src/agent-loop/stream-hooks.js` |
| plain/context 单轮 | `src/pecado/js/agent/plain-stream.js` |
| UI 流推送 | `src/pecado/js/agent/stream-ui.js` |
| 本地 JSON 指令 | `src/commands/js/local-commands.js` |
| Git 时间线 UI | `src/gitgraph/js/index.js` |
| Git Pecado 助手 | `src/gitgraph/js/git-chat.js` |
| Git 布局 / lane | `src/gitgraph/js/timeline-layout.js` |
| Git CLI / 节点操作 | `src/gitgraph/js/git-runner.js` |
| Git log 解析 | `src/gitgraph/js/log-parser.js` |
| Git 主进程 IPC | `src/gitgraph/js/register.js` |
| CodX 底栏对话 | `src/codX/js/codx-chat.js`、`src/codX/js/codx-live-status.js`、`src/codX/js/codx-code-block.js` |
| 流式正文渐显 | `src/shared/stream-text-reveal.js` |
| 对话跟滚 | `src/shared/chat-scroll-follow.js` |
| 工程上下文 | `src/mcp-filesystem/project-context.js` |
| MCP 路径校正 | `src/mcp-filesystem/read.js`（`prepareMcpToolPath`） |
| LLM 语言约束 | `src/shared/prompt-language.js` |
| Workflow 文件服务 | `src/workflow/file-service/server.js` |
| Skill 模块 | `src/workflow/skill/`（见 [skill/README.md](src/workflow/skill/README.md)） |
| Skill 执行日志 | `src/shared/agent-log.js`、`src/pecado/js/skill-log-panel.js` |
| IPC 通道常量 | `src/shared/ipc-channels.js` |
| Preload | `src/preload/preload.js` |

---

## 最近更新（本地未推送 — 14 commits, 44 files）

### 1. Figma 设计稿 → UI 代码（`read_UI_layer`）

| 文件 | 职责 |
|------|------|
| `src/codX/ui/compress-figma.js` | Figma JSON 裁剪（删空节点/空属性）+ 压缩（长key→短key `S0/S1/...`，输出 `shot-*.json`） |
| `src/codX/ui/read-ui-layer.js` | 分层读取压缩 JSON：默认骨架（前3层完整节点），传入 `nodeId + layer` 可逐层深入 |
| `src/codX/ui/tools.js` | `read_UI_layer` 工具定义，经 `codx_ui_tool` 分发 |
| `src/codX/ui/index.js` | 模块门面 |
| `src/workflow/design-import/copy.js` | Figma Framelink 导出目录→`DesignImports/`，检测 JSON + 生成 `review.md` |
| `src/codX/css/index.css` | UI 选择按钮/列表/对话气泡样式（+608 行） |
| `src/codX/js/codx-chat.js` | UI 设计稿选取逻辑（+433 行） |
| `src/codX/js/index.js` | UI 按钮集成（+40 行） |
| `src/main/html/index.html` | `codx-ui-pick-btn` 按钮 |
| `src/main/js/main.js` | `WORKFLOW.DESIGN_IMPORT` IPC 注册 |
| `src/preload/preload.js` | `designImport` API |
| `src/shared/ipc-channels.js` | `DESIGN_IMPORT` 通道 |

**工作流**：用户点击 CodX 底栏 **UI** 按钮 → 选取设计稿目录 → 气泡显示 icon+名称 → 发送时自动 `compressFigmaBundle` → LLM 通过 `read_UI_layer` 分层读取 JSON → 编辑区生成对应 UI 代码。

### 2. 图片/多媒体识别（`read_media_file`）

| 文件 | 职责 |
|------|------|
| `src/mcp-filesystem/read-media.js` | 新增文件：图片/SVG→Base64 多模态工具 |
| `src/shared/media-utils.js` | 新增文件：图片/SVG 统一转码（双端通用） |
| `src/mcp-filesystem/tool-executor.js` | 注册 `read_media_file` |
| `src/llm-server/format.js` | 多模态 content 格式适配 |

### 3. SSE 流中断自动续写

| 文件 | 职责 |
|------|------|
| `src/agent-loop/app-agent-loop.js` | 流中断检测 + 重发策略（+84 行） |
| `src/llm-server/stream.js` | SSE `[DONE]`/error 检测 |
| `src/codX/js/codx-chat.js` | 续写后 edit 而非重写 |
| `src/agent-loop/capability-prompt.js` | LLM 约束：截断不重写，用 `codx_edit` 追加 |

### 4. Xcode 模拟器选择

| 文件 | 职责 |
|------|------|
| `src/xcode/simulator-prefs.js` | 新增文件：模拟器 UDID 持久化（`xcode-simulator.json`） |
| `src/workflow/js/panel.js` | Workflow 面板 **Xcode** 栏 — 模拟器列表 + 刷新 + 选择（+270 行） |
| `src/workflow/html/panel.html` | Xcode 栏 HTML |
| `src/workflow/css/index.css` | Xcode 栏样式（+179 行） |
| `src/workflow/register.js` | `XCODE_SIMULATOR` IPC 注册（+185 行） |
| `src/xcode/build-runner.js` | `xcode_run` 使用选中模拟器 |

### 5. UI/UX 优化

| 区域 | 改动 |
|------|------|
| **Git 面板** | Pecado 思考流实时展示（`gitgraph/js/git-chat.js` +62 行，`gitgraph/css/index.css` +62 行） |
| **Git 面板** | 默认 tab 切为 pecado（`gitgraph/js/index.js`） |
| **CodX 编辑器** | 同步按钮 pending 高亮（`codx/js/editor.js`） |
| **CodX 编辑器** | 工具栏按钮风格统一（线型图标，28x22，`codx/css/index.css`） |
| **CodX 编辑器** | 关闭按钮、panel toggle 风格优化 |
| **主面板** | 侧栏新增 Coding 按钮（`main/html/index.html` + `pecado/js/index.js`） |
| **Workflow** | 设计稿导入 IPC（`workflow/register.js`） |
| **Pecado** | 路由 + Xcode run 按钮联动 CodX 面板 |

---

## 开发提示

- **改 IPC 通道名**：只改 `src/shared/ipc-channels.js`，同步 preload 与主进程
- **改 LLM 适配**：只改 `llm-server/`；agent-loop 不应直接 sanitize messages
- **改 Agent 节点**：`agent-loop/` + `llm-server/` 对应 INFER/PARSE 文件
- **改 tool 行为**：`mcp-filesystem/tool-executor.js`（含 `resolveExecHints`）
- **扩展 DISPATCH**：`agent-loop/task-dispatcher.js` 加 `type` 分支 + 新模块 `EXECUTE_*`
- **改 Git 面板**：`gitgraph/js/index.js`（渲染）、`git-runner.js`（CLI）、`register.js`（IPC）；通道见 `GIT.*`

## License

MIT
