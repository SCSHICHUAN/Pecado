# Git 提交图谱（gitgraph）

**状态：v1 开发完成**（自研 SVG 时间线，不依赖 `@gitgraph/js` npm 包。）

## 模块文件

| 文件 | 职责 |
|------|------|
| `js/register.js` | 主进程 IPC：`GIT.*`、读取 `html/index.html` |
| `js/git-runner.js` | `git log/status/pull/push/commit`，条数读 Preferences |
| `js/log-parser.js` | `git log --pretty` → 时间线 commit 对象 |
| `js/project-root.js` | 读 `userData/mcp-project.json` 工程路径 |
| `js/timeline-layout.js` | Lane 分配、merge/fork 连线、节点坐标与颜色 |
| `js/index.js` | 渲染进程：DOM、滚动同步、选中、工具栏 |
| `html/index.html` | 面板片段（由 IPC 注入 `#panel-git`） |
| `css/index.css` | 网格布局与叠层样式 |

## 视觉叠层（自下而上）

```
.git-timeline
├── .git-timeline-graph-scroll     ← SVG 节点 + 分支连线（可横向滚）
├── .git-timeline-commit-layer
│   ├── .git-timeline-track-layer      ← 轨道 tint 条（节点线 → 右缘）
│   ├── .git-timeline-commit-fill-layer ← commit 实色条（文字列 → 右缘）
│   └── .git-timeline-commit-scroll    ← commit 文字（inner 可滚，层穿透点击）
```

## 节点如何显示

- **布局**：`timeline-layout.js` 按父子关系分配 `lane`，每条 lane 一种颜色（`LANE_COLORS`）。
- **SVG**：每 commit 一行 — `circle`（r=10，lane 色填充）+ `text`（作者首字母，白字）。
- **初始位置**：图区 scroll 使**最新 commit 圆心**在屏幕 **窗宽 × 1/4**。
- **选中**：仅 `circle` 可点；选中时 `stroke: #fff, stroke-width: 2`；轨道/色块/文字不变。

## 轨道如何显示

- **轨道条**（`.git-commit-bar`）：`background: rgba(lane, 0.24)`（`--git-row-tint`）。
- **水平范围**：`left = 节点竖线屏幕 x`，`right = 0`（窗口右缘）。
- **同步**：仅监听 **图区** `scrollLeft` → 更新每行 `--git-bar-left`。
- **与节点对齐**：`lineRight = scrollPadLeft + nodeX + lineWidth/2`（inner 坐标），屏幕 x = `lineRight - graphScrollLeft`。

## Commit 色块与文字

- **色块**：`solidTintColor(laneHex)` — 与轨道 tint 视觉一致的不透明实色；左缘随 commit 起始位置，右缘贴窗口。
- **文字**：白色/浅灰，左内边距 28px；inner 结构：`1 窗 pad + (文字区 + 1 窗)`。
- **默认**：文字左缘在屏幕 **窗宽 × 1/2**；底部右滑块在滑轨**中心**对应该位置。
- **滑块量程**：`最长 subject 宽 + 1 × 窗宽`；映射 `scrollLeft = range/2 + (center - anchorPx)`。

## 滚动与滚轮策略

| 操作 | 行为 |
|------|------|
| 图区底部左滚动条 | 图区 horizontal scroll |
| 图区底部右滚动条 | commit 屏幕 anchor（不改图区 scroll） |
| 时间线横向滚轮/触控板 | 只滚图区（绑在 `.git-timeline-graph-scroll`） |
| Commit 文字层 | `pointer-events: none`，不抢节点点击 |

## 数据与配置

- **Log 条数**：Preferences → 通用 → Git 提交图条数（100 / 200 / 500 / 1000 / 1500 / 5000）。
- **数据源**：`git log --all --reverse -n N`，经 `log-parser.js` 解析。
- **工程路径**：与 MCP Open Folder 共用；顶栏点击 → Finder 打开。

## Push 到远端

**应用内（推荐）**

1. File → Open Folder 打开 Git 仓库根目录。
2. 侧栏 **Git** → 工具栏 **Push**（主进程执行 `git push`）。
3. 若有未 push 提交，需先 **Commit** 或本地 commit 后再 Push。

**终端（Pecado 仓库本身）**

```bash
cd /path/to/Pecado
git add -A
git commit -m "你的说明"
git push origin main
```

首次推送新分支：`git push -u origin <branch>`。

## IPC 通道

见 `src/shared/ipc-channels.js` → `GIT.*`；渲染端 `window.electronAPI.gitGetState` 等（`preload/preload.js`）。
