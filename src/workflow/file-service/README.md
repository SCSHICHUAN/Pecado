# 文件服务模块

Tab **文件服务**：局域网 HTTP 共享一个**独立目录**（与 Open Folder 工程无关；手机浏览器可浏览/下载）。

---

## 用户操作流程

```mermaid
flowchart LR
  A[Workflow → 文件服务 Tab] --> B{已配置目录?}
  B -->|是| C[maybeAutoStart 自动启动]
  C --> D[地址复制到剪贴板]
  D --> E[手机浏览器访问]
  B -->|否| F[先选共享目录]
  F --> C
```

| 步骤 | 行为 |
|------|------|
| 进入 Tab | `panel.js` → `refreshDownloadServer` → **自动开启**（若未手动停止且有目录） |
| 启动成功 | 服务 URL **写入剪贴板** |
| 停止 | 用户点停止后 `downloadUserStopped = true`，不再自动开 |

---

## 文件说明

| 文件 | 功能 |
|------|------|
| `server.js` | HTTP 服务、目录列表、访问日志、启停 |
| `thumbnails.js` | 视频封面生成与缓存（不写进用户共享目录） |

---

## 配置（`workflows.json`）

| 字段 | 含义 |
|------|------|
| `downloadServiceDir` | 共享根目录 |
| `lastDownloadServiceUrl` | 上次服务地址 |

---

## 入口

- IPC：`../register.js` → `WORKFLOW.DOWNLOAD_*`
- UI：`../js/panel.js` + `../html/panel.html`
