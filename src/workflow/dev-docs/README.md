# 开发文档 / Skill 模块

Workflow **开发文档** Tab。**分层树设计、原始 Markdown 建树、省 token** → 根 [README § Skill](../../README.md#skill-开发文档分层读-markdown-的设计)。

**存储**：`~/Library/Application Support/pecado/workflow-dev-docs/`  
**索引**：`~/Library/Application Support/pecado/workflows.json` → `devDocs`

---

## 保存流程

校验顺序：**来源 → markdown/其他 → 读取 → 生成 → Skill 非空**。添加为本地草稿，保存成功才落盘。

```
readResourceData → generateSkillFromData → writeSkillMarkdown + buildMarkdownLayerTree + writeLayerJson
```

---

## 模块文件

| 文件 | 职责 |
|------|------|
| `service.js` | CRUD、`generateDevDocSkill`、Layer 刷新 |
| `generate-pipeline.js` | `readResourceData` + `generateSkillFromData` |
| `store.js` | 索引与 `.md` / `.json` 读写 |
| `skill-summary.js` | 三段式 Skill 组装 |
| `skill-llm-meta.js` | LLM 补 meta |
| `ai-context.js` | Instructions 注入 system |
| `agent-tools.js` | `read_skill_layer` / `read_skill_section` / `read_dev_doc_resources` |
| `fetch-url.js` | 链接抓取 |

共享：`src/markdown/read-markdown.js`、`skill-layer.js`

---

## UI

| 操作 | 行为 |
|------|------|
| 添加 skill | 本地草稿 |
| 保存 | 校验 → 读 data → 生成 md+json |
| 返回 | 无改动不提示 |
| 列表 · 编辑 | 批量删；全删输入 `skills` |

---

## 相关入口

| 位置 | 作用 |
|------|------|
| `workflow/register.js` | `WORKFLOW.DEV_DOCS_*` IPC |
| `workflow/js/index.js` | 开发文档 Tab UI |
| `pecado/js/agent/router.js` | `buildDevDocsContextForAi()` |
| `agent-loop/task-dispatcher.js` | `dev-docs` tool 路由 |

Workflow 其它 Tab → [../README.md](../README.md)。
