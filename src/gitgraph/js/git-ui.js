/**
 * @file git-ui.js
 *
 * 【功能】Git 侧栏视图：加载 panel.html、切换面板、pull/push/commit、@gitgraph/js 绘制提交图。
 * 【调用方】renderer/html/app.html → ../../gitgraph/js/git-ui.js
 */
(function () {
  const GITGRAPH_LIB_URL = '../../../node_modules/@gitgraph/js/lib/gitgraph.umd.min.js';

  let gitgraphApi = null;
  let currentProjectRoot = '';
  let panelReady = false;

  function getApi() {
    return window.electronAPI;
  }

  function $(id) {
    return document.getElementById(id);
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      if (src.includes('gitgraph') && typeof GitgraphJS !== 'undefined') {
        resolve();
        return;
      }
      const el = document.createElement('script');
      el.src = src;
      el.onload = () => resolve();
      el.onerror = () => reject(new Error(`Failed to load ${src}`));
      document.head.appendChild(el);
    });
  }

  async function loadPanelHtml() {
    const mount = $('panel-git');
    if (!mount || mount.dataset.loaded === '1') return mount;
    const api = getApi();
    if (!api || typeof api.gitGetPanelHtml !== 'function') {
      throw new Error('Git panel API 不可用');
    }
    const res = await api.gitGetPanelHtml();
    if (!res.ok) throw new Error(res.error || '加载 Git 面板失败');
    mount.innerHTML = res.html;
    mount.dataset.loaded = '1';
    panelReady = true;
    setupToolbar();
    return mount;
  }

  function setActiveNav(view) {
    const pecado = $('nav-pecado');
    const git = $('nav-git');
    if (pecado) pecado.classList.toggle('active', view === 'chat');
    if (git) git.classList.toggle('active', view === 'git');
  }

  async function showView(view) {
    const chatPanel = $('panel-chat');
    const gitPanel = $('panel-git');
    if (chatPanel) chatPanel.classList.toggle('hidden', view !== 'chat');
    if (gitPanel) gitPanel.classList.toggle('hidden', view !== 'git');
    setActiveNav(view);
    if (view === 'git') {
      if (!panelReady) {
        try {
          await loadPanelHtml();
          await refreshGitView();
        } catch (e) {
          console.error('[git-ui] loadPanelHtml', e);
        }
        return;
      }
      await refreshGitView();
    }
  }

  function setGitMessage(text, isError) {
    const el = $('git-message');
    if (!el) return;
    el.textContent = text || '';
    el.classList.toggle('git-message-error', Boolean(isError));
  }

  function renderStatus(state) {
    const info = $('git-info');
    const statusEl = $('git-status');
    if (!info || !statusEl) return;

    if (!state.projectRoot) {
      info.textContent = '未打开工程';
      statusEl.textContent = state.hint || '请通过 File → Open Folder 打开工程目录';
      return;
    }

    info.textContent = state.isRepo
      ? `${state.branch || '(detached)'} · ${state.projectRoot}`
      : `非 Git 仓库 · ${state.projectRoot}`;

    if (!state.isRepo) {
      statusEl.textContent = '当前目录不是 Git 仓库';
      return;
    }

    const lines = state.status?.fileLines || [];
    if (lines.length === 0) {
      statusEl.textContent = '工作区干净，无未提交变更';
    } else {
      statusEl.textContent = lines.join('\n');
    }
  }

  function renderGraph(graphData) {
    const container = $('git-graph');
    if (!container || typeof GitgraphJS === 'undefined') return;

    container.innerHTML = '';
    if (!graphData || graphData.length === 0) {
      container.innerHTML = '<div class="git-graph-empty">暂无提交记录</div>';
      return;
    }

    gitgraphApi = GitgraphJS.createGitgraph(container, {
      orientation: 'vertical-reverse',
      template: 'metro',
      responsive: true,
    });

    try {
      gitgraphApi.import(graphData);
    } catch (e) {
      console.error('[git-ui] import graph', e);
      container.innerHTML = `<div class="git-graph-empty">绘制失败：${e.message || String(e)}</div>`;
    }
  }

  async function refreshGitView() {
    const api = getApi();
    if (!api || typeof api.gitGetState !== 'function') {
      setGitMessage('Git API 不可用', true);
      return;
    }
    setGitMessage('加载中…', false);
    try {
      await loadScript(GITGRAPH_LIB_URL);
    } catch (e) {
      setGitMessage('加载 Gitgraph 库失败', true);
      console.error('[git-ui] loadScript', e);
      return;
    }
    const state = await api.gitGetState({ projectRoot: currentProjectRoot || undefined });
    if (!state.ok) {
      setGitMessage(state.error || '加载失败', true);
      return;
    }
    if (state.projectRoot) currentProjectRoot = state.projectRoot;
    renderStatus(state);
    renderGraph(state.graphData);
    setGitMessage('', false);
  }

  async function runGitAction(action) {
    const api = getApi();
    if (!api) return;

    if (action === 'commit') {
      const message = window.prompt('Commit 信息', 'Update from Pecado');
      if (message === null) return;
      if (!String(message).trim()) {
        setGitMessage('Commit 信息不能为空', true);
        return;
      }
      setGitMessage('正在 commit…', false);
      const res = await api.gitCommit({ message, projectRoot: currentProjectRoot || undefined });
      if (!res.ok) {
        setGitMessage(res.error || 'Commit 失败', true);
        return;
      }
      renderStatus(res);
      renderGraph(res.graphData);
      setGitMessage(res.output || 'Commit 成功', false);
      return;
    }

    const fn = action === 'pull' ? api.gitPull : api.gitPush;
    if (typeof fn !== 'function') return;
    setGitMessage(`正在 ${action}…`, false);
    const res = await fn({ projectRoot: currentProjectRoot || undefined });
    if (!res.ok) {
      setGitMessage(res.error || `${action} 失败`, true);
      return;
    }
    renderStatus(res);
    renderGraph(res.graphData);
    setGitMessage(res.output || `${action} 完成`, false);
  }

  function setupSidebar() {
    $('nav-pecado')?.addEventListener('click', () => {
      showView('chat');
    });
    $('nav-git')?.addEventListener('click', () => {
      showView('git');
    });
  }

  function setupToolbar() {
    $('git-btn-pull')?.addEventListener('click', () => runGitAction('pull'));
    $('git-btn-push')?.addEventListener('click', () => runGitAction('push'));
    $('git-btn-commit')?.addEventListener('click', () => runGitAction('commit'));
  }

  function setupProjectListener() {
    const api = getApi();
    if (!api || typeof api.onMcpFsProjectChanged !== 'function') return;
    api.onMcpFsProjectChanged(({ projectRoot }) => {
      if (!projectRoot) return;
      currentProjectRoot = projectRoot;
      const gitPanel = $('panel-git');
      if (gitPanel && !gitPanel.classList.contains('hidden') && panelReady) {
        refreshGitView();
      }
    });
  }

  function init() {
    setupSidebar();
    setupProjectListener();
    showView('chat');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
