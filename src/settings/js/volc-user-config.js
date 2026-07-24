/**
 * @file volc-user-config.js
 *
 * LLM 用户配置（OpenAI 兼容）：读写 `volc-user-config.json`，解析当前厂商凭证。
 * 结构：llmProviders[]（厂商 → baseUrl / paths / pathModels / apiKey）+ activeLlmProviderId
 *
 * 写入：Preferences → LLM 配置
 * 读取：resolveVolcCredentials() ← pecado agent router / llm-server
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { app } = require('electron');

/** @deprecated 旧 apiMode；迁移用 */
const VOLC_API_MODES = {
  BOTS: 'bots',
  CODING_PLAN: 'coding_plan',
  CHAT: 'chat',
};

const DEFAULT_BOTS_MODEL = 'bot-20260424113808-wwggn';
const DEFAULT_CODING_PLAN_MODEL = 'ark-code-latest';
const DEFAULT_CHAT_MODEL = 'doubao-seed-2-1-pro-260628';

const VOLC_BASE_URL = 'https://ark.cn-beijing.volces.com';
const DEEPSEEK_BASE_URL = 'https://api.deepseek.com';

const VOLC_PATHS = [
  '/api/v3/chat/completions',
  '/api/coding/v3/chat/completions',
  '/api/v3/bots/chat/completions',
];
/** 路径 → 对应模型（火山） */
const VOLC_PATH_MODELS = {
  '/api/v3/chat/completions': [DEFAULT_CHAT_MODEL],
  '/api/coding/v3/chat/completions': [
    DEFAULT_CODING_PLAN_MODEL,
    'doubao-seed-2.0-code',
    'kimi-k2.5',
    'glm-4.7',
    'deepseek-v3.2',
  ],
  '/api/v3/bots/chat/completions': [DEFAULT_BOTS_MODEL],
};
const VOLC_MODELS = [
  ...VOLC_PATH_MODELS['/api/v3/chat/completions'],
  ...VOLC_PATH_MODELS['/api/coding/v3/chat/completions'],
  ...VOLC_PATH_MODELS['/api/v3/bots/chat/completions'],
];
const DEEPSEEK_PATHS = ['/v1/chat/completions'];
const DEEPSEEK_MODELS = ['deepseek-chat', 'deepseek-reasoner', 'deepseek-v4-pro'];
const DEEPSEEK_PATH_MODELS = {
  '/v1/chat/completions': DEEPSEEK_MODELS.slice(),
};

/** OpenAI 兼容通用接入 */
const GENERIC_BASE_URL = 'https://api.openai.com';
const GENERIC_PATHS = ['/v1/chat/completions'];
const GENERIC_MODELS = ['gpt-4o', 'gpt-4o-mini', 'o4-mini'];
const GENERIC_PATH_MODELS = {
  '/v1/chat/completions': GENERIC_MODELS.slice(),
};

const DEFAULT_LLM_PROVIDER_IDS = {
  VOLC: 'llm-volc',
  DEEPSEEK: 'llm-deepseek',
  GENERIC: 'llm-generic',
};

/** 深拷贝 path → models 映射 */
function clonePathModels(src) {
  /** @type {Record<string, string[]>} */
  const out = {};
  for (const [k, arr] of Object.entries(src || {})) {
    out[k] = Array.isArray(arr) ? arr.slice() : [];
  }
  return out;
}

/** 预制厂商：火山 / DeepSeek / 通用模型 */
function createDefaultLlmProviders() {
  return [
    {
      id: DEFAULT_LLM_PROVIDER_IDS.VOLC,
      name: '火山',
      baseUrl: VOLC_BASE_URL,
      paths: VOLC_PATHS.slice(),
      pathModels: clonePathModels(VOLC_PATH_MODELS),
      models: VOLC_MODELS.slice(),
      path: VOLC_PATHS[0],
      model: DEFAULT_CHAT_MODEL,
      apiKey: '',
    },
    {
      id: DEFAULT_LLM_PROVIDER_IDS.DEEPSEEK,
      name: 'DeepSeek',
      baseUrl: DEEPSEEK_BASE_URL,
      paths: DEEPSEEK_PATHS.slice(),
      pathModels: clonePathModels(DEEPSEEK_PATH_MODELS),
      models: DEEPSEEK_MODELS.slice(),
      path: DEEPSEEK_PATHS[0],
      model: 'deepseek-chat',
      apiKey: '',
    },
    {
      id: DEFAULT_LLM_PROVIDER_IDS.GENERIC,
      name: '通用模型',
      baseUrl: GENERIC_BASE_URL,
      paths: GENERIC_PATHS.slice(),
      pathModels: clonePathModels(GENERIC_PATH_MODELS),
      models: GENERIC_MODELS.slice(),
      path: GENERIC_PATHS[0],
      model: GENERIC_MODELS[0],
      apiKey: '',
    },
  ];
}

