# Workflow 模块

Workflow 侧栏面板：五个 Tab 对应五块能力。

## 目录与职责

```
src/workflow/
  config-store.js        全局配置 workflows.json（定时任务、文件服务路径、Skill 索引）
  register.js            全部 Workflow IPC
  html/panel.html        面板结构
  css/index.css          样式
  js/
    panel.js             面板 UI 逻辑
    file-type.js         文件类型图标（渲染进程）
  skill/                 Tab「Skill」（service / store / agent/）
  file-service/          Tab「文件服务」
  services/              Tab「文件归类 / 写 PPT / 定时任务」
```

## Tab → 代码

| Tab | 目录 / 文件 | 功能 |
|-----|-------------|------|
| **Skill** | `skill/` | 管理 SKILL.md、Layer 树、附属资源；Agent 工具 |
| **文件服务** | `file-service/server.js` | 局域网 HTTP 共享目录 |
| **文件归类** | `services/organize.js` | 顶层文件按类型分子目录 |
| **写 PPT** | `services/ppt.js` | 生成 Markdown 大纲到工程 |
| **定时任务** | `services/schedule.js` | 定时打开本机应用 |

详见 [skill/README.md](./skill/README.md)、[file-service/README.md](./file-service/README.md)。
