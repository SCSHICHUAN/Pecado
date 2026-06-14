# Workflow 辅助服务

三个 Tab 各对应一个脚本（无独立子目录）。

| 文件 | Tab | 功能 |
|------|-----|------|
| `organize.js` | 文件归类 | 将目标文件夹顶层文件按类型移入子目录 |
| `ppt.js` | 写 PPT | 根据主题生成 Markdown 大纲，写入 `workflow-output/ppt/` |
| `schedule.js` | 定时任务 | 按间隔或每日时刻启动本机应用 |

IPC 注册见 `../register.js`。
