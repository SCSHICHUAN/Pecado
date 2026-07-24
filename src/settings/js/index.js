/**
 * @file index.js
 *
 * Preferences 窗口：LLM 厂商配置（浏览只读下拉 / 添加可编辑可删）与通用外观项。
 *
 * 浏览：Base URL（右上厂商名）/ 路径 / Model / API Key — 点输入框选配置
 * 添加：厂商 + 上述字段可输入；下拉项可删除并写回配置文件
 * 路径与 Model 通过 pathModels 对应
 */
const PANEL_META = {
  llm: {
    title: 'LLM 配置',
    desc: '火山 / DeepSeek / 通用模型：点击选择路径与 Model；添加时可编辑删除。',
  },
  general: { title: '通用', desc: 'Git 提交图与其它基础选项。' },
  appearance: { title: '外观', desc: '主题与界面显示偏好。' },
  shortcuts: { title: '快捷键', desc: '查看常用键盘快捷键。' },
  about: { title: '关于', desc: '应用版本与说明。' },
};

const EDITABLE_PANELS = new Set(['llm', 'general']);
const GIT_GRAPH_LIMIT_OPTIONS = [100, 200, 500, 1000, 1500, 5000];

const navItems = document.querySelectorAll('.nav-item');
const panels = document.querySelectorAll('.panel');
const detailTitle = document.getElementById('detail-title');
const detailDesc = document.getElementById('detail-desc');
const saveBtn = document.getElementById('save-btn');
const addBtn = document.getElementById('add-btn');
const cancelBtn = document.getElementById('cancel-btn');
const statusEl = document.getElementById('status');

const vendorNameEl = document.getElementById('llm-vendor-name');
const vendorNameGroupEl = document.getElementById('llm-vendor-name-group');
const baseUrlEl = document.getElementById('llm-base-url');
const baseUrlVendorEl = document.getElementById('llm-base-url-vendor');
const pathEl = document.getElementById('llm-path');
const modelEl = document.getElementById('llm-model');
const apiKeyEl = document.getElementById('llm-api-key');
const llmHintEl = document.getElementById('llm-hint');
const vendorMenuEl = document.getElementById('llm-vendor-menu');
const baseUrlMenuEl = document.getElementById('llm-base-url-menu');
const pathMenuEl = document.getElementById('llm-path-menu');
const modelMenuEl = document.getElementById('llm-model-menu');

const gitGraphLimitEl = document.getElementById('git-graph-limit');
const codxEditorThemeEl = document.getElementById('codx-editor-theme');
const codxEditorLineHeightEl = document.getElementById('codx-editor-line-height');
const codxEditorLetterSpacingEl = document.getElementById('codx-editor-letter-spacing');
const codxEditorSpaceWidthEl = document.getElementById('codx-editor-space-width');
const codxEditorTabSizeEl = document.getElementById('codx-editor-tab-size');
const codxEditorFontSizeEl = document.getElementById('codx-editor-font-size');
const codxEditorLineNumbersEl = document.getElementById('codx-editor-line-numbers');
const codxEditorLineNumberMinCharsEl = document.getElementById('codx-editor-line-number-min-chars');
const codxEditorLineNumberFontSizeEl = document.getElementById('codx-editor-line-number-font-size');
const codxEditorLineNumberFontWeightEl = document.getElementById('codx-editor-line-number-font-weight');
const codxDesignDepthEl = document.getElementById('codx-design-depth');
const configDirBtn = document.getElementById('config-dir-btn');

let activePanel = 'llm';
let currentConfigDir = '';
/** @type {Array<{id:string,name:string,baseUrl:string,path:string,model:string,apiKey:string,paths?:string[],models?:string[]}>} */
let llmProfiles = [];
let activeLlmProfileId = '';
/** @type {Array<{id:string,label:string,baseUrl:string,path:string,paths?:string[],models:string[]}>} */
let llmPresets = [];
/** 'browse' | 'add' */
let llmUiMode = 'browse';
let suppressLinkSync = false;

/** @type {Record<string, { path: string, model: string, apiKey: string, profileId: string }>} */
const lastByHost = Object.create(null);

function formatConfigDirDisplay(dir) {
  return dir ? dir.replace(/ /g, '\\ ') : '';
}

function showConfigDir(configDir) {
  currentConfigDir = configDir || '';
  if (!configDirBtn) return;
  if (!configDir) {
    configDirBtn.textContent = '保存后生成';
    configDirBtn.disabled = true;
    return;
  }
  configDirBtn.textContent = formatConfigDirDisplay(configDir);
  configDirBtn.disabled = false;
  configDirBtn.title = `在 Finder 中打开并选中配置文件`;
}

async function openConfigDir() {
  if (!currentConfigDir) return;
  const api = requireSettingsAPI();
  if (!api || typeof api.openConfigDir !== 'function') return;
  const result = await api.openConfigDir();
  if (result && !result.ok) {
    setStatus(result.error || '无法打开配置目录', true);
  }
}

if (configDirBtn) {
  configDirBtn.addEventListener('click', () => {
    openConfigDir().catch((e) => setStatus(e.message || String(e), true));
  });
}