/** UI 预设（与配置同结构） */
const LLM_PRESETS = [
  {
    id: 'volc',
    label: '火山',
    baseUrl: VOLC_BASE_URL,
    paths: VOLC_PATHS.slice(),
    pathModels: clonePathModels(VOLC_PATH_MODELS),
    path: VOLC_PATHS[0],
    models: VOLC_MODELS.slice(),
  },
  {
    id: 'deepseek',
    label: 'DeepSeek',
    baseUrl: DEEPSEEK_BASE_URL,
    paths: DEEPSEEK_PATHS.slice(),
    pathModels: clonePathModels(DEEPSEEK_PATH_MODELS),
    path: DEEPSEEK_PATHS[0],
    models: DEEPSEEK_MODELS.slice(),
  },
  {
    id: 'generic',
    label: '通用模型',
    baseUrl: GENERIC_BASE_URL,
    paths: GENERIC_PATHS.slice(),
    pathModels: clonePathModels(GENERIC_PATH_MODELS),
    path: GENERIC_PATHS[0],
    models: GENERIC_MODELS.slice(),
  },
];

/** 展开为 path 查找用（兼容旧 volc_chat 等） */
function listPresetPathEntries() {
  const out = [];
  for (const pre of LLM_PRESETS) {
    const paths = Array.isArray(pre.paths) && pre.paths.length ? pre.paths : pre.path ? [pre.path] : [];
    for (const pt of paths) {
      out.push({ ...pre, path: pt });
    }
  }
  return out;
}

const VOLC_ENDPOINTS = {
  [VOLC_API_MODES.BOTS]: 'https://ark.cn-beijing.volces.com/api/v3/bots/chat/completions',
  [VOLC_API_MODES.CODING_PLAN]: 'https://ark.cn-beijing.volces.com/api/coding/v3/chat/completions',
  [VOLC_API_MODES.CHAT]: 'https://ark.cn-beijing.volces.com/api/v3/chat/completions',
};

function newLlmProfileId() {
  return crypto.randomUUID ? crypto.randomUUID() : `llm_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function getLlmPreset(idOrPath) {
  const v = String(idOrPath || '').trim();
  if (!v) return LLM_PRESETS.find((p) => p.id === 'generic');
  const legacyMap = {
    volc_chat: 'volc',
    volc_coding: 'volc',
    volc_bots: 'volc',
    openai: 'generic',
    custom: 'generic',
  };
  const mapped = legacyMap[v] || v;
  const byId = LLM_PRESETS.find((p) => p.id === mapped || p.id === v);
  if (byId) return byId;
  const byLabel = LLM_PRESETS.find((p) => p.label === v);
  if (byLabel) return byLabel;
  const byPath = listPresetPathEntries().find((p) => normalizePath(p.path) === normalizePath(v));
  if (byPath) return LLM_PRESETS.find((p) => p.id === byPath.id) || byPath;
  return LLM_PRESETS.find((p) => p.id === 'generic');
}

function normalizePath(pathValue) {
  let p = String(pathValue || '').trim();
  if (!p) return '';
  if (!p.startsWith('/')) p = `/${p}`;
  return p.replace(/\/{2,}/g, '/');
}

/**
 * Base URL + 路径 → 完整请求地址
 * @param {string} baseUrl
 * @param {string} [apiPath]
 */
function resolveChatCompletionsUrl(baseUrl, apiPath) {
  const base = String(baseUrl || '').trim().replace(/\/+$/, '');
  const p = normalizePath(apiPath);
  if (!base && !p) return '';
  // 已是完整 chat/completions URL
  if (/^https?:\/\//i.test(base) && /\/chat\/completions$/i.test(base) && !p) {
    return base;
  }
  if (!p) {
    if (!base) return '';
    if (/\/chat\/completions$/i.test(base)) return base;
    return `${base}/chat/completions`;
  }
  if (!base) return p;
  // path 已是绝对 URL
  if (/^https?:\/\//i.test(p)) return p.replace(/\/+$/, '');
  return `${base}${p}`;
}

function legacyModeToPath(mode) {
  if (mode === VOLC_API_MODES.BOTS) return '/api/v3/bots/chat/completions';
  if (mode === VOLC_API_MODES.CHAT) return '/api/v3/chat/completions';
  if (mode === VOLC_API_MODES.CODING_PLAN) return '/api/coding/v3/chat/completions';
  return '/v1/chat/completions';
}

function pathToLegacyMode(apiPath) {
  const p = normalizePath(apiPath);
  if (p.includes('/bots/')) return VOLC_API_MODES.BOTS;
  if (p.includes('/coding/')) return VOLC_API_MODES.CODING_PLAN;
  if (p.includes('/api/v3/')) return VOLC_API_MODES.CHAT;
  return VOLC_API_MODES.CHAT;
}

function legacyModeToApiType(mode) {
  if (mode === VOLC_API_MODES.BOTS) return 'volc_bots';
  if (mode === VOLC_API_MODES.CHAT) return 'volc_chat';
  if (mode === VOLC_API_MODES.CODING_PLAN) return 'volc_coding';
  return 'custom';
}

function apiTypeToLegacyMode(apiType) {
  if (apiType === 'volc_bots') return VOLC_API_MODES.BOTS;
  if (apiType === 'volc_chat') return VOLC_API_MODES.CHAT;
  if (apiType === 'volc_coding') return VOLC_API_MODES.CODING_PLAN;
  return VOLC_API_MODES.CHAT;
}

/**
 * 从旧 baseUrl（可能已含 /api/v3）拆出 host + path
 */
function splitLegacyBaseUrl(baseUrl, apiTypeOrPath) {
  let raw = String(baseUrl || '').trim().replace(/\/+$/, '');
  let apiPath = normalizePath(
    String(apiTypeOrPath || '').startsWith('/')
      ? apiTypeOrPath
      : ''
  );

  if (!apiPath && apiTypeOrPath) {
    const preset = getLlmPreset(apiTypeOrPath);
    if (preset?.path) apiPath = preset.path;
  }

  if (!apiPath && raw) {
    const known = listPresetPathEntries().find(
      (p) => p.path && raw.endsWith(p.path.replace(/\/+$/, ''))
    );
    if (known) {
      apiPath = known.path;
      raw = raw.slice(0, raw.length - known.path.length).replace(/\/+$/, '');
    } else if (/\/chat\/completions$/i.test(raw)) {
      try {
        const u = new URL(raw);
        apiPath = u.pathname;
        raw = `${u.protocol}//${u.host}`;
      } catch (_) {
        /* keep */
      }
    } else {
      // 旧版：host/api/v3 → 补 /chat/completions
      for (const pre of listPresetPathEntries()) {
        if (!pre.baseUrl || !pre.path) continue;
        const prefix = `${pre.baseUrl}${pre.path.replace(/\/chat\/completions$/i, '')}`;
        if (raw === prefix || raw.startsWith(`${pre.baseUrl}/`)) {
          if (raw === pre.baseUrl) {
            apiPath = pre.path;
            break;
          }
          const rest = raw.slice(pre.baseUrl.length);
          if (rest && !apiPath) {
            apiPath = normalizePath(
              `${rest}/chat/completions`.replace(
                /\/chat\/completions\/chat\/completions$/i,
                '/chat/completions'
              )
            );
            raw = pre.baseUrl;
            break;
          }
        }
      }
    }
  }

  if (!apiPath) apiPath = '/v1/chat/completions';
  if (!raw) {
    const preset = listPresetPathEntries().find((p) => p.path === apiPath);
    raw = preset?.baseUrl || '';
  }
  return { baseUrl: raw, path: apiPath };
}

