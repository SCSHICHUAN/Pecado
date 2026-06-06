/**
 * @file volc-user-config.js
 *
 * 【功能】火山方舟 API Key / Bot Model 的读写与运行时解析。
 *   - 持久化：app.getPath('userData')/volc-user-config.json
 *   - 写入：Preferences → 火山设置（settings/index.js IPC SAVE）
 *   - 读取：pecado/js/agent/router.js → resolveVolcCredentials()
 *
 * 【对外能力】
 *   - readUserVolcConfig() / writeUserVolcConfig({ volcArkApiKey, volcArkModel })
 *   - getUserVolcConfigPath() / getUserConfigDir()
 *   - resolveVolcCredentials() → { apiKey, model }
 *   - MISSING_KEY_ERROR
 */
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const DEFAULT_MODEL = 'bot-20260424113808-wwggn';

function getUserVolcConfigPath() {
  return path.join(app.getPath('userData'), 'volc-user-config.json');
}

function getUserConfigDir() {
  return app.getPath('userData');
}

function readUserVolcConfig() {
  try {
    if (!app.isReady()) return { apiKey: '', model: '' };
    const p = getUserVolcConfigPath();
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
  const p = getUserVolcConfigPath();
  const incoming = payload && typeof payload === 'object' ? payload : {};

  const base = {
    volcArkApiKey: String(incoming.volcArkApiKey ?? '').trim(),
    volcArkModel: String(incoming.volcArkModel ?? '').trim() || DEFAULT_MODEL,
  };

  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(base, null, 2), 'utf8');

  return {
    configPath: p,
    configDir: path.dirname(p),
    volcArkApiKey: base.volcArkApiKey,
    volcArkModel: base.volcArkModel,
  };
}

function resolveVolcCredentials() {
  const { apiKey, model } = readUserVolcConfig();
  return {
    apiKey,
    model: model || DEFAULT_MODEL,
  };
}

const MISSING_KEY_ERROR =
  '未配置 API 密钥。请打开菜单 Preferences → 火山设置，填写 Volc Ark API Key 并保存。';

module.exports = {
  readUserVolcConfig,
  writeUserVolcConfig,
  getUserVolcConfigPath,
  getUserConfigDir,
  resolveVolcCredentials,
  MISSING_KEY_ERROR,
};
