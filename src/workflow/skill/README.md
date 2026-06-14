# Skill 模块

Tab **Skill**：编辑、保存、启用 Agent 可用的 Skill 文档。

**代码目录**：`src/workflow/skill/`  
**磁盘数据**：`~/Library/Application Support/pecado/workflow-dev-docs/`  
**索引字段**：`workflows.json` → `devDocs`（历史命名，表示 Skill 列表）

## 目录

```
skill/
  service.js       IPC 业务：列表/详情/创建/保存/删除、资源文件夹同步
  store.js         读写 SKILL.md、Layer JSON、索引条目
  resources.js     附属资源目录拷贝、读文件、执行脚本
  document.js      SKILL.md 三段式组装、frontmatter、Instructions 提取
  generate.js      从 URL/文件/手动内容生成 Skill（含 URL 抓取）
  llm-meta.js      LLM 补全 name/description
  agent/
    context.js     注入 Agent system（Instructions + Layer 树）
    tools.js       read_skill_* / run_skill_resource_script
  index.js         对外门面
```

## 相关入口

| 位置 | 作用 |
|------|------|
| `../register.js` | `WORKFLOW.DEV_DOCS_*` IPC |
| `pecado/js/agent/router.js` | `buildDevDocsContextForAi()` |
| `agent-loop/` | Skill tool 路由（module: `skill`） |

UI：`../html/panel.html` + `../js/panel.js`