function setStatus(message, isError) {
  statusEl.textContent = message || '';
  statusEl.classList.toggle('error', Boolean(isError));
}

function requireSettingsAPI() {
  const api = window.settingsAPI;
  if (!api) {
    setStatus('设置接口未就绪，请完全退出应用后重新打开。', true);
    return null;
  }
  return api;
}

function normalizeBaseUrl(value) {
  return String(value || '').trim().replace(/\/+$/, '');
}

function uniqueStrings(list) {
  const out = [];
  const seen = new Set();
  for (const v of list) {
    const s = String(v || '').trim();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

/** 有已选且在列表中 → 已选；否则 → 第一项 */
function pickSelected(list, preferred) {
  const items = uniqueStrings(list);
  if (!items.length) return '';
  const pref = String(preferred || '').trim();
  if (pref && items.includes(pref)) return pref;
  return items[0];
}

function hostLabel(baseUrl) {
  const base = normalizeBaseUrl(baseUrl);
  const profile = llmProfiles.find((p) => normalizeBaseUrl(p.baseUrl) === base);
  if (profile?.name) return profile.name;
  const u = base.toLowerCase();
  if (u.includes('volces.com') || u.includes('volcengine')) return '火山';
  if (u.includes('deepseek')) return 'DeepSeek';
  if (u.includes('openai.com')) return 'OpenAI';
  const preset = llmPresets.find((p) => normalizeBaseUrl(p.baseUrl) === base);
  if (preset?.label) return preset.label;
  return base;
}

function getProviderById(id) {
  const want = String(id || '').trim();
  if (!want) return null;
  return llmProfiles.find((p) => p.id === want) || null;
}

function getProviderByBase(baseUrl) {
  const base = normalizeBaseUrl(baseUrl);
  if (!base) return null;
  return llmProfiles.find((p) => normalizeBaseUrl(p.baseUrl) === base) || null;
}

function getProviderByName(name) {
  const n = String(name || '').trim();
  if (!n) return null;
  return (
    llmProfiles.find((p) => p.name === n) ||
    llmPresets.find((p) => p.label === n || p.id === n) ||
    null
  );
}

function providerPaths(provider) {
  if (!provider) return [];
  if (Array.isArray(provider.paths) && provider.paths.length) return uniqueStrings(provider.paths);
  return provider.path ? [String(provider.path).trim()] : [];
}

function providerModels(provider, apiPath) {
  if (!provider) return [];
  const pt = String(apiPath || provider.path || '').trim();
  if (provider.pathModels && typeof provider.pathModels === 'object' && pt) {
    const list = provider.pathModels[pt];
    if (Array.isArray(list) && list.length) return uniqueStrings(list);
  }
  if (Array.isArray(provider.models) && provider.models.length) return uniqueStrings(provider.models);
  return provider.model ? [String(provider.model).trim()] : [];
}

function presetsForHost(baseUrl) {
  const base = normalizeBaseUrl(baseUrl);
  if (!base) return llmPresets.filter((p) => p.id !== 'custom' && p.baseUrl);
  return llmPresets.filter((p) => p.baseUrl && normalizeBaseUrl(p.baseUrl) === base);
}

function pathsForBase(baseUrl) {
  const provider = getProviderByBase(baseUrl);
  if (provider) return providerPaths(provider);
  const paths = [];
  for (const pre of presetsForHost(baseUrl)) {
    if (Array.isArray(pre.paths) && pre.paths.length) paths.push(...pre.paths);
    else if (pre.path) paths.push(pre.path);
  }
  return uniqueStrings(paths);
}

/** 按当前路径取对应模型；无映射时退回该厂商全部 */
function modelsForBase(baseUrl, apiPath) {
  const provider = getProviderByBase(baseUrl);
  const path = String(apiPath || '').trim();
  if (provider) return providerModels(provider, path || provider.path);
  const models = [];
  for (const pre of presetsForHost(baseUrl)) {
    if (pre.pathModels && path && Array.isArray(pre.pathModels[path])) {
      models.push(...pre.pathModels[path]);
      continue;
    }
    if (pre.models?.length) models.push(...pre.models);
  }
  return uniqueStrings(models);
}

function vendorOptions() {
  /** @type {Array<{ value: string, label: string, baseUrl: string, deletable?: boolean, deleteKind?: string }>} */
  const items = [];
  const seen = new Set();
  for (const p of llmProfiles) {
    const name = String(p.name || hostLabel(p.baseUrl)).trim();
    const base = normalizeBaseUrl(p.baseUrl);
    if (!name || !base || seen.has(name)) continue;
    seen.add(name);
    items.push({
      value: name,
      label: name,
      baseUrl: base,
      deletable: true,
      deleteKind: 'provider',
    });
  }
  for (const pre of llmPresets) {
    if (pre.id === 'custom' || !pre.baseUrl) continue;
    const name = String(pre.label || '').trim();
    const base = normalizeBaseUrl(pre.baseUrl);
    if (!name || !base || seen.has(name)) continue;
    seen.add(name);
    items.push({ value: name, label: name, baseUrl: base, deletable: false });
  }
  return items;
}

function baseUrlOptions() {
  return vendorOptions().map((v) => ({
    value: v.baseUrl,
    label: v.baseUrl,
    vendor: v.label,
    baseUrl: v.baseUrl,
    deletable: Boolean(v.deletable),
    deleteKind: v.deletable ? 'provider' : undefined,
  }));
}

function pathOptions() {
  const base = normalizeBaseUrl(baseUrlEl?.value);
  const provider = getProviderByBase(base);
  return pathsForBase(base).map((p) => ({
    value: p,
    label: p,
    baseUrl: base,
    deletable: Boolean(provider),
    deleteKind: 'path',
  }));
}

function modelOptions() {
  const base = normalizeBaseUrl(baseUrlEl?.value);
  const apiPath = String(pathEl?.value || '').trim();
  const provider = getProviderByBase(base);
  return modelsForBase(base, apiPath).map((m) => ({
    value: m,
    label: m,
    baseUrl: base,
    path: apiPath,
    deletable: Boolean(provider),
    deleteKind: 'model',
  }));
}

function closeAllComboMenus(except) {
  for (const menu of [vendorMenuEl, baseUrlMenuEl, pathMenuEl, modelMenuEl]) {
    if (!menu || menu === except) continue;
    menu.hidden = true;
  }
}

/**
 * 可输入 + 可下拉的 combo
 * 浏览态：不可编辑，点击输入框直接下拉
 * 添加态：可输入，仅点 ▾ 打开；选项右侧可删除（已保存项）
 */
function bindCombo(input, menu, getOptions, onPick) {
  if (!input || !menu) return;
  const root = input.closest('.combo');
  const toggle = root?.querySelector('.combo-toggle');

  function render(filterText, forceAll) {
    const options = getOptions() || [];
    const typed = String(filterText || '').trim().toLowerCase();
    const exact = options.some((o) => String(o.value).toLowerCase() === typed);
    const showAll = forceAll || !typed || exact || llmUiMode === 'browse';
    const filtered = showAll
      ? options
      : options.filter((o) => {
          const v = String(o.value || '').toLowerCase();
          const l = String(o.label || o.value || '').toLowerCase();
          const n = String(o.vendor || '').toLowerCase();
          return v.includes(typed) || l.includes(typed) || n.includes(typed);
        });

    menu.innerHTML = '';
    if (!filtered.length) {
      const li = document.createElement('li');
      li.className = 'muted';
      li.textContent = options.length
        ? '无匹配项'
        : llmUiMode === 'add'
          ? '暂无选项，可手动输入后保存添加'
          : '暂无选项';
      menu.appendChild(li);
    } else {
      for (const opt of filtered) {
        const li = document.createElement('li');
        li.classList.add('combo-opt-row');
        li.dataset.value = opt.value;

        const main = document.createElement('div');
        main.className = 'combo-opt-main';
        if (opt.vendor) {
          const urlSpan = document.createElement('span');
          urlSpan.className = 'combo-opt-url';
          urlSpan.textContent = opt.label || opt.value;
          const nameSpan = document.createElement('span');
          nameSpan.className = 'combo-opt-vendor';
          nameSpan.textContent = opt.vendor;
          main.appendChild(urlSpan);
          main.appendChild(nameSpan);
        } else {
          const labelSpan = document.createElement('span');
          labelSpan.className = 'combo-opt-label';
          labelSpan.textContent = opt.label || opt.value;
          main.appendChild(labelSpan);
        }
        li.appendChild(main);

        if (llmUiMode === 'add' && opt.deletable && opt.deleteKind) {
          const delBtn = document.createElement('button');
          delBtn.type = 'button';
          delBtn.className = 'combo-opt-delete';
          delBtn.textContent = '删除';
          delBtn.addEventListener('mousedown', (e) => {
            e.preventDefault();
            e.stopPropagation();
            deleteLlmOption(opt)
              .then(() => {
                if (!menu.hidden) render(input.value, true);
              })
              .catch((err) => setStatus(err.message || String(err), true));
          });
          li.appendChild(delBtn);
        }

        if (String(opt.value) === String(input.value || '').trim()) li.classList.add('active');
        main.addEventListener('mousedown', (e) => {
          e.preventDefault();
          suppressLinkSync = true;
          input.value = opt.value;
          suppressLinkSync = false;
          menu.hidden = true;
          if (typeof onPick === 'function') onPick(opt.value);
        });
        menu.appendChild(li);
      }
    }
    menu.hidden = false;
  }

  function open(forceAll) {
    closeAllComboMenus(menu);
    render(input.value, forceAll);
  }

  input.addEventListener('mousedown', (e) => {
    if (llmUiMode !== 'browse' || !input.readOnly) return;
    e.preventDefault();
    if (menu.hidden) open(true);
    else menu.hidden = true;
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') menu.hidden = true;
    if (llmUiMode === 'browse' && input.readOnly) {
      if (e.key.length === 1 || e.key === 'Backspace' || e.key === 'Delete') {
        e.preventDefault();
      }
    }
  });

  if (toggle) {
    toggle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      if (menu.hidden) open(true);
      else menu.hidden = true;
    });
  }
}