/**
 * @param {unknown} raw
 * @returns {{
 *   id: string,
 *   name: string,
 *   baseUrl: string,
 *   paths: string[],
 *   pathModels: Record<string, string[]>,
 *   models: string[],
 *   path: string,
 *   model: string,
 *   apiKey: string,
 * }}
 */
function normalizeBaseUrlLike(value) {
  return String(value || '').trim().replace(/\/+$/, '').toLowerCase();
}

function defaultPathModelsForBase(baseUrl) {
  const u = String(baseUrl || '').toLowerCase();
  if (u.includes('volces.com') || u.includes('volcengine')) return clonePathModels(VOLC_PATH_MODELS);
  if (u.includes('deepseek')) return clonePathModels(DEEPSEEK_PATH_MODELS);
  return {};
}

/** 无 pathModels 时，按模型名猜归属路径 */
function guessPathForModel(model, paths) {
  const m = String(model || '').trim();
  if (!m) return '';
  if (/^bot-/i.test(m)) {
    return paths.find((p) => p.includes('/bots/')) || '';
  }
  if (/ark-code|seed-2\.0-code|kimi-k2|glm-4|deepseek-v3/i.test(m)) {
    return paths.find((p) => p.includes('/coding/')) || '';
  }
  return paths.find((p) => p.includes('/api/v3/chat') && !p.includes('/bots/')) || paths[0] || '';
}

function flattenPathModels(pathModels) {
  const out = [];
  const seen = new Set();
  for (const arr of Object.values(pathModels || {})) {
    if (!Array.isArray(arr)) continue;
    for (const m of arr) {
      const x = String(m || '').trim();
      if (!x || seen.has(x)) continue;
      seen.add(x);
      out.push(x);
    }
  }
  return out;
}

function modelsForProviderPath(provider, apiPath) {
  if (!provider) return [];
  const pt = normalizePath(apiPath) || normalizePath(provider.path) || '';
  const map = provider.pathModels && typeof provider.pathModels === 'object' ? provider.pathModels : null;
  if (map && pt && Array.isArray(map[pt]) && map[pt].length) {
    return map[pt].map((m) => String(m || '').trim()).filter(Boolean);
  }
  // 兼容旧数据：无映射时退回全部 models
  if (Array.isArray(provider.models) && provider.models.length) {
    return provider.models.map((m) => String(m || '').trim()).filter(Boolean);
  }
  return provider.model ? [String(provider.model).trim()] : [];
}

