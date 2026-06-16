# CodX 模块

Monaco 代码编辑器视图：Open Folder 工程文件树 + 编辑区 + Pecado/log 底栏。

## 入口

- 底栏 **打开编程** → 全屏编辑（隐藏左侧 Pecado/Workflow/Git 侧栏）
- **关闭编程** → 返回进入前的视图
- 底栏 **打开项目** → 在 Xcode 中打开工程（与编程按钮相邻）

## 目录

```
src/codX/
  css/index.css
  js/
    monaco-loader.js   Monaco AMD 加载
    file-tree.js       Xcode 风格文件树
    editor.js          Monaco 编辑区（流式改码、Tab、保存）
    editor-themes.js   配色主题
    stream-bridge.js   Agent codx_edit / write_file 流式 → 编辑器
    codx-chat.js       底栏 Pecado 对话
    codx-log.js        底栏 log
    index.js           视图切换、⌘S、↥ 同步 Xcode
  agent/
    tools.js           codx_edit_plan / codx_edit（主进程）
    context.js         当前编辑文件注入 Agent
  ipc.js               语法检查 IPC
```

共享逻辑：`src/shared/codx-edit-plan.js`、`src/shared/codx-edit-ops.js`、`src/shared/line-numbers.js`。

## AI 改码流程

1. `read_text_file` — 读磁盘当前内容
2. `codx_edit_plan` — `path` + `edits[]`（每项仅 `line_start`，大行号在前）
3. `codx_edit` — 同 path，流式 `text`，段间 `pecado_LLM_line_end`
4. 编辑器按段实时显示；**⌘S** 或工具栏 **↥** 同步到 Xcode

非空文件不自动落盘；空文件 / `write_file` 仍可流式写磁盘。

## Preferences（通用）

| 设置 | 说明 |
|------|------|
| CodX 编辑器配色 | pecado-dark / cursor-dark / xcode-dark 等 |
| CodX 字号 | 0 = 主题默认 |
| CodX 行号 | 显示 / 隐藏 / 相对行号 |
| CodX 行号栏宽度 | 2–6 字符 |
| CodX 行号字号 / 粗细 | 可独立于代码区 |

## 其它

- 主窗口大小：关闭时记住，下次启动恢复（`main-window.json`）
- 依赖：`monaco-editor`（npm）

## 依赖

- MCP `directory_tree` / `read_text_file` / Open Folder 工程根
- `mcp-fs-write-text-file`（保存与 ↥ 同步）
