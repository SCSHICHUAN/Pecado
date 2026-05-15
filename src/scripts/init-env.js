/**
 * @file init-env.js
 *
 * CLI：`npm run env:init`（在仓库根执行时 `process.cwd()` 为项目根）。
 *
 * 若根目录尚无 `.env`，从 `.env.example` 复制一份并提示编辑 `VOLC_ARK_API_KEY`；已存在则跳过。
 * 不参与运行时加载；运行时由主进程 `load-env.js` 读取。
 */
const fs = require('fs');
const path = require('path');

const root = process.cwd();
const envPath = path.join(root, '.env');
const examplePath = path.join(root, '.env.example');

if (fs.existsSync(envPath)) {
  console.log('[env:init] .env 已存在，跳过：', envPath);
  process.exit(0);
}

if (!fs.existsSync(examplePath)) {
  console.error('[env:init] 缺少 .env.example：', examplePath);
  process.exit(1);
}

fs.copyFileSync(examplePath, envPath);
console.log('[env:init] 已创建', envPath);
console.log('[env:init] 请编辑该文件，填写 VOLC_ARK_API_KEY=你的密钥，保存后重启应用。');
