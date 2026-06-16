/**
 * @file index.js
 *
 * 【功能】Preferences 窗口 UI 逻辑。
 * 【调用方】settings/html/index.html → ../js/index.js
 */
const PANEL_META = {
  volc: { title: '火山设置', desc: '配置 Coding Plan 或 Bots API、密钥与模型（保存至本地用户目录）。' },
  general: { title: '通用', desc: 'Git 提交图与其它基础选项。' },
  appearance: { title: '外观', desc: '主题与界面显示偏好。' },
  shortcuts: { title: '快捷键', desc: '查看常用键盘快捷键。' },
  about: { title: '关于', desc: '应用版本与说明。' },
};

const EDITABLE_PANELS = new Set(['volc', 'general']);
const GIT_GRAPH_LIMIT_OPTIONS = [100, 200, 500, 1000, 1500, 5000];

const navItems = document.querySelectorAll('.nav-item');
const panels = document.querySelectorAll('.panel');
const detailTitle = document.getElementById('detail-title');
const detailDesc = document.getElementById('detail-desc');
const saveBtn = document.getElementById('save-btn');
const statusEl = document.getElementById('status');
const apiKeyEl = document.getElementById('api-key');
const apiModeEl = document.getElementById('api-mode');
const modelEl = document.getElementById('model');
const modelHintEl = document.getElementById('model-hint');
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
const configDirBtn = document.getElementById('config-dir-btn');

let activePanel = 'volc';
let currentConfigDir = '';

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
  configDirBtn.title = `在 Finder 中打开：${configDir}`;
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

function updateModelHint() {
  if (!modelHintEl || !apiModeEl) return;
  const mode = apiModeEl.value === 'bots' ? 'bots' : 'coding_plan';
  if (mode === 'bots') {
    modelHintEl.textContent =
      'Bots 接口：模型填 bot- 开头的 Bot ID，例如 bot-20260424113808-wwggn';
  } else {
    modelHintEl.textContent =
      'Coding Plan（你已购 Lite）：推荐 ark-code-latest；也可填 doubao-seed-2.0-code、kimi-k2.5、glm-4.7（勿填 bot- 或在线推理 ID）';
  }
}

if (apiModeEl) {
  apiModeEl.addEventListener('change', () => {
    updateModelHint();
    if (!modelEl) return;
    const mode = apiModeEl.value === 'bots' ? 'bots' : 'coding_plan';
    const model = modelEl.value.trim();
    if (mode === 'coding_plan' && /^bot-/i.test(model)) {
      modelEl.value = 'ark-code-latest';
      setStatus('Coding Plan 不能用 Bot ID，已改为 ark-code-latest，请点保存', false);
    }
  });
}

function readFormValues() {
  if (document.activeElement && typeof document.activeElement.blur === 'function') {
    document.activeElement.blur();
  }
  return {
    volcArkApiKey: apiKeyEl.value.trim(),
    volcApiMode: apiModeEl ? apiModeEl.value : 'coding_plan',
    volcArkModel: modelEl.value.trim(),
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
  };
}

function applyConfig(cfg) {
  if (!cfg || !cfg.ok) {
    setStatus(cfg?.error || '读取配置失败', true);
    return;
  }
  apiKeyEl.value = cfg.volcArkApiKey || '';
  if (apiModeEl) {
    apiModeEl.value = cfg.volcApiMode === 'bots' ? 'bots' : 'coding_plan';
  }
  modelEl.value = cfg.volcArkModel || '';
  updateModelHint();
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
  showConfigDir(cfg.configDir || '');
}

function setActivePanel(name) {
  activePanel = name;
  navItems.forEach((item) => {
    item.classList.toggle('active', item.dataset.panel === name);
  });
  panels.forEach((panel) => {
    panel.classList.toggle('active', panel.id === `panel-${name}`);
  });
  const meta = PANEL_META[name] || PANEL_META.volc;
  detailTitle.textContent = meta.title;
  detailDesc.textContent = meta.desc;
  saveBtn.hidden = !EDITABLE_PANELS.has(name);
  if (!EDITABLE_PANELS.has(name)) setStatus('', false);
}

navItems.forEach((item) => {
  item.addEventListener('click', () => setActivePanel(item.dataset.panel));
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

  if (activePanel === 'volc' && !payload.volcArkApiKey) {
    setStatus('请填写 API Key', true);
    apiKeyEl.focus();
    return;
  }

  if (activePanel === 'volc') {
    const mode = payload.volcApiMode === 'bots' ? 'bots' : 'coding_plan';
    const model = payload.volcArkModel.trim();
    if (mode === 'coding_plan' && model && /^bot-/i.test(model)) {
      setStatus('Coding Plan 不能使用 bot- 开头的 Bot ID，请改为 ark-code-latest', true);
      modelEl.focus();
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
  setStatus('正在保存…', false);
  try {
    const result = await api.saveConfig(payload);
    if (result && result.ok) {
      applyConfig(result);
      setStatus(`已保存至 ${formatConfigDirDisplay(result.configDir || '')}`, false);
    } else {
      setStatus(result?.error || '保存失败', true);
    }
  } catch (e) {
    setStatus(e.message || String(e), true);
  } finally {
    saveBtn.disabled = false;
  }
});

setActivePanel('volc');
loadConfig().catch((e) => {
  setStatus(e.message || String(e), true);
});
