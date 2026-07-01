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
/** Coding Plan 专用模型名，勿填 bot- 或在线推理 endpoint ID */
const DEFAULT_CODING_PLAN_MODEL = 'ark-code-latest';
const DEFAULT_MODEL = DEFAULT_BOTS_MODEL;

const CODING_PLAN_MODEL_HINT =
  'ark-code-latest、doubao-seed-2.0-code、kimi-k2.5、glm-4.7、deepseek-v3.2';

function isBotModel(model) {
  return /^bot-/i.test(String(model || '').trim());
}

function isCodingPlanCompatibleModel(model) {
  const m = String(model || '').trim();
  if (!m) return false;
  return !isBotModel(m);
}

/**
 * @param {string} model
 * @param {string} apiMode
 */
function resolveModelForApiMode(model, apiMode) {
  const m = String(model || '').trim();
  const mode = normalizeVolcApiMode(apiMode, m);
  if (mode === VOLC_API_MODES.CODING_PLAN) {
    if (isCodingPlanCompatibleModel(m)) return m;
    return DEFAULT_CODING_PLAN_MODEL;
  }
  if (m && isBotModel(m)) return m;
  return m || DEFAULT_BOTS_MODEL;
}

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
const CODX_EDITOR_THEME_OPTIONS = [
  'pecado-dark',
  'cursor-dark',
  'xcode-dark',
  'xcode-light',
  'vs-dark',
  'vs',
];
const DEFAULT_CODX_EDITOR_THEME = 'pecado-dark';
const DEFAULT_CODX_EDITOR_LINE_HEIGHT = 0;
const DEFAULT_CODX_EDITOR_LETTER_SPACING = 0;
const DEFAULT_CODX_EDITOR_SPACE_WIDTH = 0;
const CODX_EDITOR_TAB_SIZE_OPTIONS = [2, 4, 8];
const DEFAULT_CODX_EDITOR_TAB_SIZE = 2;
const DEFAULT_CODX_EDITOR_FONT_SIZE = 0;
const MIN_CODX_EDITOR_FONT_SIZE = 8;
const MAX_CODX_EDITOR_FONT_SIZE = 32;
const CODX_EDITOR_LINE_NUMBER_MODES = ['on', 'off', 'relative'];
const DEFAULT_CODX_EDITOR_LINE_NUMBERS = 'on';
const DEFAULT_CODX_EDITOR_LINE_NUMBER_MIN_CHARS = 3;
const MIN_CODX_EDITOR_LINE_NUMBER_MIN_CHARS = 2;
const MAX_CODX_EDITOR_LINE_NUMBER_MIN_CHARS = 6;
const DEFAULT_CODX_EDITOR_LINE_NUMBER_FONT_SIZE = 0;
const MIN_CODX_EDITOR_LINE_NUMBER_FONT_SIZE = 8;
const MAX_CODX_EDITOR_LINE_NUMBER_FONT_SIZE = 24;
const CODX_EDITOR_LINE_NUMBER_FONT_WEIGHT_OPTIONS = [0, 300, 400, 500, 600, 700];
const DEFAULT_CODX_EDITOR_LINE_NUMBER_FONT_WEIGHT = 0;
const MIN_CODX_EDITOR_LINE_HEIGHT = 0;
const MAX_CODX_EDITOR_LINE_HEIGHT = 48;
const MIN_CODX_EDITOR_LETTER_SPACING = -2;
const MAX_CODX_EDITOR_LETTER_SPACING = 10;
const MIN_CODX_EDITOR_SPACE_WIDTH = 0;
const MAX_CODX_EDITOR_SPACE_WIDTH = 24;

// Design summary depth
const DEFAULT_CODX_DESIGN_DEPTH = 4;
const MIN_CODX_DESIGN_DEPTH = 1;
const MAX_CODX_DESIGN_DEPTH = 8;

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

function normalizeCodxEditorTheme(value) {
  const key = String(value || '').trim();
  return CODX_EDITOR_THEME_OPTIONS.includes(key) ? key : DEFAULT_CODX_EDITOR_THEME;
}