async function deleteLlmOption(opt) {
  if (llmUiMode !== 'add') return;
  const api = requireSettingsAPI();
  if (!api) return;
  const kind = opt.deleteKind;
  if (!kind) return;

  const base = normalizeBaseUrl(opt.baseUrl || baseUrlEl?.value);
  const payload = {
    llmSaveMode:
      kind === 'provider'
        ? 'delete-provider'
        : kind === 'path'
          ? 'delete-path'
          : 'delete-model',
    llmBaseUrl: base,
    llmPath: kind === 'path' ? opt.value : kind === 'model' ? (opt.path || pathEl?.value) : undefined,
    llmModel: kind === 'model' ? opt.value : undefined,
  };

  setStatus('正在删除…', false);
  const result = await api.saveConfig(payload);
  if (!result || !result.ok) {
    setStatus(result?.error || '删除失败', true);
    return;
  }

  llmProfiles = Array.isArray(result.llmProviders)
    ? result.llmProviders
    : Array.isArray(result.llmProfiles)
      ? result.llmProfiles
      : [];
  activeLlmProfileId =
    result.activeLlmProviderId || result.activeLlmProfileId || llmProfiles[0]?.id || '';

  for (const key of Object.keys(lastByHost)) delete lastByHost[key];
  for (const p of llmProfiles) {
    const b = normalizeBaseUrl(p.baseUrl);
    if (!b) continue;
    lastByHost[b] = {
      path: p.path || '',
      model: p.model || '',
      apiKey: p.apiKey || '',
      profileId: p.id,
    };
  }

  const stayAdd = true;
  const curBase = normalizeBaseUrl(baseUrlEl?.value);
  if (kind === 'provider' && curBase === base) {
    const next = llmProfiles[0];
    if (next) applyVendorToForm(next.baseUrl);
    else {
      suppressLinkSync = true;
      if (vendorNameEl) vendorNameEl.value = '';
      if (baseUrlEl) baseUrlEl.value = '';
      if (pathEl) pathEl.value = '';
      if (modelEl) modelEl.value = '';
      if (apiKeyEl) apiKeyEl.value = '';
      suppressLinkSync = false;
      syncBaseUrlVendorBadge();
      updateHint();
    }
  } else if (kind === 'path' && String(pathEl?.value || '').trim() === String(opt.value)) {
    const provider = getProviderByBase(base);
    if (pathEl) pathEl.value = provider?.path || provider?.paths?.[0] || '';
    if (modelEl) modelEl.value = provider?.model || provider?.models?.[0] || modelEl.value;
  } else if (kind === 'model' && String(modelEl?.value || '').trim() === String(opt.value)) {
    const provider = getProviderByBase(base);
    if (modelEl) modelEl.value = provider?.model || provider?.models?.[0] || '';
  } else if (kind === 'path' || kind === 'model') {
    const provider = getProviderByBase(base);
    if (provider) {
      // refresh in-memory lists already via llmProfiles
    }
  }

  if (stayAdd && llmUiMode !== 'add') {
    /* keep add */
  }
  setStatus('已删除并更新配置文件', false);
}

