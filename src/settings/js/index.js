/**
 * @file index.js
 *
 * 【功能】Preferences 窗口 UI 逻辑。
 * 【调用方】settings/html/index.html → ../js/index.js
 */
const PANEL_META = {
  volc: { title: '火山设置', desc: '配置火山方舟 API 密钥与 Bot 模型（保存至本地用户目录）。' },
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
const modelEl = document.getElementById('model');
const gitGraphLimitEl = document.getElementById('git-graph-limit');
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

function readFormValues() {
  if (document.activeElement && typeof document.activeElement.blur === 'function') {
    document.activeElement.blur();
  }
  return {
    volcArkApiKey: apiKeyEl.value.trim(),
    volcArkModel: modelEl.value.trim(),
    gitGraphCommitLimit: gitGraphLimitEl ? gitGraphLimitEl.value : '',
  };
}

function applyConfig(cfg) {
  if (!cfg || !cfg.ok) {
    setStatus(cfg?.error || '读取配置失败', true);
    return;
  }
  apiKeyEl.value = cfg.volcArkApiKey || '';
  modelEl.value = cfg.volcArkModel || '';
  if (gitGraphLimitEl && cfg.gitGraphCommitLimit != null) {
    const limit = String(cfg.gitGraphCommitLimit);
    if ([...gitGraphLimitEl.options].some((o) => o.value === limit)) {
      gitGraphLimitEl.value = limit;
    } else {
      gitGraphLimitEl.value = '500';
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
    setStatus('请填写 Volc Ark API Key', true);
    apiKeyEl.focus();
    return;
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