function normalizeLlmProvider(raw) {
  const p = raw && typeof raw === 'object' ? raw : {};
  const legacyType = String(p.apiType || '').trim();
  const explicitPath = String(p.path || '').trim();
  const split = splitLegacyBaseUrl(
    p.baseUrl != null ? p.baseUrl : '',
    explicitPath || legacyType
  );
  const baseUrl = String(split.baseUrl || p.baseUrl || '').trim().replace(/\/+$/, '');

  const paths = [];
  const pathSeen = new Set();
  const pushPath = (v) => {
    const x = normalizePath(v);
    if (!x || pathSeen.has(x)) return;
    pathSeen.add(x);
    paths.push(x);
  };
  if (Array.isArray(p.paths)) p.paths.forEach(pushPath);
  pushPath(explicitPath || split.path);
  if (p.pathModels && typeof p.pathModels === 'object') {
    Object.keys(p.pathModels).forEach(pushPath);
  }

  /** @type {Record<string, string[]>} */
  let pathModels = {};
  if (p.pathModels && typeof p.pathModels === 'object') {
    for (const [k, arr] of Object.entries(p.pathModels)) {
      const pt = normalizePath(k);
      if (!pt) continue;
      const list = [];
      const seen = new Set();
      for (const m of Array.isArray(arr) ? arr : []) {
        const x = String(m || '').trim();
        if (!x || seen.has(x)) continue;
        seen.add(x);
        list.push(x);
      }
      pathModels[pt] = list;
    }
  } else {
    // 迁移：优先用主机默认映射，再把旧 flat models 归入对应路径
    pathModels = defaultPathModelsForBase(baseUrl);
    const flatModels = [];
    if (Array.isArray(p.models)) {
      for (const m of p.models) {
        const x = String(m || '').trim();
        if (x) flatModels.push(x);
      }
    }
    if (p.model) flatModels.push(String(p.model).trim());
    for (const m of flatModels) {
      if (!m) continue;
      const target = guessPathForModel(m, paths.length ? paths : Object.keys(pathModels));
      const pt = normalizePath(target) || paths[0] || '';
      if (!pt) continue;
      if (!pathModels[pt]) pathModels[pt] = [];
      if (!pathModels[pt].includes(m)) pathModels[pt].push(m);
      pushPath(pt);
    }
  }

  // 确保每个 path 都有条目
  for (const pt of paths) {
    if (!pathModels[pt]) pathModels[pt] = [];
  }

  let pathVal = normalizePath(explicitPath || split.path || paths[0] || '');
  if (pathVal && !pathSeen.has(pathVal)) {
    paths.unshift(pathVal);
    pathSeen.add(pathVal);
    if (!pathModels[pathVal]) pathModels[pathVal] = [];
  }
  if (!pathVal && paths.length) pathVal = paths[0];

  const pathModelList = pathModels[pathVal] || [];
  let modelVal = String(p.model != null ? p.model : '').trim();
  if (modelVal && pathVal) {
    if (!pathModels[pathVal]) pathModels[pathVal] = [];
    if (!pathModels[pathVal].includes(modelVal)) pathModels[pathVal].unshift(modelVal);
  }
  if (!modelVal || !(pathModels[pathVal] || []).includes(modelVal)) {
    modelVal = (pathModels[pathVal] && pathModels[pathVal][0]) || flattenPathModels(pathModels)[0] || '';
  }

  const models = flattenPathModels(pathModels);
  const apiKey = String(p.apiKey != null ? p.apiKey : '').trim();
  const preset =
    LLM_PRESETS.find(
      (x) =>
        normalizePath(x.path) === pathVal ||
        (Array.isArray(x.paths) && x.paths.some((pt) => normalizePath(pt) === pathVal))
    ) ||
    LLM_PRESETS.find((x) => normalizeBaseUrlLike(x.baseUrl) === normalizeBaseUrlLike(baseUrl));
  const name = resolveProviderDisplayName(baseUrl, p.name, preset?.label);

  return {
    id: String(p.id || '').trim() || newLlmProfileId(),
    name,
    baseUrl,
    paths,
    pathModels,
    models,
    path: pathVal,
    model: modelVal,
    apiKey,
  };
}

/** 已知主机 → 厂商短名（火山 / DeepSeek / OpenAI） */
function brandNameFromBaseUrl(baseUrl) {
  const u = String(baseUrl || '').toLowerCase();
  if (u.includes('volces.com') || u.includes('volcengine')) return '火山';
  if (u.includes('deepseek')) return 'DeepSeek';
  if (u.includes('openai.com')) return 'OpenAI';
  return '';
}

const GENERIC_PROVIDER_NAMES = new Set([
  '方舟 Chat',
  'Coding Plan',
  '方舟 Bots',
  'OpenAI',
  'DeepSeek',
  '火山',
  '通用模型',
  '自定义（OpenAI 兼容）',
  '已迁移配置',
  '未命名厂商',
  '未命名配置',
]);

function resolveProviderDisplayName(baseUrl, rawName, presetLabel) {
  const brand = brandNameFromBaseUrl(baseUrl);
  const name = String(rawName || '').trim();
  // 通用模型：保留显式名称，不被 OpenAI 品牌覆盖
  if (name === '通用模型') return name;
  if (brand) {
    if (
      !name ||
      name.startsWith('/') ||
      name === baseUrl ||
      GENERIC_PROVIDER_NAMES.has(name)
    ) {
      return brand;
    }
    return name;
  }
  if (name && !name.startsWith('/')) return name;
  return presetLabel || baseUrl || '未命名厂商';
}