document.addEventListener('mousedown', (e) => {
  const t = e.target;
  if (t && t.closest && t.closest('.combo')) return;
  closeAllComboMenus();
});

function syncBaseUrlVendorBadge() {
  if (!baseUrlVendorEl) return;
  if (llmUiMode === 'add') {
    baseUrlVendorEl.hidden = true;
    baseUrlVendorEl.textContent = '';
    return;
  }
  const base = normalizeBaseUrl(baseUrlEl?.value);
  const name = String(vendorNameEl?.value || '').trim() || (base ? hostLabel(base) : '');
  if (base && name) {
    baseUrlVendorEl.textContent = name;
    baseUrlVendorEl.hidden = false;
  } else {
    baseUrlVendorEl.textContent = '';
    baseUrlVendorEl.hidden = true;
  }
}

/** 浏览 / 添加字段态：隐藏厂商栏、只读、徽章 */
function applyLlmFieldMode() {
  const isAdd = llmUiMode === 'add';
  if (vendorNameGroupEl) vendorNameGroupEl.hidden = !isAdd;
  for (const el of [baseUrlEl, pathEl, modelEl, apiKeyEl]) {
    if (!el) continue;
    el.readOnly = !isAdd;
  }
  syncBaseUrlVendorBadge();
}

function rememberCurrentHost() {
  const base = normalizeBaseUrl(baseUrlEl?.value);
  if (!base) return;
  const path = String(pathEl?.value || '').trim();
  const model = String(modelEl?.value || '').trim();
  const prev = lastByHost[base] || {};
  const modelsByPath = { ...(prev.modelsByPath || {}) };
  if (path && model) modelsByPath[path] = model;
  lastByHost[base] = {
    path,
    model,
    apiKey: String(apiKeyEl?.value || '').trim(),
    profileId: activeLlmProfileId || '',
    modelsByPath,
  };
}

