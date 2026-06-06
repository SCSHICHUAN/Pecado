# Git 提交图谱（gitgraph）

**状态：v1 开发完成**（自研 SVG 时间线，不依赖 `@gitgraph/js` npm 包。）

## 显示策略（核心设计）

整窗宽叠层，**横向可滚区域故意做宽**，以便在极端 commit 数量、最长 subject、多 lane 时，仍能把任意一行滚到窗口内**任意水平位置**。

### 1. 节点图：3 × 窗宽

```
可滚 inner 总宽 = 3W
├── 左留白 1W
├── SVG 分支图（lane + 连线 + 节点）
└── 右留白 1W
```

- `W` = 面板可视宽度（`layoutWidth`）。
- **目的**：左右各留一整窗空白，任意节点的竖线/圆点都能通过图区 `scrollLeft` 出现在屏幕**从左到右的任意 x**（例如默认最新节点在 **W×1/4**，也可滚到贴左/贴右）。
- 实现：`GRAPH_SCROLL_VIEWPORT_RATIO = 3`；`scrollPadLeft = W`（`timeline-layout.js` + `index.js`）。

### 2. Commit 文字：内容宽 + 1 × 窗宽

```
commit inner 总宽 = 左留白 1W + 文字区
文字区宽 = 最长 subject 宽 + 1W
```

- **目的**：在文字区再留一整窗余量，commit 左缘可通过 commit `scrollLeft` + 底部右滑块出现在屏幕**任意 x**（默认左缘在 **W×1/2**）。
- 滑块量程：`最长文字宽 + 1W`（以窗宽中心为默认，向左右各可调半量程）。
- 实现：`COMMIT_SCROLL_PAD_LEFT_RATIO = 1`、`COMMIT_TEXT_VIEWPORT_RATIO = 1`。

### 3. 节点 ↔ commit 对应关系

每一行 commit **共享同一 `row-index`**，不靠横向像素对齐文字与节点，而靠**行 + 轨道**关联：

| 同 row | 元素 |
|--------|------|
| SVG 节点圆 | 该 commit 在 lane 上的位置 |
| 轨道 tint 条 | 从**节点竖线屏幕 x** 画到窗口右缘（随图区 scroll 更新 `--git-bar-left`） |
| Commit 色块 / 文字 | 同一 hash 的一行 subject |

用户从**节点**认 commit：看圆点颜色（lane）→ 同一行轨道横条 → 同一行 commit 文字。图区 scroll 与 commit scroll **独立**，轨道只跟图区 scroll，避免两层绑死。

### 4. 默认锚点（非量程限制）

| 元素 | 默认屏幕位置 |
|------|----------------|
| 最新节点圆心 | W × **1/4**（图区 scroll） |
| Commit 文字左缘 | W × **1/2**（commit scroll + 右滑块） |

量程由上面的 **3W / 文字+1W** 保证；锚点只是首次打开时的舒适默认值。

---

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
