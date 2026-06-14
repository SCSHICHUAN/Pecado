# 文件服务模块

Tab **文件服务**：在局域网内用 HTTP 共享一个文件夹（手机浏览器可浏览/下载）。

## 文件说明

| 文件 | 功能 |
|------|------|
| `server.js` | HTTP 服务、目录列表、访问日志、启动/停止 |
| `thumbnails.js` | 视频封面生成与缓存 |

## 配置

持久化在 `../config-store.js` → `workflows.json`：

- `downloadServiceDir` — 共享目录
- `lastDownloadServiceUrl` — 上次服务地址

## 入口

- IPC：`../register.js` → `WORKFLOW.DOWNLOAD_*`
- UI：`../js/panel.js` + `../html/panel.html`
