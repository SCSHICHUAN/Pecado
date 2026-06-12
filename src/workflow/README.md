# Workflow 模块

侧栏 **Workflow** 面板：本地自动化（主进程 + IPC）。

## 目录

```
workflow/
  register.js
  store.js
  html/panel.html
  css/index.css
  js/index.js
  dev-docs/              Skill 开发文档（见 dev-docs/README.md）
  services/
    file-organize.js
    ppt-outline.js
    schedule-runner.js
    file-download-server.js
    video-thumbnail.js
```

## 功能

| Tab | 说明 |
|-----|------|
| **文件归类** | 顶层文件按扩展名归入子目录 |
| **写 PPT** | Markdown 大纲 → `workflow-output/ppt/` |
| **文件服务** | 局域网 HTTP 浏览/下载；视频封面（macOS） |
| **开发文档** | Skill 生成与 Layer 分层 — 见 [根 README § Skill](../../README.md#skill-开发文档分层读-markdown-的设计) |
| **定时任务** | 间隔/每日 `open -a` 启动应用 |

## 扩展

`services/` 增服务 → `register.js` 注册 IPC → `panel.html` + `js/index.js` 增 Tab。
