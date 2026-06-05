/**
 * @file init-env.js
 *
 * 【功能】开发环境初始化 CLI：从 .env.example 复制生成项目根 .env（首次配置 API 密钥）。
 *   - 已存在 .env 则跳过并 exit 0
 *   - 缺少 .env.example 则报错 exit 1
 *   - 不参与 Electron 运行时；运行时加载由 bootstrap/load-env.js 负责
 *
 * 【调用方】package.json scripts `"env:init": "node src/electron/init/init-env.js"`
 *
 * 【对外能力】无 module.exports；进程级副作用 + console 提示后 exit
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
