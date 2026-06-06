/**
 * @file index.js
 *
 * 【功能】Git 渲染进程 UI：提交时间线列表（节点 ↔ commit 一一对应）、pull/push/commit。
 * 【调用方】main/html/index.html → ../../gitgraph/js/index.js
 */
(function () {
  let currentProjectRoot = '';
  let panelReady = false;
  let selectedCommitHash = '';
  /** 本会话内是否已对 Git 侧栏做过首次图区定位 */
  let gitTabInitialScrollDone = false;

  function getApi() {
    return window.electronAPI;
  }

  function $(id) {
    return document.getElementById(id);
  }

  function loadScript(src) {
    return new Promise((resolve, reject) => {
      if (src.includes('timeline-layout') && typeof GitTimelineLayout !== 'undefined') {
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
      try {
        if (!panelReady) {
          await loadPanelHtml();
        }
        if (!gitTabInitialScrollDone) {
          await refreshGitView({ initialScroll: true });
          gitTabInitialScrollDone = true;
        }
      } catch (e) {
        console.error('[git-ui] showView git', e);
      }
    }
  }

  function setStatusPanelLabel(text) {
    const labelEl = $('git-status-label');
    if (labelEl) labelEl.textContent = text;
  }

  function authorInitial(name) {
    const trimmed = String(name || '').trim();
    if (!trimmed) return '?';
    return trimmed.charAt(0).toUpperCase();
  }

  /**
   * @param {object} commit git2json 条目
   */
  function formatCommitDetail(commit) {
    const hash = commit.hash || '';
    const short = hash ? hash.slice(0, 7) : '';
    const author = commit.author?.name || 'unknown';
    const email = commit.author?.email || '';
    const refs = Array.isArray(commit.refs) && commit.refs.length ? commit.refs.join(', ') : '';
    const parents =
      Array.isArray(commit.parents) && commit.parents.length
        ? commit.parents.map((p) => p.slice(0, 7)).join(' ')
        : '';
    const lines = [
      short ? `Commit   ${short}` : '',
      commit.subject ? `Message  ${commit.subject}` : '',
      `Author   ${author}${email ? ` <${email}>` : ''}`,
      commit.date ? `Date     ${commit.date}` : '',
      refs ? `Refs     ${refs}` : '',
      parents ? `Parents  ${parents}` : '',
      hash ? `Hash     ${hash}` : '',
    ].filter(Boolean);
    return lines.join('\n');
  }

  function showCommitInStatus(commit) {
    const statusEl = $('git-status');
    if (!statusEl || !commit) return;
    setStatusPanelLabel('Commit');
    statusEl.textContent = formatCommitDetail(commit);
  }

  function renderWorkspaceStatus(state) {
    const statusEl = $('git-status');
    if (!statusEl) return;

    setStatusPanelLabel('Status');

    if (!state?.projectRoot) {
      statusEl.textContent = state?.hint || '请通过 File → Open Folder 打开工程目录';
      return;
    }

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

  function renderStatus(state) {
    const info = $('git-info');
    if (!info) return;

    if (!state.projectRoot) {
      info.textContent = '未打开工程';
      renderWorkspaceStatus(state);
      return;
    }

    info.textContent = state.isRepo
      ? `${state.branch || '(detached)'} · ${state.projectRoot}`
      : `非 Git 仓库 · ${state.projectRoot}`;

    renderWorkspaceStatus(state);
  }

  function setGitMessage(text, isError) {
    const el = $('git-message');
    if (!el) return;
    el.textContent = text || '';
    el.classList.toggle('git-message-error', Boolean(isError));
  }

  function selectCommit(timelineEl, hash, commit) {
    selectedCommitHash = hash || '';
    timelineEl.querySelectorAll('.git-commit-row.is-selected').forEach((el) => {
      el.classList.remove('is-selected');
    });
    timelineEl.querySelectorAll('.git-commit-node-svg.is-selected').forEach((el) => {
      el.classList.remove('is-selected');
    });
    const row = timelineEl.querySelector(`.git-commit-row[data-hash="${hash}"]`);
    const node = timelineEl.querySelector(`.git-commit-node-svg[data-hash="${hash}"]`);
    row?.classList.add('is-selected');
    node?.classList.add('is-selected');
    showCommitInStatus(commit);
  }

  function renderTimelineSvg(svg, model, rowH) {
    const ns = 'http://www.w3.org/2000/svg';
    svg.setAttribute('width', String(model.graphWidth));
    svg.setAttribute('height', String(model.graphHeight));
    svg.setAttribute('viewBox', `0 0 ${model.graphWidth} ${model.graphHeight}`);

    for (const path of model.paths) {
      const el = document.createElementNS(ns, 'path');
      el.setAttribute('d', path.d);
      el.setAttribute('stroke', path.color);
      el.setAttribute('stroke-width', String(path.width));
      el.setAttribute('fill', 'none');
      el.setAttribute('stroke-linecap', 'round');
      el.setAttribute('stroke-linejoin', 'round');
      svg.appendChild(el);
    }

    for (const node of model.nodes) {
      const hash = node.commit.hash || '';
      const g = document.createElementNS(ns, 'g');
      g.setAttribute('class', 'git-commit-node-svg');
      g.dataset.hash = hash;
      if (hash && hash === selectedCommitHash) {
        g.classList.add('is-selected');
      }
      g.style.cursor = 'pointer';

      const circle = document.createElementNS(ns, 'circle');
      circle.setAttribute('cx', String(node.x));
      circle.setAttribute('cy', String(node.y));
      circle.setAttribute('r', '10');
      circle.setAttribute('fill', node.color);

      const text = document.createElementNS(ns, 'text');
      text.setAttribute('x', String(node.x));
      text.setAttribute('y', String(node.y));
      text.setAttribute('text-anchor', 'middle');
      text.setAttribute('dominant-baseline', 'central');
      text.setAttribute('fill', '#ffffff');
      text.setAttribute('font-size', '11');
      text.setAttribute('font-weight', '600');
      text.textContent = node.label;

      g.appendChild(circle);
      g.appendChild(text);
      g.addEventListener('click', (e) => {
        e.stopPropagation();
        selectCommit(svg.closest('.git-timeline'), hash, node.commit);
      });
      svg.appendChild(g);
    }
  }

  const GRAPH_INITIAL_NODE_X_RATIO = 0.2;

  function scrollGraphToInitialPosition(timeline) {
    const graphScroll = timeline.querySelector('.git-timeline-graph-scroll');
    const newestRow = timeline.querySelector('.git-timeline-rows .git-commit-row:first-child');
    if (!graphScroll || !newestRow) return;
    const lineRight = parseFloat(newestRow.dataset.lineRight);
    if (!Number.isFinite(lineRight)) return;
    const paneWidth = graphScroll.clientWidth;
    if (paneWidth <= 0) return;
    const maxScroll = Math.max(0, graphScroll.scrollWidth - paneWidth);
    const targetScroll = lineRight - paneWidth * GRAPH_INITIAL_NODE_X_RATIO;
    graphScroll.scrollLeft = Math.min(maxScroll, Math.max(0, targetScroll));
  }

  function syncTimelineBarPositions(timeline) {
    const graphScroll = timeline.querySelector('.git-timeline-graph-scroll');
    if (!graphScroll) return;
    const scrollLeft = graphScroll.scrollLeft;
    const paneWidth = graphScroll.clientWidth;
    timeline.querySelectorAll('.git-commit-row[data-line-right]').forEach((row) => {
      const lineRight = parseFloat(row.dataset.lineRight);
      if (!Number.isFinite(lineRight)) return;
      const barPull = paneWidth - lineRight + scrollLeft;
      row.style.setProperty('--git-bar-pull', `${Math.max(0, barPull)}px`);
    });
  }

  function bindTimelineBarSync(timeline, options = {}) {
    const graphScroll = timeline.querySelector('.git-timeline-graph-scroll');
    if (!graphScroll) return;
    const onSync = () => syncTimelineBarPositions(timeline);
    graphScroll.addEventListener('scroll', onSync, { passive: true });
    let ro = null;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(onSync);
      ro.observe(graphScroll);
    }
    const afterLayout = () => {
      if (options.initialScroll) {
        scrollGraphToInitialPosition(timeline);
      }
      onSync();
    };
    requestAnimationFrame(() => {
      requestAnimationFrame(afterLayout);
    });
    timeline._barSyncCleanup = () => {
      graphScroll.removeEventListener('scroll', onSync);
      ro?.disconnect();
    };
  }

  /**
   * @param {object[]} graphData git2json（时间正序：旧 → 新）
   */
  function renderGraph(graphData, options = {}) {
    const container = $('git-graph');
    if (!container) return;

    const prevTimeline = container.querySelector('.git-timeline');
    prevTimeline?._barSyncCleanup?.();

    container.innerHTML = '';
    if (!graphData || graphData.length === 0) {
      container.innerHTML = '<div class="git-graph-empty">暂无提交记录</div>';
      return;
    }

    if (typeof GitTimelineLayout === 'undefined') {
      container.innerHTML = '<div class="git-graph-empty">时间线布局未加载</div>';
      return;
    }

    const model = GitTimelineLayout.buildTimelineModel(graphData);
    const rowH = GitTimelineLayout.ROW_HEIGHT;
    const lineW = GitTimelineLayout.LINE_WIDTH;
    const scrollW = model.scrollWidth;

    const timeline = document.createElement('div');
    timeline.className = 'git-timeline';
    timeline.style.setProperty('--git-graph-width', `${model.graphWidth}px`);
    timeline.style.setProperty('--git-scroll-width', `${scrollW}px`);
    timeline.style.setProperty('--git-graph-pane-width', `${model.graphWidth}px`);
    timeline.style.setProperty('--git-row-height', `${rowH}px`);
    timeline.style.height = `${model.graphHeight}px`;

    const graphScroll = document.createElement('div');
    graphScroll.className = 'git-timeline-graph-scroll';

    const graphInner = document.createElement('div');
    graphInner.className = 'git-timeline-graph-scroll-inner';

    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.classList.add('git-timeline-svg');
    renderTimelineSvg(svg, model, rowH);
    graphInner.appendChild(svg);
    graphScroll.appendChild(graphInner);
    timeline.appendChild(graphScroll);

    const rows = document.createElement('div');
    rows.className = 'git-timeline-rows';

    const nodeByHash = new Map(model.nodes.map((n) => [n.commit.hash, n]));

    model.display.forEach((commit) => {
      const hash = commit.hash || '';
      const nodeMeta = nodeByHash.get(hash);
      const row = document.createElement('button');
      row.type = 'button';
      row.className = 'git-commit-row';
      row.style.height = `${rowH}px`;
      if (nodeMeta) {
        row.style.setProperty('--git-node-color', nodeMeta.color);
        row.style.setProperty('--git-row-tint', nodeMeta.tint);
        row.dataset.lineRight = String(nodeMeta.x + lineW / 2);
      }
      if (hash && hash === selectedCommitHash) {
        row.classList.add('is-selected');
      }
      row.dataset.hash = hash;

      const bar = document.createElement('span');
      bar.className = 'git-commit-bar';
      bar.setAttribute('aria-hidden', 'true');

      const subject = document.createElement('span');
      subject.className = 'git-commit-subject';
      subject.textContent = commit.subject || '(no message)';
      row.appendChild(bar);
      row.appendChild(subject);

      row.addEventListener('click', () => {
        selectCommit(timeline, hash, commit);
      });

      rows.appendChild(row);
    });

    timeline.appendChild(rows);
    container.appendChild(timeline);
    bindTimelineBarSync(timeline, { initialScroll: Boolean(options.initialScroll) });
  }

  async function refreshGitView(options = {}) {
    const api = getApi();
    if (!api || typeof api.gitGetState !== 'function') {
      setGitMessage('Git API 不可用', true);
      return;
    }
    setGitMessage('加载中…', false);
    try {
      await loadScript('../../gitgraph/js/timeline-layout.js');
    } catch (e) {
      setGitMessage('加载 Git 时间线布局失败', true);
      console.error('[git-ui] timeline-layout', e);
      return;
    }
    const state = await api.gitGetState({ projectRoot: currentProjectRoot || undefined });
    if (!state.ok) {
      setGitMessage(state.error || '加载失败', true);
      return;
    }
    if (state.projectRoot) currentProjectRoot = state.projectRoot;
    selectedCommitHash = '';
    renderStatus(state);
    renderGraph(state.graphData, { initialScroll: Boolean(options.initialScroll) });
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
      selectedCommitHash = '';
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
    selectedCommitHash = '';
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
      gitTabInitialScrollDone = false;
      const gitPanel = $('panel-git');
      if (gitPanel && !gitPanel.classList.contains('hidden') && panelReady) {
        refreshGitView({ initialScroll: true });
        gitTabInitialScrollDone = true;
      }
    });
  }

  function setupSettingsListener() {
    const api = getApi();
    if (!api || typeof api.onSettingsConfigChanged !== 'function') return;
    api.onSettingsConfigChanged(() => {
      if (panelReady && currentProjectRoot) {
        refreshGitView();
      }
    });
  }

  function init() {
    setupSidebar();
    setupProjectListener();
    setupSettingsListener();
    showView('chat');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