/** 旧 flat profiles → 按 baseUrl 合并为厂商 */
function mergeProfilesIntoProviders(profiles, activeProfileId) {
  /** @type {Map<string, ReturnType<typeof normalizeLlmProvider>>} */
  const byHost = new Map();
  let activeProviderId = '';

  for (const raw of profiles) {
    const flat = raw && typeof raw === 'object' ? raw : {};
    const base = String(flat.baseUrl || '').trim().replace(/\/+$/, '');
    if (!base) continue;
    const key = base.toLowerCase();
    const existing = byHost.get(key);
    const one = normalizeLlmProvider(flat);
    if (!existing) {
      byHost.set(key, one);
    } else {
      for (const pt of one.paths) {
        if (!existing.paths.includes(pt)) existing.paths.push(pt);
      }
      for (const m of one.models) {
        if (!existing.models.includes(m)) existing.models.push(m);
      }
      if (one.apiKey && !existing.apiKey) existing.apiKey = one.apiKey;
      // 名称：优先非 URL、非纯路径的短名
      if (one.name && one.name !== existing.baseUrl && !one.name.startsWith('/')) {
        if (existing.name === existing.baseUrl || existing.name.startsWith('/')) {
          existing.name = one.name;
        }
      }
      if (String(flat.id) === String(activeProfileId)) {
        existing.path = one.path || existing.path;
        existing.model = one.model || existing.model;
        if (one.apiKey) existing.apiKey = one.apiKey;
      }
    }
    if (String(flat.id) === String(activeProfileId)) {
      activeProviderId = byHost.get(key).id;
    }
  }

  const providers = [...byHost.values()];
  if (!activeProviderId && providers.length) activeProviderId = providers[0].id;
  return { providers, activeId: activeProviderId };
}

function migrateLegacyToProviders(j) {
  const providers = createDefaultLlmProviders();
  const volc = providers[0];
  const apiKey = j.volcArkApiKey != null ? String(j.volcArkApiKey).trim() : '';
  const model = j.volcArkModel != null ? String(j.volcArkModel).trim() : '';
  const mode = normalizeVolcApiMode(j.volcApiMode, model);
  const apiPath = legacyModeToPath(mode);
  if (apiKey) volc.apiKey = apiKey;
  if (apiPath) {
    if (!volc.paths.includes(apiPath)) volc.paths.unshift(apiPath);
    volc.path = apiPath;
  }
  if (model) {
    if (!volc.models.includes(model)) volc.models.unshift(model);
    volc.model = model;
  }
  return { providers, activeId: volc.id };
}

/**
 * @param {Record<string, unknown>} j
 * @returns {{ providers: ReturnType<typeof normalizeLlmProvider>[], activeId: string }}
 */
function resolveLlmProvidersFromRaw(j) {
  if (Array.isArray(j.llmProviders) && j.llmProviders.length) {
    const providers = j.llmProviders.map(normalizeLlmProvider);
    let activeId = String(j.activeLlmProviderId || '').trim();
    if (!providers.some((p) => p.id === activeId)) activeId = providers[0].id;
    return { providers, activeId };
  }
  if (Array.isArray(j.llmProfiles) && j.llmProfiles.length) {
    return mergeProfilesIntoProviders(j.llmProfiles, j.activeLlmProfileId);
  }
  if (j.volcArkApiKey || j.volcArkModel || j.volcApiMode) {
    return migrateLegacyToProviders(j);
  }
  const providers = createDefaultLlmProviders();
  return { providers, activeId: providers[0].id };
}

/** UI 兼容：厂商 → 扁平「当前选中」列表 */
function providersToUiProfiles(providers) {
  return providers.map((p) => ({
    id: p.id,
    name: p.name,
    baseUrl: p.baseUrl,
    path: p.path,
    model: p.model,
    apiKey: p.apiKey,
    paths: p.paths,
    pathModels: p.pathModels || {},
    models: p.models,
  }));
}

function getActiveLlmProvider(cfg) {
  const list = cfg.llmProviders || cfg.llmProfiles;
  const activeId = cfg.activeLlmProviderId || cfg.activeLlmProfileId;
  if (!Array.isArray(list) || !list.length) return null;
  return list.find((p) => p.id === activeId) || list[0];
}

// 兼容旧名
function getActiveLlmProfile(cfg) {
  return getActiveLlmProvider(cfg);
}

function isBotModel(model) {
  return /^bot-/i.test(String(model || '').trim());
}

function isCodingPlanCompatibleModel(model) {
  const m = String(model || '').trim();
  if (!m) return false;
  return !isBotModel(m);
}