function updateHint() {
  if (!llmHintEl) return;
  const name = String(vendorNameEl?.value || '').trim();
  const base = normalizeBaseUrl(baseUrlEl?.value);
  const path = String(pathEl?.value || '').trim();
  const endpoint = `${base}${path.startsWith('/') ? path : path ? `/${path}` : ''}`;
  if (llmUiMode === 'add') {
    llmHintEl.textContent = name || base
      ? `添加 ${name || hostLabel(base)}：可改路径 / Model，填 API Key 后保存。`
      : '添加：选或填厂商，将自动带出 Base URL、路径、Model。';
    return;
  }
  llmHintEl.textContent = base
    ? `点击输入框选择。请求 ${endpoint || '（补全路径）'}。`
    : '点击 Base URL / 路径 / Model 从配置中选择。';
}

/**
 * 按厂商落到表单：
 * 已配置的 path/model 优先，否则该厂商第一项
 */
function applyVendorToForm(baseUrl, { clearApiKey = false, preferredPath, preferredModel } = {}) {
  const base = normalizeBaseUrl(baseUrl);
  if (!base) return;

  const prev = normalizeBaseUrl(baseUrlEl?.value);
  if (prev && prev !== base && llmUiMode !== 'add') rememberCurrentHost();

  const provider = getProviderByBase(base);
  const preset = presetsForHost(base)[0];
  const mem = lastByHost[base];

  const pathList = pathsForBase(base);
  const path = pickSelected(
    pathList,
    preferredPath ?? mem?.path ?? provider?.path ?? preset?.path
  );
  const modelList = modelsForBase(base, path);
  const model = pickSelected(
    modelList,
    preferredModel ?? mem?.modelsByPath?.[path] ?? mem?.model ?? provider?.model ?? preset?.models?.[0]
  );
  const apiKey = clearApiKey
    ? ''
    : mem?.apiKey || provider?.apiKey || '';

  suppressLinkSync = true;
  if (vendorNameEl) {
    vendorNameEl.value =
      provider?.name || hostLabel(base) || preset?.label || vendorNameEl.value || '';
  }
  if (baseUrlEl) baseUrlEl.value = base;
  if (pathEl) pathEl.value = path;
  if (modelEl) modelEl.value = model;
  if (apiKeyEl) apiKeyEl.value = apiKey;
  suppressLinkSync = false;

  if (provider && llmUiMode !== 'add') {
    activeLlmProfileId = provider.id;
    provider.path = path;
    provider.model = model;
  }

  if (llmUiMode !== 'add') {
    lastByHost[base] = {
      path,
      model,
      apiKey,
      profileId: activeLlmProfileId || '',
    };
  }

  closeAllComboMenus();
  syncBaseUrlVendorBadge();
  updateHint();
}

function fillFormFromProfile(profile) {
  if (!profile) {
    suppressLinkSync = true;
    if (vendorNameEl) vendorNameEl.value = '';
    if (baseUrlEl) baseUrlEl.value = '';
    if (pathEl) pathEl.value = '';
    if (modelEl) modelEl.value = '';
    if (apiKeyEl) apiKeyEl.value = '';
    suppressLinkSync = false;
    syncBaseUrlVendorBadge();
    updateHint();
    return;
  }
  activeLlmProfileId = profile.id;
  const base = normalizeBaseUrl(profile.baseUrl);
  lastByHost[base] = {
    path: profile.path || '',
    model: profile.model || '',
    apiKey: profile.apiKey || '',
    profileId: profile.id,
  };
  applyVendorToForm(base, {
    preferredPath: profile.path,
    preferredModel: profile.model,
  });
}

function onBaseUrlCommitted() {
  if (suppressLinkSync) return;
  const base = normalizeBaseUrl(baseUrlEl?.value);
  if (!base) return;
  applyVendorToForm(base);
  if (llmUiMode !== 'add') setStatus('', false);
}

function onPathCommitted() {
  if (suppressLinkSync) return;
  const base = normalizeBaseUrl(baseUrlEl?.value);
  const path = String(pathEl?.value || '').trim();
  const provider = getProviderByBase(base);
  if (provider) {
    provider.path = path;
    if (llmUiMode !== 'add') activeLlmProfileId = provider.id;
  }
  // 换路径 → 只显示该路径对应模型；优先该路径上次选用的模型
  const mem = lastByHost[base];
  const modelList = modelsForBase(base, path);
  const model = pickSelected(
    modelList,
    mem?.modelsByPath?.[path] || modelEl?.value || provider?.model
  );
  if (modelEl) modelEl.value = model || '';
  if (provider) provider.model = model || '';
  if (llmUiMode !== 'add') rememberCurrentHost();
  updateHint();
  if (llmUiMode !== 'add') setStatus('', false);
}

