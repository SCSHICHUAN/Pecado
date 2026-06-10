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

const VOLC_API_MODES = {
  BOTS: 'bots',
  CODING_PLAN: 'coding_plan',
};

const VOLC_ENDPOINTS = {
  [VOLC_API_MODES.BOTS]: 'https://ark.cn-beijing.volces.com/api/v3/bots/chat/completions',
  [VOLC_API_MODES.CODING_PLAN]: 'https://ark.cn-beijing.volces.com/api/coding/v3/chat/completions',
};

const DEFAULT_BOTS_MODEL = 'bot-20260424113808-wwggn';
const DEFAULT_CODING_PLAN_MODEL = 'doubao-seed-2.0-code';
const DEFAULT_MODEL = DEFAULT_BOTS_MODEL;

/**
 * @param {unknown} value
 * @param {string} [model]
 */
function normalizeVolcApiMode(value, model) {
  const v = String(value || '').trim();
  if (v === VOLC_API_MODES.BOTS || v === VOLC_API_MODES.CODING_PLAN) return v;
  if (/^bot-/i.test(String(model || ''))) return VOLC_API_MODES.BOTS;
  return VOLC_API_MODES.CODING_PLAN;
}

/**
 * @param {string} apiMode
 */
function resolveVolcApiEndpoint(apiMode) {
  return VOLC_ENDPOINTS[apiMode] || VOLC_ENDPOINTS[VOLC_API_MODES.BOTS];
}
const DEFAULT_GIT_GRAPH_COMMIT_LIMIT = 500;
const GIT_GRAPH_COMMIT_LIMIT_OPTIONS = [100, 200, 500, 1000, 1500, 5000];
const MIN_GIT_GRAPH_COMMIT_LIMIT = 100;
const MAX_GIT_GRAPH_COMMIT_LIMIT = 5000;

function getUserVolcConfigPath() {
  return path.join(app.getPath('userData'), 'volc-user-config.json');
}

function getUserConfigDir() {
  return app.getPath('userData');
}

function readRawUserConfigFile() {
  try {
    if (!app.isReady()) return {};
    const p = getUserVolcConfigPath();
    if (!fs.existsSync(p)) return {};
    const j = JSON.parse(fs.readFileSync(p, 'utf8'));
    return j && typeof j === 'object' ? j : {};
  } catch {
    return {};
  }
}

function normalizeGitGraphCommitLimit(value) {
  const n = parseInt(String(value ?? ''), 10);
  if (GIT_GRAPH_COMMIT_LIMIT_OPTIONS.includes(n)) return n;
  if (!Number.isFinite(n)) return DEFAULT_GIT_GRAPH_COMMIT_LIMIT;
  let best = DEFAULT_GIT_GRAPH_COMMIT_LIMIT;
  let bestDist = Infinity;
  for (const opt of GIT_GRAPH_COMMIT_LIMIT_OPTIONS) {
    const dist = Math.abs(opt - n);
    if (dist < bestDist) {
      bestDist = dist;
      best = opt;
    }
  }
  return best;
}

function readUserVolcConfig() {
  try {
    if (!app.isReady()) {
      return {
        apiKey: '',
        model: '',
        volcApiMode: VOLC_API_MODES.CODING_PLAN,
        gitGraphCommitLimit: DEFAULT_GIT_GRAPH_COMMIT_LIMIT,
      };
    }
    const j = readRawUserConfigFile();
    const model = j.volcArkModel != null ? String(j.volcArkModel).trim() : '';
    const volcApiMode = normalizeVolcApiMode(j.volcApiMode, model);
    return {
      apiKey: j.volcArkApiKey != null ? String(j.volcArkApiKey).trim() : '',
      model,
      volcApiMode,
      gitGraphCommitLimit: normalizeGitGraphCommitLimit(j.gitGraphCommitLimit),
    };
  } catch {
    return {
      apiKey: '',
      model: '',
      volcApiMode: VOLC_API_MODES.CODING_PLAN,
      gitGraphCommitLimit: DEFAULT_GIT_GRAPH_COMMIT_LIMIT,
    };
  }
}

function writeUserVolcConfig(payload) {
  const p = getUserVolcConfigPath();
  const incoming = payload && typeof payload === 'object' ? payload : {};
  const existing = readRawUserConfigFile();

  const modelRaw = String(
    incoming.volcArkModel != null ? incoming.volcArkModel : existing.volcArkModel ?? ''
  ).trim();
  const volcApiMode = normalizeVolcApiMode(
    incoming.volcApiMode != null ? incoming.volcApiMode : existing.volcApiMode,
    modelRaw
  );
  const defaultModel =
    volcApiMode === VOLC_API_MODES.CODING_PLAN ? DEFAULT_CODING_PLAN_MODEL : DEFAULT_BOTS_MODEL;

  const base = {
    volcArkApiKey: String(
      incoming.volcArkApiKey != null ? incoming.volcArkApiKey : existing.volcArkApiKey ?? ''
    ).trim(),
    volcArkModel: modelRaw || defaultModel,
    volcApiMode,
    gitGraphCommitLimit: normalizeGitGraphCommitLimit(
      incoming.gitGraphCommitLimit != null ? incoming.gitGraphCommitLimit : existing.gitGraphCommitLimit
    ),
  };

  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(base, null, 2), 'utf8');

  return {
    configPath: p,
    configDir: path.dirname(p),
    volcArkApiKey: base.volcArkApiKey,
    volcArkModel: base.volcArkModel,
    volcApiMode: base.volcApiMode,
    gitGraphCommitLimit: base.gitGraphCommitLimit,
  };
}

function resolveVolcCredentials() {
  const { apiKey, model, volcApiMode } = readUserVolcConfig();
  const apiMode = normalizeVolcApiMode(volcApiMode, model);
  const defaultModel =
    apiMode === VOLC_API_MODES.CODING_PLAN ? DEFAULT_CODING_PLAN_MODEL : DEFAULT_BOTS_MODEL;
  return {
    apiKey,
    model: model || defaultModel,
    apiMode,
    endpoint: resolveVolcApiEndpoint(apiMode),
  };
}

function resolveGitGraphCommitLimit() {
  const { gitGraphCommitLimit } = readUserVolcConfig();
  return normalizeGitGraphCommitLimit(gitGraphCommitLimit);
}

const MISSING_KEY_ERROR =
  '未配置 API 密钥。请打开菜单 Preferences → 火山设置，填写 Volc Ark API Key 并保存。';

module.exports = {
  readUserVolcConfig,
  writeUserVolcConfig,
  getUserVolcConfigPath,
  getUserConfigDir,
  resolveVolcCredentials,
  resolveVolcApiEndpoint,
  normalizeVolcApiMode,
  resolveGitGraphCommitLimit,
  normalizeGitGraphCommitLimit,
  VOLC_API_MODES,
  VOLC_ENDPOINTS,
  DEFAULT_BOTS_MODEL,
  DEFAULT_CODING_PLAN_MODEL,
  DEFAULT_GIT_GRAPH_COMMIT_LIMIT,
  GIT_GRAPH_COMMIT_LIMIT_OPTIONS,
  MIN_GIT_GRAPH_COMMIT_LIMIT,
  MAX_GIT_GRAPH_COMMIT_LIMIT,
  MISSING_KEY_ERROR,
};