function clampCodxNumber(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function normalizeCodxEditorLineHeight(value) {
  return clampCodxNumber(value, MIN_CODX_EDITOR_LINE_HEIGHT, MAX_CODX_EDITOR_LINE_HEIGHT, DEFAULT_CODX_EDITOR_LINE_HEIGHT);
}

function normalizeCodxEditorLetterSpacing(value) {
  return clampCodxNumber(
    value,
    MIN_CODX_EDITOR_LETTER_SPACING,
    MAX_CODX_EDITOR_LETTER_SPACING,
    DEFAULT_CODX_EDITOR_LETTER_SPACING
  );
}

function normalizeCodxEditorSpaceWidth(value) {
  return clampCodxNumber(
    value,
    MIN_CODX_EDITOR_SPACE_WIDTH,
    MAX_CODX_EDITOR_SPACE_WIDTH,
    DEFAULT_CODX_EDITOR_SPACE_WIDTH
  );
}

function normalizeCodxEditorTabSize(value) {
  const n = parseInt(String(value ?? ''), 10);
  return CODX_EDITOR_TAB_SIZE_OPTIONS.includes(n) ? n : DEFAULT_CODX_EDITOR_TAB_SIZE;
}

function normalizeCodxEditorFontSize(value) {
  const n = parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(n) || n === 0) return DEFAULT_CODX_EDITOR_FONT_SIZE;
  return Math.min(MAX_CODX_EDITOR_FONT_SIZE, Math.max(MIN_CODX_EDITOR_FONT_SIZE, n));
}

function normalizeCodxEditorLineNumbers(value) {
  const v = String(value || '').trim().toLowerCase();
  return CODX_EDITOR_LINE_NUMBER_MODES.includes(v) ? v : DEFAULT_CODX_EDITOR_LINE_NUMBERS;
}

function normalizeCodxEditorLineNumberMinChars(value) {
  const n = parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(n)) return DEFAULT_CODX_EDITOR_LINE_NUMBER_MIN_CHARS;
  return Math.min(
    MAX_CODX_EDITOR_LINE_NUMBER_MIN_CHARS,
    Math.max(MIN_CODX_EDITOR_LINE_NUMBER_MIN_CHARS, n)
  );
}

function normalizeCodxEditorLineNumberFontSize(value) {
  const n = parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(n) || n === 0) return DEFAULT_CODX_EDITOR_LINE_NUMBER_FONT_SIZE;
  return Math.min(
    MAX_CODX_EDITOR_LINE_NUMBER_FONT_SIZE,
    Math.max(MIN_CODX_EDITOR_LINE_NUMBER_FONT_SIZE, n)
  );
}

function normalizeCodxEditorLineNumberFontWeight(value) {
  const n = parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(n) || n === 0) return DEFAULT_CODX_EDITOR_LINE_NUMBER_FONT_WEIGHT;
  return CODX_EDITOR_LINE_NUMBER_FONT_WEIGHT_OPTIONS.includes(n) ? n : DEFAULT_CODX_EDITOR_LINE_NUMBER_FONT_WEIGHT;
}

function normalizeCodxDesignDepth(value) {
  const n = parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(n)) return DEFAULT_CODX_DESIGN_DEPTH;
  return Math.min(MAX_CODX_DESIGN_DEPTH, Math.max(MIN_CODX_DESIGN_DEPTH, n));
}

