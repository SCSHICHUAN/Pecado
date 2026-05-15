/**
 * @file load-env.js
 *
 * 主进程侧环境变量加载：在项目根、`config/`、`appPath` 等路径查找 `.env` 与可选 `secrets`/示例文件，
 * 解析 `KEY=value`（支持 `#`、`export `、简单引号）后写入 `process.env`，并打 `[env]` 日志。
 *
 * - `getDefaultSearchRoots` / `loadEnvFromSearchRoots`：供 `main.js` 启动与 IPC 处理前多次合并加载（如发消息前刷新密钥）。
 * - 通过 `MAIN_SRC_DIR`（本文件所在 `src/main`）反推项目根，避免依赖仅 `cwd`。
 */
const fs = require('fs');
const path = require('path');

/** 本文件位于 src/main，据此定位项目根 */
const MAIN_SRC_DIR = __dirname;

function parseEnvText(text) {
  const out = {};
  const clean = text.replace(/^\uFEFF/, '');
  for (const line of clean.split(/\r?\n/)) {
    let trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    if (trimmed.toLowerCase().startsWith('export ')) {
      trimmed = trimmed.slice(7).trim();
    }
    const eq = trimmed.indexOf('=');
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let val = trimmed.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (key) out[key] = val;
  }
  return out;
}

function applyParsedEnv(parsed) {
  let n = 0;
  for (const [k, v] of Object.entries(parsed)) {
    const t = v == null ? '' : String(v).trim();
    if (t === '') continue;
    process.env[k] = t;
    n += 1;
  }
  return n;
}

function loadSecretsJsonUnderRoots(rootDirs) {
  const loaded = [];
  const uniqueRoots = [...new Set(rootDirs.filter(Boolean).map((d) => path.resolve(d)))];
  const files = new Set();
  for (const root of uniqueRoots) {
    files.add(path.join(root, 'config', 'secrets.json'));
  }
  files.add(path.join(MAIN_SRC_DIR, '..', '..', 'config', 'secrets.json'));

  for (const abs of files) {
    const p = path.resolve(abs);
    if (!fs.existsSync(p)) continue;
    try {
      const raw = fs.readFileSync(p, 'utf8');
      const j = JSON.parse(raw);
      let n = 0;
      if (j.volcArkApiKey && String(j.volcArkApiKey).trim()) {
        if (!process.env.VOLC_ARK_API_KEY) process.env.VOLC_ARK_API_KEY = String(j.volcArkApiKey).trim();
        n += 1;
      }
      if (j.arkApiKey && String(j.arkApiKey).trim() && !process.env.VOLC_ARK_API_KEY) {
        process.env.VOLC_ARK_API_KEY = String(j.arkApiKey).trim();
        n += 1;
      }
      if (j.volcArkModel && String(j.volcArkModel).trim()) {
        process.env.VOLC_ARK_MODEL = String(j.volcArkModel).trim();
        n += 1;
      }
      if (n) loaded.push(p);
    } catch (e) {
      console.warn(`[env] 读取 secrets.json 失败 ${p}:`, e.message);
    }
  }
  if (loaded.length) {
    console.log(`[env] 已从 config/secrets.json 合并密钥：\n  ${loaded.join('\n  ')}`);
  }
}

/**
 * 在多个「目录根」下查找环境文件，合并进 process.env；空值不会覆盖已有变量
 * @param {string[]} rootDirs
 */
function loadEnvFromSearchRoots(rootDirs) {
  const loadedFiles = [];
  let total = 0;
  const tried = [];

  const uniqueRoots = [...new Set(rootDirs.filter(Boolean).map((d) => path.resolve(d)))];
  const nameVariants = ['.env', '.env.local', 'env', 'local.env'];
  const filesToTry = [];
  for (const root of uniqueRoots) {
    for (const name of nameVariants) {
      filesToTry.push(path.join(root, name));
    }
  }

  const seenFiles = new Set();
  for (const envPath of filesToTry) {
    const abs = path.resolve(envPath);
    if (seenFiles.has(abs)) continue;
    seenFiles.add(abs);
    tried.push(abs);
    if (!fs.existsSync(abs)) continue;
    const parsed = parseEnvText(fs.readFileSync(abs, 'utf8'));
    const before = { ...process.env };
    const n = applyParsedEnv(parsed);
    const keys = Object.keys(parsed).filter((k) => {
      const v = parsed[k];
      return v != null && String(v).trim() !== '';
    });
    total += n;
    loadedFiles.push(`${abs} (${keys.length} 个非空键)`);
  }

  loadSecretsJsonUnderRoots(uniqueRoots);

  if (loadedFiles.length) {
    console.log(`[env] 已合并 ${total} 项环境变量，来自：\n  ${loadedFiles.join('\n  ')}`);
  } else {
    console.warn(
      `[env] 未找到 .env / env 等文件。已检查（节选）：\n  ${tried.slice(0, 10).join('\n  ')}${tried.length > 10 ? '\n  …' : ''}\n可执行 npm run env:init，或在项目根 config/secrets.json 参考 secrets.example.json`
    );
  }
}

/** 与 main.js 使用同一套根目录（本文件在 src/main） */
function getDefaultSearchRoots() {
  return [
    path.join(MAIN_SRC_DIR, '..', '..'),
    path.join(MAIN_SRC_DIR, '..', 'renderer'),
    process.cwd(),
  ];
}

function loadEnvFromProjectRoot(projectRoot) {
  loadEnvFromSearchRoots([projectRoot, process.cwd()]);
}

module.exports = { loadEnvFromSearchRoots, loadEnvFromProjectRoot, getDefaultSearchRoots };