function onVendorCommitted() {
  if (suppressLinkSync) return;
  const name = String(vendorNameEl?.value || '').trim();
  if (!name) return;
  const opt = vendorOptions().find((v) => v.value === name || v.label === name);
  if (opt?.baseUrl) {
    applyVendorToForm(opt.baseUrl);
    if (llmUiMode !== 'add') setStatus('', false);
    return;
  }
  const byName = getProviderByName(name);
  if (byName?.baseUrl) {
    applyVendorToForm(byName.baseUrl);
    if (llmUiMode !== 'add') setStatus('', false);
    return;
  }
  // 预设 label
  const preset = llmPresets.find((p) => p.label === name);
  if (preset?.baseUrl) {
    applyVendorToForm(preset.baseUrl);
    if (llmUiMode !== 'add') setStatus('', false);
  }
}

function setLlmUiMode(mode) {
  llmUiMode = mode === 'add' ? 'add' : 'browse';
  const isAdd = llmUiMode === 'add';
  if (addBtn) addBtn.hidden = isAdd || activePanel !== 'llm';
  if (cancelBtn) cancelBtn.hidden = !isAdd || activePanel !== 'llm';
  applyLlmFieldMode();
  if (detailDesc && activePanel === 'llm') {
    detailDesc.textContent = isAdd
      ? '添加：厂商 / Base URL / 路径 / Model / Key，可输入或点 ▾ 选择。'
      : PANEL_META.llm.desc;
  }
  if (isAdd) {
    rememberCurrentHost();
    const def = llmPresets.find((p) => p.id === 'volc') || llmProfiles[0] || llmPresets[0];
    const base = def?.baseUrl || '';
    if (base) applyVendorToForm(base);
    else {
      suppressLinkSync = true;
      if (vendorNameEl) vendorNameEl.value = '';
      if (baseUrlEl) baseUrlEl.value = '';
      if (pathEl) pathEl.value = '';
      if (modelEl) modelEl.value = '';
      if (apiKeyEl) apiKeyEl.value = '';
      suppressLinkSync = false;
      syncBaseUrlVendorBadge();
      updateHint();
    }
    vendorNameEl?.focus();
    setStatus('添加模式：选择或输入厂商，路径 / Model 可改，填写 Key 后保存', false);
  } else {
    const active = getProviderById(activeLlmProfileId) || llmProfiles[0];
    if (active) fillFormFromProfile(active);
    else {
      const def = llmPresets.find((p) => p.id === 'volc') || llmPresets[0];
      if (def?.baseUrl) applyVendorToForm(def.baseUrl);
      else {
        syncBaseUrlVendorBadge();
        updateHint();
      }
    }
  }
}

bindCombo(vendorNameEl, vendorMenuEl, () => vendorOptions(), () => onVendorCommitted());
bindCombo(baseUrlEl, baseUrlMenuEl, () => baseUrlOptions(), () => onBaseUrlCommitted());
bindCombo(
  pathEl,
  pathMenuEl,
  () => pathOptions(),
  () => onPathCommitted()
);
bindCombo(
  modelEl,
  modelMenuEl,
  () => modelOptions(),
  () => {
    if (llmUiMode !== 'add') rememberCurrentHost();
    updateHint();
    if (llmUiMode !== 'add') setStatus('', false);
  }
);

if (vendorNameEl) {
  vendorNameEl.addEventListener('change', onVendorCommitted);
}
if (baseUrlEl) {
  baseUrlEl.addEventListener('change', onBaseUrlCommitted);
}
if (pathEl) {
  pathEl.addEventListener('change', onPathCommitted);
}
if (modelEl) {
  modelEl.addEventListener('change', () => {
    if (suppressLinkSync) return;
    const base = normalizeBaseUrl(baseUrlEl?.value);
    const provider = getProviderByBase(base);
    if (provider) provider.model = String(modelEl.value || '').trim();
    if (llmUiMode !== 'add') rememberCurrentHost();
    updateHint();
    if (llmUiMode !== 'add') setStatus('', false);
  });
}
if (apiKeyEl) {
  apiKeyEl.addEventListener('input', () => {
    if (suppressLinkSync) return;
    if (llmUiMode !== 'add') rememberCurrentHost();
  });
}

if (addBtn) {
  addBtn.addEventListener('click', () => {
    if (activePanel !== 'llm') return;
    setLlmUiMode('add');
  });
}
if (cancelBtn) {
  cancelBtn.addEventListener('click', () => {
    setLlmUiMode('browse');
    setStatus('', false);
  });
}

function readGeneralValues() {
  return {
    gitGraphCommitLimit: gitGraphLimitEl ? gitGraphLimitEl.value : '',
    codxEditorTheme: codxEditorThemeEl ? codxEditorThemeEl.value : 'pecado-dark',
    codxEditorLineHeight: codxEditorLineHeightEl ? codxEditorLineHeightEl.value : '0',
    codxEditorLetterSpacing: codxEditorLetterSpacingEl ? codxEditorLetterSpacingEl.value : '0',
    codxEditorSpaceWidth: codxEditorSpaceWidthEl ? codxEditorSpaceWidthEl.value : '0',
    codxEditorTabSize: codxEditorTabSizeEl ? codxEditorTabSizeEl.value : '2',
    codxEditorFontSize: codxEditorFontSizeEl ? codxEditorFontSizeEl.value : '0',
    codxEditorLineNumbers: codxEditorLineNumbersEl ? codxEditorLineNumbersEl.value : 'on',
    codxEditorLineNumberMinChars: codxEditorLineNumberMinCharsEl
      ? codxEditorLineNumberMinCharsEl.value
      : '3',
    codxEditorLineNumberFontSize: codxEditorLineNumberFontSizeEl
      ? codxEditorLineNumberFontSizeEl.value
      : '0',
    codxEditorLineNumberFontWeight: codxEditorLineNumberFontWeightEl
      ? codxEditorLineNumberFontWeightEl.value
      : '0',
    codxDesignDepth: codxDesignDepthEl ? codxDesignDepthEl.value : '4',
  };
}