function readUserVolcConfig() {
  try {
    if (!app.isReady()) {
      return {
        apiKey: '',
        model: '',
        volcApiMode: VOLC_API_MODES.CODING_PLAN,
        gitGraphCommitLimit: DEFAULT_GIT_GRAPH_COMMIT_LIMIT,
        codxEditorTheme: DEFAULT_CODX_EDITOR_THEME,
        codxEditorLineHeight: DEFAULT_CODX_EDITOR_LINE_HEIGHT,
        codxEditorLetterSpacing: DEFAULT_CODX_EDITOR_LETTER_SPACING,
        codxEditorSpaceWidth: DEFAULT_CODX_EDITOR_SPACE_WIDTH,
        codxEditorTabSize: DEFAULT_CODX_EDITOR_TAB_SIZE,
        codxEditorFontSize: DEFAULT_CODX_EDITOR_FONT_SIZE,
        codxEditorLineNumbers: DEFAULT_CODX_EDITOR_LINE_NUMBERS,
        codxEditorLineNumberMinChars: DEFAULT_CODX_EDITOR_LINE_NUMBER_MIN_CHARS,
        codxEditorLineNumberFontSize: DEFAULT_CODX_EDITOR_LINE_NUMBER_FONT_SIZE,
        codxEditorLineNumberFontWeight: DEFAULT_CODX_EDITOR_LINE_NUMBER_FONT_WEIGHT,
        codxDesignDepth: DEFAULT_CODX_DESIGN_DEPTH,
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
      codxEditorTheme: normalizeCodxEditorTheme(j.codxEditorTheme),
      codxEditorLineHeight: normalizeCodxEditorLineHeight(j.codxEditorLineHeight),
      codxEditorLetterSpacing: normalizeCodxEditorLetterSpacing(j.codxEditorLetterSpacing),
      codxEditorSpaceWidth: normalizeCodxEditorSpaceWidth(j.codxEditorSpaceWidth),
      codxEditorTabSize: normalizeCodxEditorTabSize(j.codxEditorTabSize),
      codxEditorFontSize: normalizeCodxEditorFontSize(j.codxEditorFontSize),
      codxEditorLineNumbers: normalizeCodxEditorLineNumbers(j.codxEditorLineNumbers),
      codxEditorLineNumberMinChars: normalizeCodxEditorLineNumberMinChars(
        j.codxEditorLineNumberMinChars
      ),
      codxEditorLineNumberFontSize: normalizeCodxEditorLineNumberFontSize(
        j.codxEditorLineNumberFontSize
      ),
      codxEditorLineNumberFontWeight: normalizeCodxEditorLineNumberFontWeight(
        j.codxEditorLineNumberFontWeight
      ),
    };
  } catch {
    return {
      apiKey: '',
      model: '',
      volcApiMode: VOLC_API_MODES.CODING_PLAN,
      gitGraphCommitLimit: DEFAULT_GIT_GRAPH_COMMIT_LIMIT,
      codxEditorTheme: DEFAULT_CODX_EDITOR_THEME,
      codxEditorLineHeight: DEFAULT_CODX_EDITOR_LINE_HEIGHT,
      codxEditorLetterSpacing: DEFAULT_CODX_EDITOR_LETTER_SPACING,
      codxEditorSpaceWidth: DEFAULT_CODX_EDITOR_SPACE_WIDTH,
      codxEditorTabSize: DEFAULT_CODX_EDITOR_TAB_SIZE,
      codxEditorFontSize: DEFAULT_CODX_EDITOR_FONT_SIZE,
      codxEditorLineNumbers: DEFAULT_CODX_EDITOR_LINE_NUMBERS,
      codxEditorLineNumberMinChars: DEFAULT_CODX_EDITOR_LINE_NUMBER_MIN_CHARS,
      codxEditorLineNumberFontSize: DEFAULT_CODX_EDITOR_LINE_NUMBER_FONT_SIZE,
      codxEditorLineNumberFontWeight: DEFAULT_CODX_EDITOR_LINE_NUMBER_FONT_WEIGHT,
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
  const base = {
    volcArkApiKey: String(
      incoming.volcArkApiKey != null ? incoming.volcArkApiKey : existing.volcArkApiKey ?? ''
    ).trim(),
    volcArkModel: resolveModelForApiMode(modelRaw, volcApiMode),
    volcApiMode,
    gitGraphCommitLimit: normalizeGitGraphCommitLimit(
      incoming.gitGraphCommitLimit != null ? incoming.gitGraphCommitLimit : existing.gitGraphCommitLimit
    ),
    codxEditorTheme: normalizeCodxEditorTheme(
      incoming.codxEditorTheme != null ? incoming.codxEditorTheme : existing.codxEditorTheme
    ),
    codxEditorLineHeight: normalizeCodxEditorLineHeight(
      incoming.codxEditorLineHeight != null ? incoming.codxEditorLineHeight : existing.codxEditorLineHeight
    ),
    codxEditorLetterSpacing: normalizeCodxEditorLetterSpacing(
      incoming.codxEditorLetterSpacing != null
        ? incoming.codxEditorLetterSpacing
        : existing.codxEditorLetterSpacing
    ),
    codxEditorSpaceWidth: normalizeCodxEditorSpaceWidth(
      incoming.codxEditorSpaceWidth != null ? incoming.codxEditorSpaceWidth : existing.codxEditorSpaceWidth
    ),
    codxEditorTabSize: normalizeCodxEditorTabSize(
      incoming.codxEditorTabSize != null ? incoming.codxEditorTabSize : existing.codxEditorTabSize
    ),
    codxEditorFontSize: normalizeCodxEditorFontSize(
      incoming.codxEditorFontSize != null ? incoming.codxEditorFontSize : existing.codxEditorFontSize
    ),
    codxEditorLineNumbers: normalizeCodxEditorLineNumbers(
      incoming.codxEditorLineNumbers != null
        ? incoming.codxEditorLineNumbers
        : existing.codxEditorLineNumbers
    ),
    codxEditorLineNumberMinChars: normalizeCodxEditorLineNumberMinChars(
      incoming.codxEditorLineNumberMinChars != null
        ? incoming.codxEditorLineNumberMinChars
        : existing.codxEditorLineNumberMinChars
    ),
    codxEditorLineNumberFontSize: normalizeCodxEditorLineNumberFontSize(
      incoming.codxEditorLineNumberFontSize != null
        ? incoming.codxEditorLineNumberFontSize
        : existing.codxEditorLineNumberFontSize
    ),
    codxEditorLineNumberFontWeight: normalizeCodxEditorLineNumberFontWeight(
      incoming.codxEditorLineNumberFontWeight != null
        ? incoming.codxEditorLineNumberFontWeight
        : existing.codxEditorLineNumberFontWeight
    ),
    codxDesignDepth: normalizeCodxDesignDepth(
      incoming.codxDesignDepth != null ? incoming.codxDesignDepth : existing.codxDesignDepth
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
    codxEditorTheme: base.codxEditorTheme,
    codxEditorLineHeight: base.codxEditorLineHeight,
    codxEditorLetterSpacing: base.codxEditorLetterSpacing,
    codxEditorSpaceWidth: base.codxEditorSpaceWidth,
    codxEditorTabSize: base.codxEditorTabSize,
    codxEditorFontSize: base.codxEditorFontSize,
    codxEditorLineNumbers: base.codxEditorLineNumbers,
    codxEditorLineNumberMinChars: base.codxEditorLineNumberMinChars,
    codxEditorLineNumberFontSize: base.codxEditorLineNumberFontSize,
    codxEditorLineNumberFontWeight: base.codxEditorLineNumberFontWeight,
    codxDesignDepth: base.codxDesignDepth,
  };
}

function resolveVolcCredentials() {
  const { apiKey, model, volcApiMode } = readUserVolcConfig();
  const apiMode = normalizeVolcApiMode(volcApiMode, model);
  return {
    apiKey,
    model: resolveModelForApiMode(model, apiMode),
    apiMode,
    endpoint: resolveVolcApiEndpoint(apiMode),
  };
}

/**
 * @param {{ volcApiMode?: string, volcArkModel?: string }} payload
 * @returns {{ ok: true } | { ok: false, error: string }}
 */
function validateVolcConfig(payload) {
  const mode = normalizeVolcApiMode(payload?.volcApiMode, payload?.volcArkModel);
  const model = String(payload?.volcArkModel || '').trim();
  if (mode === VOLC_API_MODES.CODING_PLAN && model && !isCodingPlanCompatibleModel(model)) {
    return {
      ok: false,
      error: `Coding Plan 不能使用 Bot ID 或在线推理 Model ID。请填写：${CODING_PLAN_MODEL_HINT}`,
    };
  }
  if (mode === VOLC_API_MODES.BOTS && model && !isBotModel(model)) {
    return {
      ok: false,
      error: 'Bots 接口请填写 bot- 开头的 Bot ID；Coding Plan 请切换 API 类型。',
    };
  }
  return { ok: true };
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
  resolveModelForApiMode,
  resolveVolcApiEndpoint,
  normalizeVolcApiMode,
  isBotModel,
  isCodingPlanCompatibleModel,
  validateVolcConfig,
  CODING_PLAN_MODEL_HINT,
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
  CODX_EDITOR_THEME_OPTIONS,
  DEFAULT_CODX_EDITOR_THEME,
  normalizeCodxEditorTheme,
  DEFAULT_CODX_EDITOR_LINE_HEIGHT,
  DEFAULT_CODX_EDITOR_LETTER_SPACING,
  DEFAULT_CODX_EDITOR_SPACE_WIDTH,
  CODX_EDITOR_TAB_SIZE_OPTIONS,
  DEFAULT_CODX_EDITOR_TAB_SIZE,
  normalizeCodxEditorLineHeight,
  normalizeCodxEditorLetterSpacing,
  normalizeCodxEditorSpaceWidth,
  normalizeCodxEditorTabSize,
  DEFAULT_CODX_EDITOR_FONT_SIZE,
  MIN_CODX_EDITOR_FONT_SIZE,
  MAX_CODX_EDITOR_FONT_SIZE,
  normalizeCodxEditorFontSize,
  CODX_EDITOR_LINE_NUMBER_MODES,
  DEFAULT_CODX_EDITOR_LINE_NUMBERS,
  DEFAULT_CODX_EDITOR_LINE_NUMBER_MIN_CHARS,
  MIN_CODX_EDITOR_LINE_NUMBER_MIN_CHARS,
  MAX_CODX_EDITOR_LINE_NUMBER_MIN_CHARS,
  DEFAULT_CODX_EDITOR_LINE_NUMBER_FONT_SIZE,
  MIN_CODX_EDITOR_LINE_NUMBER_FONT_SIZE,
  MAX_CODX_EDITOR_LINE_NUMBER_FONT_SIZE,
  normalizeCodxEditorLineNumbers,
  normalizeCodxEditorLineNumberMinChars,
  normalizeCodxEditorLineNumberFontSize,
  CODX_EDITOR_LINE_NUMBER_FONT_WEIGHT_OPTIONS,
  DEFAULT_CODX_EDITOR_LINE_NUMBER_FONT_WEIGHT,
  normalizeCodxEditorLineNumberFontWeight,
  DEFAULT_CODX_DESIGN_DEPTH,
  MIN_CODX_DESIGN_DEPTH,
  MAX_CODX_DESIGN_DEPTH,
  normalizeCodxDesignDepth,
  MISSING_KEY_ERROR,
};
