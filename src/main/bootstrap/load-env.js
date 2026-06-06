/**
 * @file load-env.js
 *
 * 【功能】主进程环境变量加载器，将 .env 等文件合并进 process.env（空值不覆盖已有变量）。
 *   - 查找：.env、.env.local、env、local.env
 *   - 解析 KEY=value（支持 # 注释、export 前缀、单双引号、UTF-8 BOM）
 *   - 火山 API 凭证不在此加载，见 settings/volc-user-config.js
 *
 * 【调用方】main/main.js → app 启动时 loadEnvFromSearchRoots
 *
 * 【对外能力】
 *   - getDefaultSearchRoots() → [项目根, renderer, cwd]
 *   - loadEnvFromSearchRoots(rootDirs[])
 *   - loadEnvFromProjectRoot(projectRoot)
 */
const fs = require('fs');
const path = require('path');

/** 本文件位于 src/main/bootstrap，据此定位项目根 */
const MAIN_SRC_DIR = path.join(__dirname, '..');

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
    const n = applyParsedEnv(parsed);
    const keys = Object.keys(parsed).filter((k) => {
      const v = parsed[k];
      return v != null && String(v).trim() !== '';
    });
    total += n;
    loadedFiles.push(`${abs} (${keys.length} 个非空键)`);
  }

  if (loadedFiles.length) {
    console.log(`[env] 已合并 ${total} 项环境变量，来自：\n  ${loadedFiles.join('\n  ')}`);
  } else {
    console.warn(
      `[env] 未找到 .env / env 等文件。已检查（节选）：\n  ${tried.slice(0, 10).join('\n  ')}${tried.length > 10 ? '\n  …' : ''}\n火山 API 请在 Preferences → 火山设置 中配置。`
    );
  }
}

/** 与 main.js 使用同一套根目录（本文件在 src/main/bootstrap） */
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
