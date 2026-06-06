/**
 * @file init-env.js
 *
 * 【功能】开发环境初始化 CLI：从 .env.example 复制生成项目根 .env。
 *   - 火山 API 凭证请在 Preferences → 火山设置 中配置，不由 .env 提供
 *
 * 【调用方】package.json scripts `"env:init": "node src/electron/init/init-env.js"`
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
console.log('[env:init] 火山 API 请在应用 Preferences → 火山设置 中填写并保存。');
