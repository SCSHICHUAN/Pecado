/**
 * @file index.js
 *
 * 【功能】Git 面板渲染进程：自定义提交时间线、Pull/Push/Commit、工程目录栏。
 * 【调用方】main/html/index.html → ../../gitgraph/js/index.js
 * 【依赖】timeline-layout.js（lane 布局）；IPC 见 preload gitGetState / gitPull / gitPush / gitCommit
 *
 * ── 布局（整窗宽叠层，非左右分栏）──
 *
 * 【显示策略】见 src/gitgraph/README.md
 * - 节点图 inner = 3×窗宽（左右各 1 窗留白），任意节点可滚到屏幕任意 x
 * - Commit inner = 1 窗左 pad +（文字宽 + 1 窗），文字可滚到屏幕任意 x
 * - 同行 row：节点 ↔ 轨道 tint ↔ commit 文字（通过 hash / row-index 对应）
 *
 * 1. 节点图层 `.git-timeline-graph-scroll`（z-index 1）
 *    - 可滚 inner 宽 = 3 × 窗宽（左/右各 1 窗留白 + 中间 SVG）
 *    - 默认 scroll：最新节点圆心对齐屏幕 x = 窗宽 × 1/4
 *    - 横向滚轮统一滚图区（commit 文字层 pointer-events: none 穿透）
 *
 * 2. 轨道层 `.git-timeline-track-layer`（固定视口，不随 commit 文字滚）
 *    - 每行半透明 tint 条：left = 节点连线屏幕 x，right = 窗口右缘
 *    - 仅随 **图区 scrollLeft** 更新 `--git-bar-left`
 *
 * 3. Commit 色块层 `.git-timeline-commit-fill-layer`（固定视口）
 *    - 实色（solidTintColor = lane 色 24% 叠 #161616 的等效不透明色）
 *    - left = commit 文字列起点（随 commit 起始滑块 / scrollLeft），right = 窗口右缘
 *
 * 4. Commit 文字层 `.git-timeline-commit-scroll`（inner 可滚，层本身不接收点击）
 *    - inner = 左 1 窗 pad +（最长 subject 宽 + 1 窗）
 *    - 默认文字左缘在屏幕 x = 窗宽 × 1/2
 *    - 底部右半滑块：量程 = 最长文字宽 + 1 窗宽，滑轨中心 ↔ 窗宽中心
 *
 * 5. 底部双滚动条（50/50 固定分栏）
 *    - 左：图区横向滚动；右：commit 起始位置（与图区 decouple）
 *
 * ── 交互 ──
 * - 选中：仅点击 SVG **圆点**（`circle`），高亮白描边；轨道/色块/文字不高亮
 * - 工程路径栏：点击在 Finder 中打开（mcpFsOpenProjectRoot）
 *
 * 设计说明全文：仓库根目录 README.md →「Git 提交图谱」
 */
