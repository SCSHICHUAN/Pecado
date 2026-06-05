/**
 * @file load-env.js
 *
 * 【功能】主进程环境变量加载器，将密钥与配置合并进 process.env（空值不覆盖已有变量）。
 *   - 在多个根目录下查找：.env、.env.local、env、local.env
 *   - 解析 KEY=value（支持 # 注释、export 前缀、单双引号、UTF-8 BOM）
 *   - 合并 config/secrets.json 中的 volcArkApiKey / volcArkModel 等
 *   - 通过 MAIN_SRC_DIR（src/main）反推项目根，不依赖 cwd  alone
 *
 * 【调用方】
 *   - main.js：app 启动时 getDefaultSearchRoots + loadEnvFromSearchRoots
 *   - agent/router.js：每次 BOTS_CHAT_COMPLETION 前再次加载（刷新密钥）
 *
 * 【对外能力】
 *   - getDefaultSearchRoots() → [项目根, renderer, cwd]
 *   - loadEnvFromSearchRoots(rootDirs[])：合并 env 文件并打 [env] 日志
 *   - loadEnvFromProjectRoot(projectRoot)：单根快捷入口
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