function readFormValues() {
  if (document.activeElement && typeof document.activeElement.blur === 'function') {
    document.activeElement.blur();
  }
  rememberCurrentHost();
  const general = readGeneralValues();
  if (activePanel === 'llm') {
    const apiPath = String(pathEl?.value || '').trim();
    const baseUrl = normalizeBaseUrl(baseUrlEl?.value);
    const matched =
      llmUiMode === 'add' ? null : getProviderByBase(baseUrl);
    if (matched) activeLlmProfileId = matched.id;
    const name =
      String(vendorNameEl?.value || '').trim() || hostLabel(baseUrl) || apiPath || '未命名配置';
    return {
      ...general,
      llmSaveMode: llmUiMode === 'add' ? 'add' : 'update',
      activeLlmProfileId: llmUiMode === 'add' ? '' : activeLlmProfileId || matched?.id || '',
      activeLlmProviderId: llmUiMode === 'add' ? '' : activeLlmProfileId || matched?.id || '',
      llmBaseUrl: baseUrl,
      llmPath: apiPath,
      llmApiType: apiPath,
      llmModel: String(modelEl?.value || '').trim(),
      llmApiKey: apiKeyEl ? apiKeyEl.value.trim() : '',
      llmName: name,
    };
  }
  return {
    ...general,
    activeLlmProfileId,
    activeLlmProviderId: activeLlmProfileId,
  };
}

function applyGeneralConfig(cfg) {
  if (gitGraphLimitEl && cfg.gitGraphCommitLimit != null) {
    const limit = String(cfg.gitGraphCommitLimit);
    if ([...gitGraphLimitEl.options].some((o) => o.value === limit)) {
      gitGraphLimitEl.value = limit;
    } else {
      gitGraphLimitEl.value = '500';
    }
  }
  if (codxEditorThemeEl && cfg.codxEditorTheme) {
    const theme = String(cfg.codxEditorTheme);
    if ([...codxEditorThemeEl.options].some((o) => o.value === theme)) {
      codxEditorThemeEl.value = theme;
    } else {
      codxEditorThemeEl.value = 'pecado-dark';
    }
  }
  if (codxEditorLineHeightEl && cfg.codxEditorLineHeight != null) {
    codxEditorLineHeightEl.value = String(cfg.codxEditorLineHeight);
  }
  if (codxEditorLetterSpacingEl && cfg.codxEditorLetterSpacing != null) {
    codxEditorLetterSpacingEl.value = String(cfg.codxEditorLetterSpacing);
  }
  if (codxEditorSpaceWidthEl && cfg.codxEditorSpaceWidth != null) {
    codxEditorSpaceWidthEl.value = String(cfg.codxEditorSpaceWidth);
  }
  if (codxEditorTabSizeEl && cfg.codxEditorTabSize != null) {
    const tab = String(cfg.codxEditorTabSize);
    if ([...codxEditorTabSizeEl.options].some((o) => o.value === tab)) {
      codxEditorTabSizeEl.value = tab;
    } else {
      codxEditorTabSizeEl.value = '2';
    }
  }
  if (codxEditorFontSizeEl && cfg.codxEditorFontSize != null) {
    codxEditorFontSizeEl.value = String(cfg.codxEditorFontSize);
  }
  if (codxEditorLineNumbersEl && cfg.codxEditorLineNumbers) {
    const mode = String(cfg.codxEditorLineNumbers);
    if ([...codxEditorLineNumbersEl.options].some((o) => o.value === mode)) {
      codxEditorLineNumbersEl.value = mode;
    } else {
      codxEditorLineNumbersEl.value = 'on';
    }
  }
  if (codxEditorLineNumberMinCharsEl && cfg.codxEditorLineNumberMinChars != null) {
    codxEditorLineNumberMinCharsEl.value = String(cfg.codxEditorLineNumberMinChars);
  }
  if (codxEditorLineNumberFontSizeEl && cfg.codxEditorLineNumberFontSize != null) {
    codxEditorLineNumberFontSizeEl.value = String(cfg.codxEditorLineNumberFontSize);
  }
  if (codxEditorLineNumberFontWeightEl && cfg.codxEditorLineNumberFontWeight != null) {
    const weight = String(cfg.codxEditorLineNumberFontWeight);
    if ([...codxEditorLineNumberFontWeightEl.options].some((o) => o.value === weight)) {
      codxEditorLineNumberFontWeightEl.value = weight;
    } else {
      codxEditorLineNumberFontWeightEl.value = '0';
    }
  }
  if (codxDesignDepthEl && cfg.codxDesignDepth != null) {
    codxDesignDepthEl.value = String(cfg.codxDesignDepth);
  }
}