(function () {
  let currentProjectRoot = '';
  let panelReady = false;
  let selectedCommitHash = '';
  let gitTabInitialScrollDone = false;
  let paneHscrollSyncing = false;
  let graphHscrollSyncing = false;
  let cachedPanelLayoutWidth = 0;
  /** @type {{ min: number, max: number, range: number, center: number } | null} */
  let cachedCommitBounds = null;

  const COMMIT_START_RATIO = 0.5;
  const COMMIT_TEXT_PAD_PX = 24;
  /** 文字左缘相对 inner 起点的 inset（与 .git-commit-subject padding-left 一致） */
  const COMMIT_SUBJECT_PAD_LEFT = 28;
  /** 色块左缘比文字再靠左 0px（文字 inset 即留白） */
  const COMMIT_FILL_PAD_LEFT = 0;
  /** 图区可滚总宽 = 3 × 窗宽（左留白 1 窗 + 中间图 + 右留白 1 窗） */
  const GRAPH_SCROLL_VIEWPORT_RATIO = 3;
  /** commit 文字区左侧留白 = 1 × 窗宽 */
  const COMMIT_SCROLL_PAD_LEFT_RATIO = 1;
  /** commit 文字区宽度 = 文字 + 1 × 窗宽 */
  const COMMIT_TEXT_VIEWPORT_RATIO = 1;
  /** 节点圆心目标屏幕 x = 窗宽 × 此比例（1/4） */
  const GRAPH_INITIAL_NODE_X_RATIO = 0.25;
  /** 节点菜单相对视口边缘留白（px） */
  const NODE_MENU_VIEWPORT_PAD = 8;

  let currentBranch = '';
  let remoteOriginUrl = '';
  /** @type {{ commit: object } | null} */
  let nodeMenuContext = null;

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
    if (!mount) return null;
    const api = getApi();
    if (!api || typeof api.gitGetPanelHtml !== 'function') {
      throw new Error('Git panel API 不可用');
    }
    const needsHtml =
      mount.dataset.loaded !== '1' ||
      !mount.querySelector('#git-graph-pane-hscroll') ||
      !$('git-graph-hscroll-wrap') ||
      !mount.querySelector('button.git-info');
    if (needsHtml) {
      const res = await api.gitGetPanelHtml();
      if (!res.ok) throw new Error(res.error || '加载 Git 面板失败');
      mount.innerHTML = res.html;
      mount.dataset.loaded = '1';
    }
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
        await loadPanelHtml();
        if (!gitTabInitialScrollDone) {
          await refreshGitView({ initialScroll: true });
          gitTabInitialScrollDone = true;
        } else {
          const timeline = document.querySelector('#git-graph .git-timeline');
          if (timeline) ensurePaneHscrollSynced(timeline);
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
    statusEl.textContent =
      lines.length === 0 ? '工作区干净，无未提交变更' : lines.join('\n');
  }

  function renderStatus(state) {
    const info = $('git-info');
    if (!info) return;
    if (!state.projectRoot) {
      info.textContent = '未打开工程';
      info.disabled = true;
      delete info.dataset.projectRoot;
      currentBranch = '';
      remoteOriginUrl = '';
      renderWorkspaceStatus(state);
      return;
    }
    info.textContent = state.isRepo
      ? `${state.branch || '(detached)'} · ${state.projectRoot}`
      : `非 Git 仓库 · ${state.projectRoot}`;
    info.disabled = false;
    info.dataset.projectRoot = state.projectRoot;
    info.title = `在 Finder 中打开：${state.projectRoot}`;
    currentBranch = state.branch || '';
    remoteOriginUrl = state.remoteOriginUrl || '';
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
    timelineEl.querySelectorAll('.git-commit-node-svg.is-selected').forEach((el) => {
      el.classList.remove('is-selected');
    });
    const node = timelineEl.querySelector(`.git-commit-node-svg[data-hash="${hash}"]`);
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
      if (hash && hash === selectedCommitHash) g.classList.add('is-selected');

      const authorName =
        node.commit.author?.name || node.commit.committer?.name || 'unknown';

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
      text.setAttribute('pointer-events', 'none');
      text.textContent = node.label;

      circle.addEventListener('mouseenter', () => {
        showNodeAuthorTooltip(circle, authorName);
      });
      circle.addEventListener('mouseleave', () => {
        hideNodeAuthorTooltip();
      });
      circle.addEventListener('contextmenu', (e) => {
        showNodeContextMenu(e, node.commit, circle);
      });
      circle.addEventListener('click', (e) => {
        e.stopPropagation();
        hideNodeContextMenu();
        selectCommit(svg.closest('.git-timeline'), hash, node.commit);
      });
      g.appendChild(circle);
      g.appendChild(text);
      svg.appendChild(g);
    }
  }

  function ensureAuthorTooltip() {
    let tip = $('git-node-author-tooltip');
    if (!tip) {
      tip = document.createElement('div');
      tip.id = 'git-node-author-tooltip';
      tip.className = 'git-node-author-tooltip';
      tip.hidden = true;
      const label = document.createElement('span');
      label.className = 'git-node-author-tooltip-label';
      tip.appendChild(label);
      document.body.appendChild(tip);
    } else if (tip.parentElement !== document.body) {
      document.body.appendChild(tip);
    }
    return tip;
  }

  function showNodeAuthorTooltip(nodeEl, authorName) {
    const tip = ensureAuthorTooltip();
    const label = tip.querySelector('.git-node-author-tooltip-label');
    if (label) label.textContent = String(authorName || 'unknown');
    tip.hidden = false;
    tip.style.visibility = 'hidden';

    const rect = nodeEl.getBoundingClientRect();
    const anchorX = rect.left + rect.width / 2;
    const anchorY = rect.top;

    requestAnimationFrame(() => {
      const tipW = tip.offsetWidth;
      const tipH = tip.offsetHeight;
      const gap = 6;
      let left = anchorX - tipW / 2;
      let top = anchorY - tipH - gap;
      const pad = NODE_MENU_VIEWPORT_PAD;
      left = Math.min(Math.max(pad, left), Math.max(pad, window.innerWidth - tipW - pad));
      top = Math.min(Math.max(pad, top), Math.max(pad, window.innerHeight - tipH - pad));
      tip.style.left = `${Math.round(left)}px`;
      tip.style.top = `${Math.round(top)}px`;
      tip.style.visibility = '';
    });
  }

  function hideNodeAuthorTooltip() {
    const tip = $('git-node-author-tooltip');
    if (tip) {
      tip.hidden = true;
      tip.style.visibility = '';
    }
  }

  function buildRemoteCommitLink(remoteUrl, hash) {
    if (!remoteUrl || !hash) return '';
    const scp = String(remoteUrl).trim().match(/^git@([^:]+):(.+?)(?:\.git)?$/);
    if (scp) {
      const path = scp[2].replace(/\.git$/, '');
      return `https://${scp[1]}/${path}/commit/${hash}`;
    }
    const base = String(remoteUrl).trim().replace(/\.git$/, '');
    if (/^https?:\/\//i.test(base)) return `${base}/commit/${hash}`;
    return '';
  }

  function hideNodeContextMenu() {
    const menu = $('git-node-menu');
    if (menu) {
      menu.hidden = true;
      menu.style.visibility = '';
    }
    hideNodeAuthorTooltip();
    nodeMenuContext = null;
  }

  /** 菜单左上角对齐节点中心，超出视口时平移以保证完整可见 */
  function positionNodeContextMenu(menu, anchorX, anchorY) {
    const pad = NODE_MENU_VIEWPORT_PAD;
    menu.hidden = false;
    menu.style.visibility = 'hidden';
    menu.style.left = `${anchorX}px`;
    menu.style.top = `${anchorY}px`;

    requestAnimationFrame(() => {
      const menuW = menu.offsetWidth;
      const menuH = menu.offsetHeight;
      const viewW = window.innerWidth;
      const viewH = window.innerHeight;
      const maxLeft = Math.max(pad, viewW - menuW - pad);
      const maxTop = Math.max(pad, viewH - menuH - pad);

      let left = anchorX;
      let top = anchorY;

      if (left + menuW + pad > viewW) left = maxLeft;
      if (left < pad) left = pad;
      if (top + menuH + pad > viewH) top = maxTop;
      if (top < pad) top = pad;

      menu.style.left = `${Math.round(left)}px`;
      menu.style.top = `${Math.round(top)}px`;
      menu.style.visibility = '';
    });
  }

  function showNodeContextMenu(event, commit, nodeEl) {
    event.preventDefault();
    event.stopPropagation();
    const menu = ensureNodeContextMenu();
    const timeline = event.target.closest('.git-timeline');
    const circle = nodeEl || event.target;
    if (!menu || !timeline || !commit?.hash || !circle?.getBoundingClientRect) return;

    selectCommit(timeline, commit.hash, commit);
    nodeMenuContext = { commit };

    const resetLabel = menu.querySelector('[data-reset-label]');
    if (resetLabel) {
      resetLabel.textContent = `Reset ${currentBranch || 'HEAD'} to this commit`;
    }
    const linkItem = menu.querySelector('[data-menu-item="copy-link"]');
    if (linkItem) {
      linkItem.classList.toggle('is-disabled', !buildRemoteCommitLink(remoteOriginUrl, commit.hash));
    }

    const rect = circle.getBoundingClientRect();
    const anchorX = rect.left + rect.width / 2;
    const anchorY = rect.top + rect.height / 2;
    positionNodeContextMenu(menu, anchorX, anchorY);
  }

  async function copyText(text, okMessage) {
    if (!text) return false;
    try {
      await navigator.clipboard.writeText(text);
      setGitMessage(okMessage, false);
      return true;
    } catch (e) {
      setGitMessage(e.message || '复制失败', true);
      return false;
    }
  }

  async function handleNodeMenuAction(action, resetMode) {
    const ctx = nodeMenuContext;
    hideNodeContextMenu();
    if (!ctx?.commit?.hash) return;
    const hash = ctx.commit.hash;
    const api = getApi();

    if (action === 'copy-sha') {
      await copyText(hash, '已复制 commit sha');
      return;
    }
    if (action === 'copy-link') {
      const link = buildRemoteCommitLink(remoteOriginUrl, hash);
      if (!link) {
        setGitMessage('未配置 remote origin', true);
        return;
      }
      await copyText(link, '已复制远程 commit 链接');
      return;
    }

    if (!api || typeof api.gitNodeAction !== 'function') {
      setGitMessage('Git API 不可用', true);
      return;
    }

    if (action === 'branch') {
      const branchName = window.prompt('新分支名', '');
      if (branchName === null || !String(branchName).trim()) return;
      setGitMessage('正在创建分支…', false);
      const res = await api.gitNodeAction({
        action: 'branch',
        hash,
        branchName: String(branchName).trim(),
        projectRoot: currentProjectRoot || undefined,
      });
      await finishNodeGitAction(res, '分支已创建');
      return;
    }

    if (action === 'tag') {
      const tagName = window.prompt('标签名', '');
      if (tagName === null || !String(tagName).trim()) return;
      setGitMessage('正在创建标签…', false);
      const res = await api.gitNodeAction({
        action: 'tag',
        hash,
        tagName: String(tagName).trim(),
        projectRoot: currentProjectRoot || undefined,
      });
      await finishNodeGitAction(res, '标签已创建');
      return;
    }

    if (action === 'tag-annotated') {
      const tagName = window.prompt('附注标签名', '');
      if (tagName === null || !String(tagName).trim()) return;
      const tagMessage = window.prompt('标签说明', tagName);
      if (tagMessage === null) return;
      setGitMessage('正在创建附注标签…', false);
      const res = await api.gitNodeAction({
        action: 'tag-annotated',
        hash,
        tagName: String(tagName).trim(),
        tagMessage: String(tagMessage).trim(),
        projectRoot: currentProjectRoot || undefined,
      });
      await finishNodeGitAction(res, '附注标签已创建');
      return;
    }

    if (action === 'reset') {
      const mode = resetMode || 'mixed';
      const label = mode === 'hard' ? 'Hard' : mode === 'soft' ? 'Soft' : 'Mixed';
      if (
        !window.confirm(
          `确定将 ${currentBranch || 'HEAD'} ${label} reset 到 ${hash.slice(0, 7)} 吗？`
        )
      ) {
        return;
      }
      setGitMessage(`正在 reset（${label}）…`, false);
      const res = await api.gitNodeAction({
        action: 'reset',
        hash,
        resetMode: mode,
        projectRoot: currentProjectRoot || undefined,
      });
      await finishNodeGitAction(res, 'Reset 完成');
      return;
    }

    if (action === 'checkout' && !window.confirm(`Checkout 到 ${hash.slice(0, 7)}？`)) {
      return;
    }
    if (action === 'revert' && !window.confirm(`Revert commit ${hash.slice(0, 7)}？`)) {
      return;
    }

    const labels = {
      checkout: '正在 checkout…',
      'cherry-pick': '正在 cherry-pick…',
      revert: '正在 revert…',
      'format-patch': '正在生成 patch…',
    };
    setGitMessage(labels[action] || '正在执行…', false);
    const res = await api.gitNodeAction({
      action,
      hash,
      projectRoot: currentProjectRoot || undefined,
    });

    if (action === 'format-patch' && res?.ok && res.output) {
      await copyText(res.output, 'Patch 已复制到剪贴板');
      await refreshGitView();
      return;
    }
    await finishNodeGitAction(res, '操作完成');
  }

  async function finishNodeGitAction(res, okMessage) {
    if (!res?.ok) {
      setGitMessage(res?.error || '操作失败', true);
      return;
    }
    setGitMessage(res.output || okMessage, false);
    if (res.projectRoot) currentProjectRoot = res.projectRoot;
    renderStatus(res);
    renderGraph(res.graphData);
  }

  function ensureNodeContextMenu() {
    let menu = $('git-node-menu');
    if (!menu) {
      menu = document.createElement('nav');
      menu.id = 'git-node-menu';
      menu.className = 'git-node-menu';
      menu.hidden = true;
      menu.setAttribute('role', 'menu');
      menu.setAttribute('aria-label', 'Commit actions');
      document.body.appendChild(menu);
    } else if (menu.parentElement !== document.body) {
      document.body.appendChild(menu);
    }
    if (menu.dataset.built === '1') return menu;
    menu.dataset.built = '1';

    const addButton = (action, label, opts = {}) => {
      const item = document.createElement('div');
      item.className = 'git-node-menu-item';
      if (opts.menuItemId) item.dataset.menuItem = opts.menuItemId;
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.dataset.action = action;
      if (opts.resetMode) btn.dataset.resetMode = opts.resetMode;
      btn.textContent = label;
      item.appendChild(btn);
      menu.appendChild(item);
      return item;
    };

    const addSep = () => {
      const sep = document.createElement('div');
      sep.className = 'git-node-menu-sep';
      sep.setAttribute('aria-hidden', 'true');
      menu.appendChild(sep);
    };

    addButton('checkout', 'Checkout this commit');
    addSep();
    addButton('branch', 'Create branch here');
    addButton('cherry-pick', 'Cherry pick commit');

    const resetItem = document.createElement('div');
    resetItem.className = 'git-node-menu-item has-submenu';
    const resetBtn = document.createElement('button');
    resetBtn.type = 'button';
    resetBtn.dataset.resetLabel = '1';
    resetBtn.innerHTML =
      '<span data-reset-label>Reset HEAD to this commit</span><span class="git-node-menu-chevron"> ›</span>';
    resetItem.appendChild(resetBtn);
    const sub = document.createElement('div');
    sub.className = 'git-node-menu-submenu';
    [['mixed', 'Mixed'], ['soft', 'Soft'], ['hard', 'Hard']].forEach(([mode, label]) => {
      const b = document.createElement('button');
      b.type = 'button';
      b.dataset.action = 'reset';
      b.dataset.resetMode = mode;
      b.textContent = label;
      sub.appendChild(b);
    });
    resetItem.appendChild(sub);
    menu.appendChild(resetItem);

    addButton('revert', 'Revert commit');
    addSep();
    addButton('copy-sha', 'Copy commit sha');
    addButton('copy-link', 'Copy link to this commit on remote: origin', {
      menuItemId: 'copy-link',
    });
    addButton('format-patch', 'Create patch from commit');
    addSep();
    addButton('tag', 'Create tag here');
    addButton('tag-annotated', 'Create annotated tag here');

    menu.addEventListener('click', (e) => {
      const btn = e.target.closest('button[data-action]');
      if (!btn || btn.dataset.resetLabel) return;
      e.stopPropagation();
      handleNodeMenuAction(btn.dataset.action, btn.dataset.resetMode);
    });

    if (!menu.dataset.globalBound) {
      menu.dataset.globalBound = '1';
      document.addEventListener('click', (e) => {
        if (menu.hidden) return;
        if (menu.contains(e.target)) return;
        hideNodeContextMenu();
      });
      document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') hideNodeContextMenu();
      });
      window.addEventListener('scroll', hideNodeContextMenu, true);
      window.addEventListener('resize', hideNodeContextMenu);
    }

    return menu;
  }

  function setupNodeContextMenu() {
    ensureNodeContextMenu();
  }

  function hideGraphHscroll() {
    document.querySelector('.git-graph-hscroll-cell')?.classList.remove('is-visible');
  }

  /** 横向滚轮 / 触控板左右滑；Shift+纵滚也视为横向 */
  function getHorizontalWheelDelta(event) {
    if (Math.abs(event.deltaX) > 0.5) return event.deltaX;
    if (event.shiftKey && Math.abs(event.deltaY) > 0.5) return event.deltaY;
    return 0;
  }

  function scrollGraphByWheelDelta(timeline, delta) {
    if (!timeline || !delta) return false;
    const graphScroll = timeline.querySelector('.git-timeline-graph-scroll');
    if (!graphScroll) return false;
    graphScroll.scrollLeft += delta;
    return true;
  }

  function onGraphHorizontalWheel(event) {
    const delta = getHorizontalWheelDelta(event);
    if (!delta) return;
    const timeline = document.querySelector('#git-graph .git-timeline');
    if (!scrollGraphByWheelDelta(timeline, delta)) return;
    event.preventDefault();
  }

  function setPaneHscrollLeft(paneHscroll, scrollLeft) {
    paneHscrollSyncing = true;
    paneHscroll.scrollLeft = scrollLeft;
    requestAnimationFrame(() => {
      paneHscrollSyncing = false;
    });
  }

  function setGraphHscrollLeft(hscroll, scrollLeft) {
    graphHscrollSyncing = true;
    hscroll.scrollLeft = scrollLeft;
    requestAnimationFrame(() => {
      graphHscrollSyncing = false;
    });
  }

  function getLayoutWidth(timeline) {
    const wrap = document.querySelector('.git-graph-wrap');
    const candidates = [
      wrap?.clientWidth,
      $('git-graph')?.clientWidth,
      timeline?.clientWidth,
      timeline?.getBoundingClientRect().width,
      $('panel-git')?.clientWidth,
    ];
    for (const w of candidates) {
      if (typeof w === 'number' && w > 0) return w;
    }
    return 0;
  }

  /** 写入图区 / commit 各自的屏幕 offset（相对窗宽） */
  function applyTimelineScreenOffsets(timeline, layoutWidth) {
    if (!timeline || layoutWidth <= 0) return;
    timeline.style.setProperty('--git-layout-width', `${layoutWidth}px`);
    timeline.style.setProperty(
      '--git-graph-screen-offset',
      `${layoutWidth * GRAPH_INITIAL_NODE_X_RATIO}px`
    );
    timeline.style.setProperty(
      '--git-commit-screen-offset',
      `${layoutWidth * COMMIT_START_RATIO}px`
    );
  }

  function getGraphScreenOffset(timeline) {
    const fromCss = parseFloat(
      getComputedStyle(timeline).getPropertyValue('--git-graph-screen-offset')
    );
    if (Number.isFinite(fromCss) && fromCss > 0) return fromCss;
    return getLayoutWidth(timeline) * GRAPH_INITIAL_NODE_X_RATIO;
  }

  function getCommitScreenOffset(timeline) {
    const fromCss = parseFloat(
      getComputedStyle(timeline).getPropertyValue('--git-commit-screen-offset')
    );
    if (Number.isFinite(fromCss) && fromCss > 0) return fromCss;
    const fromStart = parseFloat(
      getComputedStyle(timeline).getPropertyValue('--git-commit-start')
    );
    if (Number.isFinite(fromStart) && fromStart > 0) return fromStart;
    return getLayoutWidth(timeline) * COMMIT_START_RATIO;
  }

  function measureMaxCommitTextWidth(timeline) {
    let max = 0;
    timeline?.querySelectorAll('.git-commit-subject').forEach((el) => {
      max = Math.max(max, el.scrollWidth || el.offsetWidth || 0);
    });
    return max;
  }

  function invalidateCommitBoundsCache() {
    cachedPanelLayoutWidth = 0;
    cachedCommitBounds = null;
  }

  /** commit 起始位置滑块量程 = 最长 commit 文字宽 + 1 × 窗宽 */
  function getCommitScrollRange(timeline) {
    const layoutWidth = getLayoutWidth(timeline);
    if (layoutWidth <= 0) return 0;
    return measureMaxCommitTextWidth(timeline) + layoutWidth;
  }

  /** @returns {{ min: number, max: number, range: number, center: number } | null} */
  function getCommitStartBounds(timeline, options = {}) {
    const layoutWidth = getLayoutWidth(timeline);
    if (layoutWidth <= 0) return null;
    if (
      !options.force &&
      cachedCommitBounds &&
      cachedPanelLayoutWidth > 0 &&
      Math.abs(layoutWidth - cachedPanelLayoutWidth) < 1
    ) {
      return cachedCommitBounds;
    }
    const range = Math.max(1, getCommitScrollRange(timeline));
    const center = getCommitTextScreenTarget(timeline);
    const min = center - range / 2;
    const max = center + range / 2;
    cachedPanelLayoutWidth = layoutWidth;
    cachedCommitBounds = { min, max, range, center };
    return cachedCommitBounds;
  }

  /** commit 文字左缘默认在窗口 1/2 处开始显示 */
  function getCommitTextScreenTarget(timeline) {
    const layoutWidth = getLayoutWidth(timeline);
    if (layoutWidth <= 0) return 0;
    return Math.round(layoutWidth * COMMIT_START_RATIO);
  }

  function getDefaultCommitStart(timeline) {
    return getCommitTextScreenTarget(timeline);
  }

  function clampCommitStart(timeline, value) {
    const bounds = getCommitStartBounds(timeline);
    if (!bounds) return Math.max(0, value);
    return Math.min(bounds.max, Math.max(bounds.min, value));
  }

  /** 滑轨 scrollLeft ↔ 屏幕 anchor：中心对中心，量程 = 文字宽 + 1 窗宽 */
  function commitStartToPaneScroll(timeline, screenOffsetPx) {
    const bounds = getCommitStartBounds(timeline);
    if (!bounds) return 0;
    return bounds.range / 2 + (bounds.center - screenOffsetPx);
  }

  function paneScrollToCommitStart(timeline, scrollLeft) {
    const bounds = getCommitStartBounds(timeline);
    if (!bounds) return getDefaultCommitStart(timeline);
    return bounds.center + (bounds.range / 2 - scrollLeft);
  }

  function getCommitPadLeft(timeline) {
    const layoutWidth = getLayoutWidth(timeline);
    if (layoutWidth <= 0) return 0;
    const fromCss = parseFloat(
      getComputedStyle(timeline).getPropertyValue('--git-commit-pad-left')
    );
    if (Number.isFinite(fromCss) && fromCss > 0) return fromCss;
    return layoutWidth * COMMIT_SCROLL_PAD_LEFT_RATIO;
  }

  function refreshCommitScrollWidth(timeline) {
    const layoutWidth = getLayoutWidth(timeline);
    if (layoutWidth <= 0 || !timeline) return;
    const maxTextW = measureMaxCommitTextWidth(timeline);
    const leftPad = layoutWidth * COMMIT_SCROLL_PAD_LEFT_RATIO;
    const textAreaW =
      maxTextW + COMMIT_TEXT_PAD_PX + layoutWidth * COMMIT_TEXT_VIEWPORT_RATIO;
    const totalW = leftPad + textAreaW;
    timeline.style.setProperty('--git-commit-pad-left', `${leftPad}px`);
    timeline.style.setProperty('--git-commit-subject-pad-left', `${COMMIT_SUBJECT_PAD_LEFT}px`);
    timeline.style.setProperty('--git-commit-text-width', `${textAreaW}px`);
    timeline.style.setProperty('--git-commit-scroll-width', `${totalW}px`);
  }

  /** commit 文字左缘 offset：scrollLeft = 文字 inner 起点 − screen offset */
  function syncCommitScrollPosition(timeline, screenOffsetPx) {
    const commitScroll = timeline.querySelector('.git-timeline-commit-scroll');
    if (!commitScroll) return;
    const w = getLayoutWidth(timeline);
    if (w <= 0) return;
    const leftPad = w * COMMIT_SCROLL_PAD_LEFT_RATIO;
    const offset =
      typeof screenOffsetPx === 'number' && Number.isFinite(screenOffsetPx)
        ? screenOffsetPx
        : getCommitScreenOffset(timeline);
    const textOriginInner = leftPad + COMMIT_SUBJECT_PAD_LEFT;
    const targetScroll = textOriginInner - offset;
    const max = Math.max(0, commitScroll.scrollWidth - commitScroll.clientWidth);
    commitScroll.scrollLeft = Math.min(max, Math.max(0, targetScroll));
    syncCommitFillPositions(timeline);
  }

  function updateCommitContentMetrics(timeline) {
    refreshCommitScrollWidth(timeline);
    invalidateCommitBoundsCache();
    getCommitStartBounds(timeline, { force: true });
  }

  function applyGraphScrollLayout(timeline, layoutWidth) {
    if (!timeline || layoutWidth <= 0) return;
    applyTimelineScreenOffsets(timeline, layoutWidth);
    const lineW =
      typeof GitTimelineLayout !== 'undefined' ? GitTimelineLayout.LINE_WIDTH : 2;
    const padLeft = layoutWidth;
    const scrollWidth = layoutWidth * GRAPH_SCROLL_VIEWPORT_RATIO;
    timeline.style.setProperty('--git-scroll-pad-left', `${padLeft}px`);
    timeline.style.setProperty('--git-scroll-width', `${scrollWidth}px`);
    timeline.dataset.layoutWidth = String(layoutWidth);
    timeline.querySelectorAll('.git-commit-track-row[data-node-x]').forEach((track) => {
      const nodeX = parseFloat(track.dataset.nodeX);
      if (!Number.isFinite(nodeX)) return;
      track.dataset.lineRight = String(padLeft + nodeX + lineW / 2);
    });
    syncTrackBarPositions(timeline);
  }

  function syncGraphHscroll(timeline) {
    const graphCell = document.querySelector('.git-graph-hscroll-cell');
    const hscroll = $('git-graph-hscroll');
    const inner = $('git-graph-hscroll-inner');
    const graphScroll = timeline?.querySelector('.git-timeline-graph-scroll');
    if (!graphCell || !hscroll || !inner || !graphScroll) {
      hideGraphHscroll();
      return;
    }
    const paneWidth = graphScroll.clientWidth;
    const scrollWidth = graphScroll.scrollWidth;
    const needsScroll = scrollWidth > paneWidth + 1;
    graphCell.classList.toggle('is-visible', needsScroll);
    if (!needsScroll) return;

    const trackRatio = hscroll.clientWidth / Math.max(1, paneWidth);
    inner.style.width = `${Math.max(scrollWidth * trackRatio, hscroll.clientWidth + 1)}px`;

    const graphMax = Math.max(0, scrollWidth - paneWidth);
    const hMax = Math.max(0, inner.offsetWidth - hscroll.clientWidth);
    let targetLeft = graphScroll.scrollLeft;
    if (graphMax > 0 && hMax > 0) {
      targetLeft = (graphScroll.scrollLeft / graphMax) * hMax;
    }
    if (Math.abs(hscroll.scrollLeft - targetLeft) > 1) {
      setGraphHscrollLeft(hscroll, targetLeft);
    }
  }

  function getGraphScrollPadLeft(timeline) {
    const layoutWidth = getLayoutWidth(timeline);
    if (layoutWidth <= 0) return 0;
    const fromCss = parseFloat(
      getComputedStyle(timeline).getPropertyValue('--git-scroll-pad-left')
    );
    if (Number.isFinite(fromCss) && fromCss > 0) return fromCss;
    return layoutWidth;
  }

  /** 节点圆心在图区 inner 坐标系下的 x */
  function getNodeInnerX(timeline, trackRow) {
    if (!trackRow) return null;
    const nodeX = parseFloat(trackRow.dataset.nodeX);
    if (Number.isFinite(nodeX)) return getGraphScrollPadLeft(timeline) + nodeX;
    const lineRight = parseFloat(trackRow.dataset.lineRight);
    const lineW =
      typeof GitTimelineLayout !== 'undefined' ? GitTimelineLayout.LINE_WIDTH : 2;
    if (Number.isFinite(lineRight)) return lineRight - lineW / 2;
    return null;
  }

  /** 节点圆心 offset：scrollLeft = nodeInnerX − graph screen offset */
  function scrollGraphToInitialPosition(timeline) {
    const graphScroll = timeline.querySelector('.git-timeline-graph-scroll');
    const newestTrack = timeline.querySelector('.git-commit-track-row:first-child');
    if (!graphScroll || !newestTrack) return;
    const nodeInnerX = getNodeInnerX(timeline, newestTrack);
    if (nodeInnerX == null) return;
    const offset = getGraphScreenOffset(timeline);
    const maxScroll = Math.max(0, graphScroll.scrollWidth - graphScroll.clientWidth);
    graphScroll.scrollLeft = Math.min(maxScroll, Math.max(0, nodeInnerX - offset));
    syncTrackBarPositions(timeline);
    syncGraphHscroll(timeline);
  }

  function resetPaneHscroll() {
    const paneHscroll = $('git-graph-pane-hscroll');
    const inner = $('git-graph-pane-hscroll-inner');
    if (inner) inner.style.width = '1px';
    if (paneHscroll) paneHscroll.scrollLeft = 0;
  }

  function updatePaneHscrollInner(timeline) {
    const paneHscroll = $('git-graph-pane-hscroll');
    const inner = $('git-graph-pane-hscroll-inner');
    if (!paneHscroll || !inner || !timeline) return false;
    const bounds = getCommitStartBounds(timeline);
    if (!bounds) return false;
    const range = bounds.range;
    const viewport = paneHscroll.clientWidth;
    if (viewport <= 0) return false;
    inner.style.width = `${range + viewport}px`;
    return true;
  }

  function syncPaneHscroll(timeline, options = {}) {
    const paneHscroll = $('git-graph-pane-hscroll');
    if (!paneHscroll) return;
    if (!timeline) {
      resetPaneHscroll();
      return;
    }
    if (!updatePaneHscrollInner(timeline)) return;
    const bounds = getCommitStartBounds(timeline);
    if (!bounds) return;
    let value = options.value;
    if (value == null) value = getCommitScreenOffset(timeline);
    const next = clampCommitStart(timeline, value);
    const targetScroll = commitStartToPaneScroll(timeline, next);
    const maxScroll = Math.max(0, paneHscroll.scrollWidth - paneHscroll.clientWidth);
    const clampedScroll = Math.min(maxScroll, Math.max(0, targetScroll));
    if (Math.abs(paneHscroll.scrollLeft - clampedScroll) > 1) {
      setPaneHscrollLeft(paneHscroll, clampedScroll);
    }
  }

  /** 等底部 commit 滑块有宽度后再同步 thumb（默认 = 窗宽 1/2） */
  function ensurePaneHscrollSynced(timeline, value, attempt = 0) {
    if (!timeline?.isConnected) return;
    const paneHscroll = $('git-graph-pane-hscroll');
    if (!paneHscroll) return;
    if (paneHscroll.clientWidth <= 0) {
      if (attempt < 12) {
        requestAnimationFrame(() => ensurePaneHscrollSynced(timeline, value, attempt + 1));
      }
      return;
    }
    const target =
      typeof value === 'number' && Number.isFinite(value)
        ? value
        : getDefaultCommitStart(timeline);
    syncPaneHscroll(timeline, { value: target });
  }

  function setupPaneHscrollLayoutObserver() {
    const paneHscroll = $('git-graph-pane-hscroll');
    if (!paneHscroll || paneHscroll.dataset.layoutRoBound === '1') return;
    paneHscroll.dataset.layoutRoBound = '1';
    if (typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver(() => {
      const timeline = document.querySelector('#git-graph .git-timeline');
      if (!timeline) return;
      updatePaneHscrollInner(timeline);
      syncPaneHscroll(timeline);
    });
    ro.observe(paneHscroll);
  }

  function applyCommitStart(timeline, startPx, options = {}) {
    if (!timeline?.isConnected) return 0;
    const next = Math.round(clampCommitStart(timeline, startPx));
    timeline.style.setProperty('--git-commit-screen-offset', `${next}px`);
    timeline.style.setProperty('--git-commit-start', `${next}px`);
    syncCommitScrollPosition(timeline, next);
    if (options.fromPaneHscroll) return next;
    ensurePaneHscrollSynced(timeline, next);
    return next;
  }

  /** 色块层：左缘随 commit 文字，右缘贴窗口；不随文字 inner 滚动 */
  function syncCommitFillPositions(timeline) {
    const commitScroll = timeline.querySelector('.git-timeline-commit-scroll');
    if (!commitScroll) return;
    const leftPad = getCommitPadLeft(timeline);
    const fillOriginInner = leftPad + COMMIT_FILL_PAD_LEFT;
    const fillLeft = Math.max(0, fillOriginInner - commitScroll.scrollLeft);
    timeline.querySelectorAll('.git-commit-fill-row').forEach((row) => {
      row.style.setProperty('--git-fill-left', `${fillLeft}px`);
    });
  }

  /** 轨道层：从节点连线到窗口最右侧，不随 commit 文字滚动 */
  function syncTrackBarPositions(timeline) {
    const graphScroll = timeline.querySelector('.git-timeline-graph-scroll');
    if (!graphScroll) return;
    const graphScrollLeft = graphScroll.scrollLeft;
    timeline.querySelectorAll('.git-commit-track-row[data-line-right]').forEach((track) => {
      const lineRight = parseFloat(track.dataset.lineRight);
      if (!Number.isFinite(lineRight)) return;
      const nodeLineScreenX = lineRight - graphScrollLeft;
      track.style.setProperty('--git-bar-left', `${Math.max(0, nodeLineScreenX)}px`);
    });
  }

  function bindTimelineBarSync(timeline) {
    const graphScroll = timeline.querySelector('.git-timeline-graph-scroll');
    const commitScroll = timeline.querySelector('.git-timeline-commit-scroll');
    const hscroll = $('git-graph-hscroll');
    if (!graphScroll) return;
    const onGraphWheel = (event) => {
      const delta = getHorizontalWheelDelta(event);
      if (!delta) return;
      event.preventDefault();
      graphScroll.scrollLeft += delta;
    };
    graphScroll.addEventListener('wheel', onGraphWheel, { passive: false });
    const onCommitScrollSync = () => syncCommitFillPositions(timeline);
    commitScroll?.addEventListener('scroll', onCommitScrollSync, { passive: true });
    const onGraphScrollSync = () => {
      syncTrackBarPositions(timeline);
      syncGraphHscroll(timeline);
    };
    graphScroll.addEventListener('scroll', onGraphScrollSync, { passive: true });
    let hscrollSyncing = false;
    const onHscroll = () => {
      if (hscrollSyncing || graphHscrollSyncing) return;
      hscrollSyncing = true;
      const inner = $('git-graph-hscroll-inner');
      const paneWidth = graphScroll.clientWidth;
      const scrollWidth = graphScroll.scrollWidth;
      const graphMax = Math.max(0, scrollWidth - paneWidth);
      const hMax = Math.max(0, (inner?.offsetWidth || 0) - (hscroll?.clientWidth || 0));
      if (graphMax > 0 && hMax > 0) {
        graphScroll.scrollLeft = (hscroll.scrollLeft / hMax) * graphMax;
      } else if (hscroll) {
        graphScroll.scrollLeft = hscroll.scrollLeft;
      }
      syncTrackBarPositions(timeline);
      hscrollSyncing = false;
    };
    hscroll?.addEventListener('scroll', onHscroll, { passive: true });
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        onGraphScrollSync();
        syncCommitFillPositions(timeline);
      });
    });
    timeline._barSyncCleanup = () => {
      graphScroll.removeEventListener('scroll', onGraphScrollSync);
      graphScroll.removeEventListener('wheel', onGraphWheel);
      hscroll?.removeEventListener('scroll', onHscroll);
      commitScroll?.removeEventListener('scroll', onCommitScrollSync);
      hideGraphHscroll();
    };
  }

  function renderGraph(graphData, options = {}) {
    const container = $('git-graph');
    if (!container) return;

    const prevTimeline = container.querySelector('.git-timeline');
    prevTimeline?._barSyncCleanup?.();
    prevTimeline?._layoutRo?.disconnect();

    container.innerHTML = '';
    invalidateCommitBoundsCache();
    if (!graphData || graphData.length === 0) {
      container.innerHTML = '<div class="git-graph-empty">暂无提交记录</div>';
      resetPaneHscroll();
      hideGraphHscroll();
      return;
    }

    if (typeof GitTimelineLayout === 'undefined') {
      container.innerHTML = '<div class="git-graph-empty">时间线布局未加载</div>';
      return;
    }

    const layoutWidth = getLayoutWidth(container) || getLayoutWidth($('panel-git'));
    const model = GitTimelineLayout.buildTimelineModel(graphData, layoutWidth);
    const rowH = GitTimelineLayout.ROW_HEIGHT;
    const lineW = GitTimelineLayout.LINE_WIDTH;
    const scrollW = model.scrollWidth;
    const scrollPadLeft = model.scrollPadLeft ?? Math.max(0, scrollW - model.graphWidth);

    const timeline = document.createElement('div');
    timeline.className = 'git-timeline';
    timeline.style.setProperty('--git-graph-width', `${model.graphWidth}px`);
    timeline.style.setProperty('--git-scroll-width', `${scrollW}px`);
    timeline.style.setProperty('--git-scroll-pad-left', `${scrollPadLeft}px`);
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

    const commitLayer = document.createElement('div');
    commitLayer.className = 'git-timeline-commit-layer';

    const trackLayer = document.createElement('div');
    trackLayer.className = 'git-timeline-track-layer';

    const fillLayer = document.createElement('div');
    fillLayer.className = 'git-timeline-commit-fill-layer';

    const commitScroll = document.createElement('div');
    commitScroll.className = 'git-timeline-commit-scroll';

    const commitInner = document.createElement('div');
    commitInner.className = 'git-timeline-commit-scroll-inner';

    const rows = document.createElement('div');
    rows.className = 'git-timeline-rows';

    const nodeByHash = new Map(model.nodes.map((n) => [n.commit.hash, n]));

    model.display.forEach((commit, rowIndex) => {
      const hash = commit.hash || '';
      const nodeMeta = nodeByHash.get(hash);

      const trackRow = document.createElement('div');
      trackRow.className = 'git-commit-track-row';
      trackRow.style.setProperty('--row-index', String(rowIndex));
      if (nodeMeta) {
        trackRow.style.setProperty('--git-row-tint', nodeMeta.tint);
        trackRow.style.setProperty('--git-node-color', nodeMeta.color);
        trackRow.dataset.nodeX = String(nodeMeta.x);
        trackRow.dataset.lineRight = String(scrollPadLeft + nodeMeta.x + lineW / 2);
      }
      trackRow.dataset.hash = hash;
      const bar = document.createElement('span');
      bar.className = 'git-commit-bar';
      bar.setAttribute('aria-hidden', 'true');
      trackRow.appendChild(bar);
      trackLayer.appendChild(trackRow);

      const fillRow = document.createElement('div');
      fillRow.className = 'git-commit-fill-row';
      fillRow.style.setProperty('--row-index', String(rowIndex));
      if (nodeMeta) {
        fillRow.style.setProperty('--git-node-color', nodeMeta.fill || nodeMeta.color);
      }
      fillRow.dataset.hash = hash;
      const fillBar = document.createElement('span');
      fillBar.className = 'git-commit-fill-bar';
      fillBar.setAttribute('aria-hidden', 'true');
      fillRow.appendChild(fillBar);
      fillLayer.appendChild(fillRow);

      const row = document.createElement('div');
      row.className = 'git-commit-row';
      row.style.height = `${rowH}px`;
      row.dataset.hash = hash;

      const subject = document.createElement('span');
      subject.className = 'git-commit-subject';
      subject.textContent = commit.subject || '(no message)';
      row.appendChild(subject);

      rows.appendChild(row);
    });

    commitInner.appendChild(rows);
    commitScroll.appendChild(commitInner);
    commitLayer.appendChild(trackLayer);
    commitLayer.appendChild(fillLayer);
    commitLayer.appendChild(commitScroll);
    timeline.appendChild(commitLayer);
    container.appendChild(timeline);

    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        const w = getLayoutWidth(timeline);
        if (w > 0) applyGraphScrollLayout(timeline, w);
        updateCommitContentMetrics(timeline);
        applyCommitStart(timeline, getDefaultCommitStart(timeline));
        ensurePaneHscrollSynced(timeline, getDefaultCommitStart(timeline));
        if (options.initialScroll) {
          scrollGraphToInitialPosition(timeline);
        } else {
          syncTrackBarPositions(timeline);
          syncGraphHscroll(timeline);
        }
      });
    });

    bindTimelineBarSync(timeline);
    if (typeof ResizeObserver !== 'undefined') {
      const panel = $('panel-git');
      let lastPanelWidth = 0;
      const layoutRo = new ResizeObserver((entries) => {
        const w = Math.round(entries[0]?.contentRect?.width ?? 0);
        if (w <= 0 || w === lastPanelWidth) return;
        lastPanelWidth = w;
        applyGraphScrollLayout(timeline, w);
        invalidateCommitBoundsCache();
        updateCommitContentMetrics(timeline);
        applyCommitStart(timeline, Math.round(w * COMMIT_START_RATIO));
        scrollGraphToInitialPosition(timeline);
        ensurePaneHscrollSynced(timeline, Math.round(w * COMMIT_START_RATIO));
      });
      if (panel) layoutRo.observe(panel);
      timeline._layoutRo = layoutRo;
    }
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
    $('nav-pecado')?.addEventListener('click', () => showView('chat'));
    $('nav-git')?.addEventListener('click', () => showView('git'));
  }

  function setupHscrollWrapWheel() {
    const wrap = $('git-graph-hscroll-wrap');
    if (!wrap || wrap.dataset.wheelBound === '1') return;
    wrap.dataset.wheelBound = '1';
    wrap.addEventListener('wheel', onGraphHorizontalWheel, { passive: false, capture: true });
  }

  function setupPaneHscroll() {
    const paneHscroll = $('git-graph-pane-hscroll');
    if (!paneHscroll || paneHscroll.dataset.bound === '1') return;
    paneHscroll.dataset.bound = '1';
    paneHscroll.addEventListener(
      'scroll',
      () => {
        if (paneHscrollSyncing) return;
        const timeline = document.querySelector('#git-graph .git-timeline');
        if (!timeline) return;
        const bounds = getCommitStartBounds(timeline);
        if (!bounds) return;
        applyCommitStart(timeline, paneScrollToCommitStart(timeline, paneHscroll.scrollLeft), {
          fromPaneHscroll: true,
        });
      },
      { passive: true }
    );
    setupHscrollWrapWheel();
    setupPaneHscrollLayoutObserver();
  }

  function setupProjectInfoClick() {
    const info = $('git-info');
    if (!info || info.dataset.clickBound === '1') return;
    info.dataset.clickBound = '1';
    info.addEventListener('click', async () => {
      const root = info.dataset.projectRoot || currentProjectRoot;
      if (!root || info.disabled) return;
      const api = getApi();
      if (!api || typeof api.mcpFsOpenProjectRoot !== 'function') return;
      const res = await api.mcpFsOpenProjectRoot({ projectRoot: root });
      if (!res?.ok && res?.error) {
        setGitMessage(res.error, true);
      }
    });
  }

  function setupToolbar() {
    const mount = $('panel-git');
    if (!mount || mount.dataset.toolbarBound === '1') {
      setupPaneHscroll();
      setupProjectInfoClick();
      setupNodeContextMenu();
      return;
    }
    mount.dataset.toolbarBound = '1';
    $('git-btn-pull')?.addEventListener('click', () => runGitAction('pull'));
    $('git-btn-push')?.addEventListener('click', () => runGitAction('push'));
    $('git-btn-commit')?.addEventListener('click', () => runGitAction('commit'));
    setupPaneHscroll();
    setupProjectInfoClick();
    setupNodeContextMenu();
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
      if (panelReady && currentProjectRoot) refreshGitView();
    });
  }

  function init() {
    setupSidebar();
    setupPaneHscroll();
    setupHscrollWrapWheel();
    setupProjectInfoClick();
    setupNodeContextMenu();
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
