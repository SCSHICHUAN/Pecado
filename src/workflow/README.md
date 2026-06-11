# Workflow 模块

侧栏 **Workflow** 面板：本地自动化工作流（主进程执行 + IPC）。

## 目录

```
workflow/
  register.js           IPC 注册
  store.js              定时任务持久化（~/Library/Application Support/pecado/workflows.json）
  html/panel.html       面板 UI 片段
  css/index.css
  js/index.js           渲染进程逻辑
  services/
    file-organize.js    文件归类
    ppt-outline.js      PPT 大纲（Markdown）
    schedule-runner.js  定时启动应用
    file-download-server.js  局域网文件服务（浏览/预览/下载）
    video-thumbnail.js  macOS Quick Look 视频封面缓存
```

## 功能

| Tab | 说明 |
|-----|------|
| **文件归类** | 将文件夹**顶层**文件按扩展名移入子目录（图片、文档、代码…） |
| **写 PPT** | 生成 Markdown 大纲 → `workflow-output/ppt/*.md` |
| **文件服务** | 局域网 HTTP 服务；目录层级浏览、预览/下载；视频封面（macOS）；**共享目录与 Open Folder 独立**，持久化于 `workflows.json` |
| **定时任务** | 按间隔或每天固定时刻 `open -a` 启动应用（需 Pecado 保持运行） |

### 视频封面缓存

- **生成方式**：macOS `/usr/bin/qlmanage -t -s480`（Quick Look 抽帧）
- **缓存位置**：`~/Library/Application Support/pecado/workflow-video-thumbs/`
- **命名规则**：SHA256(绝对路径 + 修改时间) → `{hash}.png`；视频更新后自动失效
- **清除**：Workflow → 文件服务 →「清除缓存」（不影响共享文件夹内的视频）

## 与 Agent / Token

Workflow **不调用 LLM**，无 Function Calling。文件服务、定时任务等均在主进程本地执行，**不消耗** Coding Plan / Bots 对话额度。

## 扩展

在 `services/` 增加新服务 → `register.js` 注册 IPC → `panel.html` + `js/index.js` 增加 Tab。
