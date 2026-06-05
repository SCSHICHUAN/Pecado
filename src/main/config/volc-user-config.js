/**
 * @file volc-user-config.js
 *
 * 方舟用户配置与凭证解析（供 llm-volc / agent/router 使用）。
 */
const fs = require('fs');
const path = require('path');
const { app } = require('electron');

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

function resolveVolcCredentials() {
  return {
    apiKey: getResolvedApiKey(),
    model: getResolvedModel(),
  };
}

const MISSING_KEY_ERROR =
  '未配置 API 密钥。任选其一：① 项目根目录 .env 中 VOLC_ARK_API_KEY=密钥（勿留空）② 复制 config/secrets.example.json 为 config/secrets.json，填写 volcArkApiKey。③ 应用内用户配置（若已接入）。文件须 UTF-8。';

module.exports = {
  readUserVolcConfig,
  writeUserVolcConfig,
  getResolvedApiKey,
  getResolvedModel,
  resolveVolcCredentials,
  MISSING_KEY_ERROR,
};