function isChatCompatibleModel(model) {
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
  if (mode === VOLC_API_MODES.CHAT) {
    if (isChatCompatibleModel(m)) return m;
    return DEFAULT_CHAT_MODEL;
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
  if (
    v === VOLC_API_MODES.BOTS ||
    v === VOLC_API_MODES.CODING_PLAN ||
    v === VOLC_API_MODES.CHAT
  ) {
    return v;
  }
  if (v === 'volc_bots') return VOLC_API_MODES.BOTS;
  if (v === 'volc_chat') return VOLC_API_MODES.CHAT;
  if (v === 'volc_coding') return VOLC_API_MODES.CODING_PLAN;
  if (/^bot-/i.test(String(model || ''))) return VOLC_API_MODES.BOTS;
  return VOLC_API_MODES.CODING_PLAN;
}

/**
 * @param {string} apiMode
 */
function resolveVolcApiEndpoint(apiMode) {
  return VOLC_ENDPOINTS[apiMode] || VOLC_ENDPOINTS[VOLC_API_MODES.CHAT];
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

function emptyConfigShape() {
  const providers = createDefaultLlmProviders();
  const active = providers[0];
  const uiProfiles = providersToUiProfiles(providers);
  return {
    apiKey: '',
    model: active.model,
    volcApiMode: pathToLegacyMode(active.path),
    llmProviders: providers,
    activeLlmProviderId: active.id,
    llmProfiles: uiProfiles,
    activeLlmProfileId: active.id,
    llmBaseUrl: active.baseUrl,
    llmApiType: active.path,
    llmPath: active.path,
    llmPaths: active.paths.slice(),
    llmModels: active.models.slice(),
    llmName: active.name,
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

function readUserVolcConfig() {
  try {
    if (!app.isReady()) return emptyConfigShape();
    const j = readRawUserConfigFile();
    const hadProviders =
      (Array.isArray(j.llmProviders) && j.llmProviders.length > 0) ||
      (Array.isArray(j.llmProfiles) && j.llmProfiles.length > 0) ||
      Boolean(j.volcArkApiKey || j.volcArkModel || j.volcApiMode);
    const { providers, activeId } = resolveLlmProvidersFromRaw(j);
    // 无配置时把预制火山 / DeepSeek 写入文件
    if (!hadProviders && providers.length) {
      try {
        const p = getUserVolcConfigPath();
        const seeded = {
          llmProviders: providers.map((prov) => ({
            id: prov.id,
            name: prov.name,
            baseUrl: prov.baseUrl,
            paths: prov.paths,
            pathModels: prov.pathModels || {},
            models: prov.models,
            path: prov.path,
            model: prov.model,
            apiKey: prov.apiKey,
          })),
          activeLlmProviderId: activeId,
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
          codxDesignDepth: normalizeCodxDesignDepth(j.codxDesignDepth),
        };
        fs.mkdirSync(path.dirname(p), { recursive: true });
        fs.writeFileSync(p, JSON.stringify(seeded, null, 2), 'utf8');
      } catch (_) {
        /* ignore seed failure */
      }
    }
    const active = providers.find((p) => p.id === activeId) || providers[0] || null;
    const apiPath = active?.path || '/v1/chat/completions';
    const uiProfiles = providersToUiProfiles(providers);
    return {
      apiKey: active?.apiKey || '',
      model: active?.model || '',
      volcApiMode: pathToLegacyMode(apiPath),
      llmProviders: providers,
      activeLlmProviderId: active?.id || '',
      llmProfiles: uiProfiles,
      activeLlmProfileId: active?.id || '',
      llmBaseUrl: active?.baseUrl || '',
      llmPath: apiPath,
      llmApiType: apiPath,
      llmPaths: active?.paths || [],
      llmModels: active?.models || [],
      llmName: active?.name || '',
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
      codxDesignDepth: normalizeCodxDesignDepth(j.codxDesignDepth),
    };
  } catch {
    return emptyConfigShape();
  }
}

function applySelectionToProvider(provider, form) {
  const next = normalizeLlmProvider({
    ...provider,
    name: form.name != null && String(form.name).trim() ? form.name : provider.name,
    baseUrl: form.baseUrl != null ? form.baseUrl : provider.baseUrl,
    apiKey: form.apiKey != null ? form.apiKey : provider.apiKey,
    path: form.path != null ? form.path : provider.path,
    model: form.model != null ? form.model : provider.model,
    paths: provider.paths,
    models: provider.models,
    pathModels: provider.pathModels,
  });
  if (form.path != null) {
    const pt = normalizePath(form.path);
    if (pt && !next.paths.includes(pt)) next.paths.push(pt);
    if (pt && !next.pathModels[pt]) next.pathModels[pt] = [];
    next.path = pt || next.path;
  }
  if (form.model != null) {
    const m = String(form.model).trim();
    const pt = next.path;
    if (m && pt) {
      if (!next.pathModels[pt]) next.pathModels[pt] = [];
      if (!next.pathModels[pt].includes(m)) next.pathModels[pt].push(m);
    }
    if (m && !next.models.includes(m)) next.models.push(m);
    next.model = m || next.model;
  }
  next.models = flattenPathModels(next.pathModels);
  return next;
}

/**
 * @param {Record<string, unknown>} payload
 */
function writeUserVolcConfig(payload) {
  const p = getUserVolcConfigPath();
  const incoming = payload && typeof payload === 'object' ? payload : {};
  const existing = readRawUserConfigFile();
  const current = resolveLlmProvidersFromRaw(existing);

  let providers = current.providers.map(normalizeLlmProvider);
  let activeId = current.activeId;

  const saveMode = String(incoming.llmSaveMode || 'update').trim();
  const formProfile = {
    baseUrl: incoming.llmBaseUrl != null ? incoming.llmBaseUrl : incoming.baseUrl,
    path:
      incoming.llmPath != null
        ? incoming.llmPath
        : incoming.llmApiType != null
          ? incoming.llmApiType
          : incoming.path != null
            ? incoming.path
            : incoming.apiType,
    model:
      incoming.llmModel != null
        ? incoming.llmModel
        : incoming.volcArkModel != null
          ? incoming.volcArkModel
          : undefined,
    apiKey:
      incoming.llmApiKey != null
        ? incoming.llmApiKey
        : incoming.volcArkApiKey != null
          ? incoming.volcArkApiKey
          : undefined,
    name: incoming.llmName != null ? incoming.llmName : undefined,
  };

  if (Array.isArray(incoming.llmProviders)) {
    providers = incoming.llmProviders.map(normalizeLlmProvider);
    activeId =
      String(incoming.activeLlmProviderId || incoming.activeLlmProfileId || '').trim() ||
      providers[0]?.id ||
      '';
  } else if (saveMode === 'delete-provider' || saveMode === 'delete-path' || saveMode === 'delete-model') {
    const formBase = String(formProfile.baseUrl || '').trim().replace(/\/+$/, '');
    const idx = formBase
      ? providers.findIndex((x) => String(x.baseUrl || '').replace(/\/+$/, '') === formBase)
      : -1;
    if (idx < 0) throw new Error('未找到要删除的厂商配置');

    if (saveMode === 'delete-provider') {
      const removedId = providers[idx].id;
      providers = providers.filter((_, i) => i !== idx);
      if (activeId === removedId) activeId = providers[0]?.id || '';
    } else if (saveMode === 'delete-path') {
      const pt = normalizePath(formProfile.path || '');
      if (!pt) throw new Error('请指定要删除的路径');
      const prov = providers[idx];
      prov.paths = (prov.paths || []).filter((p) => p !== pt);
      if (prov.pathModels && typeof prov.pathModels === 'object') {
        delete prov.pathModels[pt];
      }
      if (prov.path === pt) {
        prov.path = prov.paths[0] || '';
        prov.model = (prov.pathModels && prov.pathModels[prov.path] && prov.pathModels[prov.path][0]) || '';
      }
      providers[idx] = normalizeLlmProvider({
        ...prov,
        paths: prov.paths,
        pathModels: prov.pathModels,
        path: prov.path,
        model: prov.model,
      });
    } else if (saveMode === 'delete-model') {
      const m = String(formProfile.model || '').trim();
      if (!m) throw new Error('请指定要删除的 Model');
      const prov = providers[idx];
      const curPath = normalizePath(formProfile.path || prov.path || '');
      if (prov.pathModels && typeof prov.pathModels === 'object' && curPath) {
        prov.pathModels[curPath] = (prov.pathModels[curPath] || []).filter((x) => x !== m);
      }
      prov.models = (prov.models || []).filter((x) => x !== m);
      if (prov.model === m) {
        prov.model =
          (prov.pathModels && curPath && prov.pathModels[curPath] && prov.pathModels[curPath][0]) ||
          prov.models[0] ||
          '';
      }
      providers[idx] = normalizeLlmProvider({
        ...prov,
        pathModels: prov.pathModels,
        models: prov.models,
        path: prov.path,
        model: prov.model,
      });
    }
  } else if (saveMode === 'add') {
    const baseUrl = String(formProfile.baseUrl || '').trim().replace(/\/+$/, '');
    if (!baseUrl) throw new Error('请填写 Base URL');
    if (!String(formProfile.apiKey || '').trim()) throw new Error('请填写 API Key');
    if (!String(formProfile.model || '').trim()) throw new Error('请填写 Model');
    if (!normalizePath(formProfile.path || '')) throw new Error('请填写路径');

    const idx = providers.findIndex(
      (x) => String(x.baseUrl || '').replace(/\/+$/, '') === baseUrl
    );
    if (idx >= 0) {
      providers[idx] = applySelectionToProvider(providers[idx], {
        ...formProfile,
        name: formProfile.name || providers[idx].name,
      });
      activeId = providers[idx].id;
    } else {
      const created = normalizeLlmProvider({
        id: newLlmProfileId(),
        name: formProfile.name || baseUrl,
        baseUrl,
        path: formProfile.path,
        model: formProfile.model,
        apiKey: formProfile.apiKey,
        paths: [formProfile.path],
        models: [formProfile.model],
      });
      providers = [...providers, created];
      activeId = created.id;
    }
  } else if (
    formProfile.baseUrl != null ||
    formProfile.apiKey != null ||
    formProfile.model != null ||
    formProfile.path != null
  ) {
    const formBase = String(formProfile.baseUrl || '').trim().replace(/\/+$/, '');
    const matchIdx = formBase
      ? providers.findIndex((x) => String(x.baseUrl || '').replace(/\/+$/, '') === formBase)
      : -1;

    if (matchIdx >= 0) {
      providers[matchIdx] = applySelectionToProvider(providers[matchIdx], formProfile);
      activeId = providers[matchIdx].id;
    } else {
      const targetId = String(
        incoming.activeLlmProviderId || incoming.activeLlmProfileId || activeId || ''
      ).trim();
      const idx = providers.findIndex((x) => x.id === targetId);
      if (idx >= 0) {
        providers[idx] = applySelectionToProvider(providers[idx], formProfile);
        activeId = providers[idx].id;
      } else if (formBase) {
        const created = normalizeLlmProvider({
          id: newLlmProfileId(),
          ...formProfile,
          paths: formProfile.path ? [formProfile.path] : [],
          models: formProfile.model ? [formProfile.model] : [],
        });
        providers = [...providers, created];
        activeId = created.id;
      }
    }
  } else if (
    incoming.activeLlmProviderId != null ||
    incoming.activeLlmProfileId != null
  ) {
    const want = String(
      incoming.activeLlmProviderId || incoming.activeLlmProfileId || ''
    ).trim();
    if (providers.some((x) => x.id === want)) activeId = want;
  }

  if (providers.length && !providers.some((x) => x.id === activeId)) {
    activeId = providers[0].id;
  }

  const active = providers.find((x) => x.id === activeId) || providers[0] || null;

  const base = {
    llmProviders: providers.map((prov) => ({
      id: prov.id,
      name: prov.name,
      baseUrl: prov.baseUrl,
      paths: prov.paths,
      pathModels: prov.pathModels || {},
      models: prov.models,
      path: prov.path,
      model: prov.model,
      apiKey: prov.apiKey,
    })),
    activeLlmProviderId: activeId,
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

  const uiProfiles = providersToUiProfiles(providers);
  return {
    configPath: p,
    configDir: path.dirname(p),
    ok: true,
    llmProviders: base.llmProviders,
    activeLlmProviderId: base.activeLlmProviderId,
    llmProfiles: uiProfiles,
    activeLlmProfileId: active?.id || '',
    llmBaseUrl: active?.baseUrl || '',
    llmPath: active?.path || '',
    llmApiType: active?.path || '',
    llmModel: active?.model || '',
    llmApiKey: active?.apiKey || '',
    llmName: active?.name || '',
    llmPaths: active?.paths || [],
    llmModels: active?.models || [],
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
    llmPresets: LLM_PRESETS,
  };
}

function resolveVolcCredentials() {
  const cfg = readUserVolcConfig();
  const active = getActiveLlmProvider(cfg);
  if (!active) {
    return {
      apiKey: '',
      model: '',
      apiMode: VOLC_API_MODES.CHAT,
      apiType: 'custom',
      path: '',
      baseUrl: '',
      endpoint: '',
    };
  }
  const endpoint = resolveChatCompletionsUrl(active.baseUrl, active.path);
  return {
    apiKey: active.apiKey,
    model: active.model,
    apiMode: pathToLegacyMode(active.path),
    apiType: active.path,
    path: active.path,
    baseUrl: active.baseUrl,
    endpoint,
  };
}

/**
 * @param {{ llmBaseUrl?: string, llmApiKey?: string, llmModel?: string, volcApiMode?: string, volcArkModel?: string }} payload
 * @returns {{ ok: true } | { ok: false, error: string }}
 */
function validateVolcConfig(payload) {
  const baseUrl = String(payload?.llmBaseUrl || '').trim();
  const apiPath = String(payload?.llmPath || payload?.llmApiType || '').trim();
  const apiKey = String(payload?.llmApiKey || payload?.volcArkApiKey || '').trim();
  const model = String(payload?.llmModel || payload?.volcArkModel || '').trim();
  if (!baseUrl) return { ok: false, error: '请填写 Base URL' };
  if (!apiPath) return { ok: false, error: '请填写路径' };
  if (!apiKey) return { ok: false, error: '请填写 API Key' };
  if (!model) return { ok: false, error: '请填写 Model' };
  if (!resolveChatCompletionsUrl(baseUrl, apiPath)) {
    return { ok: false, error: 'Base URL 或路径无效' };
  }
  return { ok: true };
}

function resolveGitGraphCommitLimit() {
  const { gitGraphCommitLimit } = readUserVolcConfig();
  return normalizeGitGraphCommitLimit(gitGraphCommitLimit);
}

const MISSING_KEY_ERROR =
  '未配置 API 密钥。请打开菜单 Preferences → LLM 配置，填写 Base URL、Model 与 API Key 并保存。';

module.exports = {
  readUserVolcConfig,
  writeUserVolcConfig,
  getUserVolcConfigPath,
  getUserConfigDir,
  resolveVolcCredentials,
  resolveModelForApiMode,
  resolveVolcApiEndpoint,
  resolveChatCompletionsUrl,
  normalizeVolcApiMode,
  isBotModel,
  isCodingPlanCompatibleModel,
  validateVolcConfig,
  resolveGitGraphCommitLimit,
  normalizeGitGraphCommitLimit,
  VOLC_API_MODES,
  VOLC_ENDPOINTS,
  LLM_PRESETS,
  createDefaultLlmProviders,
  modelsForProviderPath,
  DEFAULT_BOTS_MODEL,
  DEFAULT_CODING_PLAN_MODEL,
  DEFAULT_CHAT_MODEL,
  isChatCompatibleModel,
  getLlmPreset,
  normalizeLlmProvider,
  providersToUiProfiles,
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
