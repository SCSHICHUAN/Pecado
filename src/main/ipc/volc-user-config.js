/**
 * @file volc-user-config.js
 *
 * 方舟相关用户偏好：读写 `app.getPath('userData')` 下 JSON（`volcArkApiKey`、`volcArkModel`），并带默认 bot id。
 *
 * - `getResolvedApiKey`：`VOLC_ARK_API_KEY` / `ARK_API_KEY` / `DOUBAO_API_KEY` 环境变量优先，否则读用户文件。
 * - `getResolvedModel`：`VOLC_ARK_MODEL` 优先，否则用户文件，再退回 `DEFAULT_MODEL`。
 * - `register`：暴露 IPC GET（脱敏返回 hasApiKey 等）/ SET（写回 JSON）。
 */
const fs = require('fs');
const path = require('path');
const { app } = require('electron');
const { VOLC_USER_CONFIG } = require('../../shared/ipc-channels');

const DEFAULT_MODEL = 'bot-20260424113808-wwggn';

function configPath() {
  return path.join(app.getPath('userData'), 'volc-user-config.json');
}

function readUserVolcConfig() {
  try {
    if (!app.isReady()) return { apiKey: '', model: '' };
    const p = configPath();
    if (!fs.existsSync(p)) return { apiKey: '', model: '' };
    const j = JSON.parse(fs.readFileSync(p, 'utf8'));
    return {
      apiKey: j.volcArkApiKey != null ? String(j.volcArkApiKey).trim() : '',
      model: j.volcArkModel != null ? String(j.volcArkModel).trim() : '',
    };
  } catch {
    return { apiKey: '', model: '' };
  }
}

function writeUserVolcConfig(payload) {
  const p = configPath();
  let base = {};
  if (fs.existsSync(p)) {
    try {
      base = JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch (_) {
      base = {};
    }
  }
  if (payload && 'volcArkApiKey' in payload) {
    base.volcArkApiKey = String(payload.volcArkApiKey ?? '').trim();
  }
  if (payload && 'volcArkModel' in payload) {
    const m = String(payload.volcArkModel ?? '').trim();
    base.volcArkModel = m || DEFAULT_MODEL;
  }
  if (!base.volcArkModel) base.volcArkModel = DEFAULT_MODEL;
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(base, null, 2), 'utf8');
  return base;
}

function getResolvedApiKey() {
  const env = (
    process.env.VOLC_ARK_API_KEY ||
    process.env.ARK_API_KEY ||
    process.env.DOUBAO_API_KEY ||
    ''
  ).trim();
  if (env) return env;
  return readUserVolcConfig().apiKey;
}

function getResolvedModel() {
  const env = (process.env.VOLC_ARK_MODEL || '').trim();
  if (env) return env;
  const m = readUserVolcConfig().model;
  return m || DEFAULT_MODEL;
}

function register(ipcMain) {
  ipcMain.handle(VOLC_USER_CONFIG.GET, () => {
    const { apiKey, model } = readUserVolcConfig();
    return {
      hasApiKey: !!apiKey,
      volcArkModel: model || process.env.VOLC_ARK_MODEL || DEFAULT_MODEL,
      userDataPath: app.getPath('userData'),
    };
  });

  ipcMain.handle(VOLC_USER_CONFIG.SET, (event, payload) => {
    writeUserVolcConfig(payload || {});
    const { apiKey } = readUserVolcConfig();
    return { ok: true, hasApiKey: !!apiKey };
  });
}

module.exports = { register, readUserVolcConfig, getResolvedApiKey, getResolvedModel };
