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
      return { apiKey: '', model: '', gitGraphCommitLimit: DEFAULT_GIT_GRAPH_COMMIT_LIMIT };
    }
    const j = readRawUserConfigFile();
    return {
      apiKey: j.volcArkApiKey != null ? String(j.volcArkApiKey).trim() : '',
      model: j.volcArkModel != null ? String(j.volcArkModel).trim() : '',
      gitGraphCommitLimit: normalizeGitGraphCommitLimit(j.gitGraphCommitLimit),
    };
  } catch {
    return { apiKey: '', model: '', gitGraphCommitLimit: DEFAULT_GIT_GRAPH_COMMIT_LIMIT };
  }
}

function writeUserVolcConfig(payload) {
  const p = getUserVolcConfigPath();
  const incoming = payload && typeof payload === 'object' ? payload : {};
  const existing = readRawUserConfigFile();

  const base = {
    volcArkApiKey: String(
      incoming.volcArkApiKey != null ? incoming.volcArkApiKey : existing.volcArkApiKey ?? ''
    ).trim(),
    volcArkModel: String(
      incoming.volcArkModel != null ? incoming.volcArkModel : existing.volcArkModel ?? ''
    ).trim() || DEFAULT_MODEL,
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
    gitGraphCommitLimit: base.gitGraphCommitLimit,
  };
}

function resolveVolcCredentials() {
  const { apiKey, model } = readUserVolcConfig();
  return {
    apiKey,
    model: model || DEFAULT_MODEL,
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
  resolveGitGraphCommitLimit,
  normalizeGitGraphCommitLimit,
  DEFAULT_GIT_GRAPH_COMMIT_LIMIT,
  GIT_GRAPH_COMMIT_LIMIT_OPTIONS,
  MIN_GIT_GRAPH_COMMIT_LIMIT,
  MAX_GIT_GRAPH_COMMIT_LIMIT,
  MISSING_KEY_ERROR,
};
