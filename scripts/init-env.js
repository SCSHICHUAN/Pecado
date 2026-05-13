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
