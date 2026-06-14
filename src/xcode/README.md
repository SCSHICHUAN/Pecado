# Xcode 模块

macOS 专用：工程发现、pbxproj 集成、流式写盘、Agent 只读工具。

**不含**内置编译/运行（请用 Workflow Skill 的 `run_skill_resource_script`）。

## 目录

```
src/xcode/
  project.js       发现 .xcodeproj/.xcworkspace、pbxproj 增删、scheme 查询
  stream.js        LLM 流式写入源码文件（Xcode 实时刷新）
  paths.js         用户输入 @path、流式写目标解析
  prompt.js        新建文件/目录时「加入 Xcode 工程」对话框
  agent/
    guide.js       注入 Agent system 的 Xcode 说明
    tools.js       xcode_project_status 定义 + 执行
  index.js         对外门面
```

## 能力对照

| 能力 | 文件 |
|------|------|
| Open Folder 后打开 Xcode | `project.openXcodeForProjectRoot` |
| write_file 加入工程 | `prompt` + `project.addFileToProject` |
| Agent 查 scheme | `agent/tools` → `xcode_project_status` |
| 流式写 .swift 等 | `stream.createLiveWriter` |

## 调用方

| 模块 | 用途 |
|------|------|
| `mcp-filesystem/tool-executor.js` | 新建文件确认、集成 pbxproj |
| `agent-loop/app-agent-loop.js` | Xcode Agent tools |
| `pecado/js/agent/router.js` | 流式写路径 |
| `llm-server` + `stream-hooks.js` | INFER 增量落盘 |