function applyConfig(cfg) {
  if (!cfg || !cfg.ok) {
    setStatus(cfg?.error || '读取配置失败', true);
    return;
  }
  llmPresets = Array.isArray(cfg.llmPresets) ? cfg.llmPresets : llmPresets;
  llmProfiles = Array.isArray(cfg.llmProviders)
    ? cfg.llmProviders
    : Array.isArray(cfg.llmProfiles)
      ? cfg.llmProfiles
      : [];
  activeLlmProfileId =
    cfg.activeLlmProviderId || cfg.activeLlmProfileId || llmProfiles[0]?.id || '';

  // 用已保存配置初始化各主机记忆（一厂商一 Base URL）
  for (const p of llmProfiles) {
    const base = normalizeBaseUrl(p.baseUrl);
    if (!base) continue;
    if (!lastByHost[base] || p.id === activeLlmProfileId) {
      lastByHost[base] = {
        path: p.path || (Array.isArray(p.paths) ? p.paths[0] : '') || '',
        model: p.model || (Array.isArray(p.models) ? p.models[0] : '') || '',
        apiKey: p.apiKey || '',
        profileId: p.id,
      };
    }
  }

  applyGeneralConfig(cfg);
  showConfigDir(cfg.configDir || '');
  setLlmUiMode('browse');
}

function setActivePanel(name) {
  activePanel = name;
  navItems.forEach((item) => {
    item.classList.toggle('active', item.dataset.panel === name);
  });
  panels.forEach((panel) => {
    panel.classList.toggle('active', panel.id === `panel-${name}`);
  });
  const meta = PANEL_META[name] || PANEL_META.llm;
  detailTitle.textContent = meta.title;
  detailDesc.textContent = meta.desc;
  const editable = EDITABLE_PANELS.has(name);
  saveBtn.hidden = !editable;
  if (addBtn) addBtn.hidden = !(editable && name === 'llm' && llmUiMode !== 'add');
  if (cancelBtn) cancelBtn.hidden = !(name === 'llm' && llmUiMode === 'add');
  if (!editable) setStatus('', false);
  if (name === 'llm' && llmUiMode === 'add') {
    detailDesc.textContent =
      '添加：厂商 / Base URL / 路径 / Model / Key，可输入或点 ▾ 选择。';
  }
}

navItems.forEach((item) => {
  item.addEventListener('click', () => {
    if (llmUiMode === 'add' && item.dataset.panel !== 'llm') {
      setLlmUiMode('browse');
    }
    setActivePanel(item.dataset.panel);
  });
});

async function loadConfig() {
  const api = requireSettingsAPI();
  if (!api) return;
  applyConfig(await api.getConfig());
}

saveBtn.addEventListener('click', async () => {
  if (!EDITABLE_PANELS.has(activePanel)) return;
  const api = requireSettingsAPI();
  if (!api) return;

  const payload = readFormValues();
  const wasAdd = activePanel === 'llm' && payload.llmSaveMode === 'add';

  if (activePanel === 'llm') {
    if (!String(vendorNameEl?.value || '').trim()) {
      setStatus('请填写厂商', true);
      vendorNameEl?.focus();
      return;
    }
    if (!payload.llmBaseUrl) {
      setStatus('请填写 Base URL', true);
      baseUrlEl?.focus();
      return;
    }
    if (!payload.llmPath) {
      setStatus('请填写路径', true);
      pathEl?.focus();
      return;
    }
    if (!payload.llmApiKey) {
      setStatus('请填写 API Key', true);
      apiKeyEl?.focus();
      return;
    }
    if (!payload.llmModel) {
      setStatus('请填写 Model', true);
      modelEl?.focus();
      return;
    }
  }

  const limit = parseInt(String(payload.gitGraphCommitLimit), 10);
  if (!GIT_GRAPH_LIMIT_OPTIONS.includes(limit)) {
    setStatus('请选择有效的 Git 提交图条数', true);
    gitGraphLimitEl?.focus();
    return;
  }

  saveBtn.disabled = true;
  setStatus(wasAdd ? '正在保存新配置…' : '正在保存…', false);
  try {
    const result = await api.saveConfig(payload);
    if (result && result.ok) {
      applyConfig(result);
      if (wasAdd) {
        setStatus('已添加并切换到该配置', false);
      } else if (activePanel === 'llm') {
        setStatus('已切换并保存当前 LLM 配置', false);
      } else {
        setStatus(`已保存至 ${formatConfigDirDisplay(result.configDir || '')}`, false);
      }
    } else {
      setStatus(result?.error || '保存失败', true);
    }
  } catch (e) {
    setStatus(e.message || String(e), true);
  } finally {
    saveBtn.disabled = false;
  }
});

setActivePanel('llm');
loadConfig().catch((e) => {
  setStatus(e.message || String(e), true);
});
