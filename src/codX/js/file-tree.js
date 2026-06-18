/**
 * @file file-tree.js
 * Xcode 风格工程文件树（目录 + 文件）；按工程记忆展开与选中
 */
(function () {
  const EXPANDED_PREFIX = 'codx.tree.expanded.';
  const SELECTED_PREFIX = 'codx.tree.selected.';

  function iconForName(name, isDir) {
    if (isDir) return '📁';
    const ext = name.includes('.') ? name.slice(name.lastIndexOf('.')).toLowerCase() : '';
    if (ext === '.swift') return '🐦';
    if (['.m', '.mm', '.h'].includes(ext)) return 'Ⓜ️';
    if (['.js', '.ts', '.jsx', '.tsx'].includes(ext)) return '📜';
    if (ext === '.json') return '{}';
    if (['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.ico', '.bmp'].includes(ext)) return '🖼';
    if (ext === '.pdf') return '📕';
    if (['.mp4', '.webm', '.mov'].includes(ext)) return '🎬';
    if (['.mp3', '.wav', '.m4a', '.aac', '.ogg'].includes(ext)) return '🎵';
    return '📄';
  }

  function shouldSkipDir(name) {
    return (
      name.startsWith('.') ||
      name === 'node_modules' ||
      name === 'DerivedData' ||
      name === 'Pods' ||
      name === 'build'
    );
  }

  function isDirectoryNode(node) {
    if (!node || typeof node !== 'object') return false;
    return node.type === 'directory';
  }

  function relPathForNode(node, relPrefix, projectRoot) {
    const name = String(node.name || '').trim();
    const rawPath = String(node.path || '').trim();
    if (rawPath && projectRoot) {
      const root = String(projectRoot).replace(/\/+$/, '');
      if (rawPath.startsWith(`${root}/`)) return rawPath.slice(root.length + 1);
      if (rawPath === root) return name;
    }
    return relPrefix ? `${relPrefix}/${name}` : name;
  }

  function storageKey(projectRoot, prefix) {
    return `${prefix}${encodeURIComponent(String(projectRoot || ''))}`;
  }

  function loadExpandedPaths(projectRoot) {
    if (!projectRoot) return [];
    try {
      const raw = localStorage.getItem(storageKey(projectRoot, EXPANDED_PREFIX));
      const parsed = raw ? JSON.parse(raw) : [];
      return Array.isArray(parsed) ? parsed.filter(Boolean) : [];
    } catch (_) {
      return [];
    }
  }

  function loadSelectedPath(projectRoot) {
    if (!projectRoot) return '';
    try {
      return String(localStorage.getItem(storageKey(projectRoot, SELECTED_PREFIX)) || '').trim();
    } catch (_) {
      return '';
    }
  }

  function ancestorDirPaths(relPath) {
    const parts = String(relPath || '')
      .replace(/\\/g, '/')
      .split('/')
      .filter(Boolean);
    if (parts.length <= 1) return [];
    const out = [];
    for (let i = 0; i < parts.length - 1; i += 1) {
      out.push(parts.slice(0, i + 1).join('/'));
    }
    return out;
  }

  function persistTreeState() {
    if (!currentProjectRoot) return;
    try {
      localStorage.setItem(
        storageKey(currentProjectRoot, EXPANDED_PREFIX),
        JSON.stringify([...expandedPathsSet])
      );
      localStorage.setItem(
        storageKey(currentProjectRoot, SELECTED_PREFIX),
        activeTreePath || ''
      );
    } catch (_) {
      /* ignore */
    }
  }

  let persistTimer = null;

  function schedulePersistTreeState() {
    clearTimeout(persistTimer);
    persistTimer = setTimeout(persistTreeState, 120);
  }

  /**
   * @param {unknown} node
   * @param {string} relPrefix
   * @returns {{ name: string, relPath: string, isDir: boolean, children?: object[] } | null}
   */
  function normalizeNode(node, relPrefix = '', projectRoot = '') {
    if (!node || typeof node !== 'object') return null;
    const name = String(node.name || '').trim();
    if (!name) return null;

    const isDir = isDirectoryNode(node);
    const relPath = relPathForNode(node, relPrefix, projectRoot);

    if (isDir && shouldSkipDir(name)) return null;

    if (!isDir) {
      return { name, relPath, isDir: false };
    }

    /** @type {Array<{ name: string, relPath: string, isDir: boolean, children?: object[] }>} */
    const children = [];
    if (Array.isArray(node.children)) {
      for (const child of node.children) {
        const normalized = normalizeNode(child, relPath, projectRoot);
        if (normalized) children.push(normalized);
      }
    }
    children.sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    return { name, relPath, isDir: true, children };
  }

  /**
   * @param {unknown} tree
   * @returns {Array<{ name: string, relPath: string, isDir: boolean, children?: object[] }>}
   */
  function buildRootItems(tree, projectRoot = '') {
    /** @type {Array<{ name: string, relPath: string, isDir: boolean, children?: object[] }>} */
    const items = [];
    const nodes = Array.isArray(tree) ? tree : tree ? [tree] : [];
    for (const node of nodes) {
      const n = normalizeNode(node, '', projectRoot);
      if (n) items.push(n);
    }
    items.sort((a, b) => {
      if (a.isDir !== b.isDir) return a.isDir ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
    return items;
  }

  /** @type {HTMLElement | null} */
  let treeContainer = null;
  let activeTreePath = '';
  let currentProjectRoot = '';
  /** @type {Set<string>} */
  let expandedPathsSet = new Set();
  /** @type {{ relPath: string } | null} */
  let fileMenuContext = null;
  let fileMenuBound = false;

  function absPathForRel(relPath) {
    const root = String(currentProjectRoot || '').replace(/\/+$/, '');
    const rel = String(relPath || '').replace(/^\/+/, '');
    if (!root) return rel;
    return `${root}/${rel}`;
  }

  function hideFileContextMenu() {
    const menu = document.getElementById('codx-file-menu');
    if (menu) {
      menu.hidden = true;
      menu.style.visibility = '';
    }
    fileMenuContext = null;
  }

  function positionFileContextMenu(menu, clientX, clientY) {
    const pad = 8;
    menu.hidden = false;
    menu.style.visibility = 'hidden';
    menu.style.left = `${clientX}px`;
    menu.style.top = `${clientY}px`;

    requestAnimationFrame(() => {
      const menuW = menu.offsetWidth;
      const menuH = menu.offsetHeight;
      let left = clientX;
      let top = clientY;
      if (left + menuW + pad > window.innerWidth) {
        left = Math.max(pad, window.innerWidth - menuW - pad);
      }
      if (top + menuH + pad > window.innerHeight) {
        top = Math.max(pad, window.innerHeight - menuH - pad);
      }
      menu.style.left = `${Math.round(left)}px`;
      menu.style.top = `${Math.round(top)}px`;
      menu.style.visibility = '';
    });
  }

  function ensureFileContextMenu() {
    let menu = document.getElementById('codx-file-menu');
    if (menu) return menu;

    menu = document.createElement('div');
    menu.id = 'codx-file-menu';
    menu.className = 'codx-file-menu';
    menu.hidden = true;
    menu.innerHTML =
      '<div class="codx-file-menu-item"><button type="button" data-action="finder">Show in Finder</button></div>' +
      '<div class="codx-file-menu-item"><button type="button" data-action="copy">Copy</button></div>';
    document.body.appendChild(menu);

    menu.querySelector('[data-action="finder"]')?.addEventListener('click', () => {
      const ctx = fileMenuContext;
      hideFileContextMenu();
      if (!ctx?.relPath) return;
      const abs = absPathForRel(ctx.relPath);
      window.electronAPI?.mcpFsOpenPath?.({ path: abs })?.catch?.((e) => {
        console.warn('[CodX] show in Finder failed', e);
      });
    });

    menu.querySelector('[data-action="copy"]')?.addEventListener('click', () => {
      const ctx = fileMenuContext;
      hideFileContextMenu();
      if (!ctx?.relPath) return;
      const abs = absPathForRel(ctx.relPath);
      window.electronAPI?.mcpFsCopyFiles?.({ path: abs })?.then?.((res) => {
        if (!res?.ok) console.warn('[CodX] copy file failed', res?.error);
      })?.catch?.((e) => {
        console.warn('[CodX] copy file failed', e);
      });
    });

    return menu;
  }

  function bindFileContextMenuDismiss() {
    if (fileMenuBound) return;
    fileMenuBound = true;
    document.addEventListener('click', (e) => {
      const menu = document.getElementById('codx-file-menu');
      if (!menu || menu.hidden) return;
      if (menu.contains(e.target)) return;
      hideFileContextMenu();
    });
    document.addEventListener('contextmenu', (e) => {
      const menu = document.getElementById('codx-file-menu');
      if (!menu || menu.hidden) return;
      if (menu.contains(e.target)) return;
      hideFileContextMenu();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') hideFileContextMenu();
    });
    window.addEventListener('scroll', hideFileContextMenu, true);
  }

  function showFileContextMenu(event, relPath) {
    event.preventDefault();
    event.stopPropagation();
    bindFileContextMenuDismiss();
    const menu = ensureFileContextMenu();
    fileMenuContext = { relPath: String(relPath || '') };
    positionFileContextMenu(menu, event.clientX, event.clientY);
  }

  function expandDirRow(row, persist = true) {
    const group = row?.nextElementSibling;
    if (!group?.classList.contains('codx-tree-group')) return;
    group.hidden = false;
    const chevron = row.querySelector('.codx-tree-chevron');
    if (chevron) chevron.textContent = '▾';
    const relPath = row.dataset.relPath;
    if (relPath) expandedPathsSet.add(relPath);
    if (persist) schedulePersistTreeState();
  }

  function collapseDirRow(row, persist = true) {
    const group = row?.nextElementSibling;
    if (!group?.classList.contains('codx-tree-group')) return;
    group.hidden = true;
    const chevron = row.querySelector('.codx-tree-chevron');
    if (chevron) chevron.textContent = '▸';
    const relPath = row.dataset.relPath;
    if (relPath) expandedPathsSet.delete(relPath);
    if (persist) schedulePersistTreeState();
  }

  function applyExpandedPaths(container) {
    if (!container) return;
    for (const path of expandedPathsSet) {
      const row = container.querySelector(
        `.codx-tree-row.is-dir[data-rel-path="${CSS.escape(path)}"]`
      );
      if (row) expandDirRow(row, false);
    }
  }

  function createRow(item, depth, onSelect) {
    const row = document.createElement('button');
    row.type = 'button';
    row.className = `codx-tree-row${item.isDir ? ' is-dir' : ' is-file'}`;
    row.style.paddingLeft = `${8 + depth * 14}px`;
    row.dataset.relPath = item.relPath;
    row.dataset.isDir = item.isDir ? '1' : '0';

    const chevron = document.createElement('span');
    chevron.className = 'codx-tree-chevron';
    chevron.textContent = item.isDir ? (item.children?.length ? '▸' : '▸') : ' ';
    chevron.setAttribute('aria-hidden', 'true');

    const icon = document.createElement('span');
    icon.className = 'codx-tree-icon';
    icon.textContent = iconForName(item.name, item.isDir);

    const label = document.createElement('span');
    label.className = 'codx-tree-label';
    label.textContent = item.name;

    row.appendChild(chevron);
    row.appendChild(icon);
    row.appendChild(label);

    if (!item.isDir) {
      row.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        hideFileContextMenu();
        setActivePath(item.relPath);
        onSelect?.(item.relPath);
      });
      row.addEventListener('contextmenu', (e) => {
        showFileContextMenu(e, item.relPath);
      });
    } else {
      row.addEventListener('click', (e) => {
        e.preventDefault();
        const group = row.nextElementSibling;
        if (group?.classList.contains('codx-tree-group')) {
          const open = group.hidden;
          if (open) expandDirRow(row);
          else collapseDirRow(row);
        }
      });
      row.addEventListener('contextmenu', (e) => {
        showFileContextMenu(e, item.relPath);
      });
    }
    return row;
  }

  function renderGroup(container, items, depth, onSelect) {
    for (const item of items) {
      container.appendChild(createRow(item, depth, onSelect));
      if (item.isDir && item.children?.length) {
        const group = document.createElement('div');
        group.className = 'codx-tree-group';
        group.hidden = true;
        renderGroup(group, item.children, depth + 1, onSelect);
        container.appendChild(group);
      }
    }
  }

  function setActivePath(relPath) {
    activeTreePath = String(relPath || '');
    if (!treeContainer) return;
    treeContainer.querySelectorAll('.codx-tree-row.is-file').forEach((row) => {
      row.classList.toggle('is-selected', row.dataset.relPath === activeTreePath);
    });
    schedulePersistTreeState();
  }

  function renderFileTree(container, tree, onSelect, projectRoot = '') {
    if (!container) return;
    treeContainer = container;
    currentProjectRoot = String(projectRoot || '');
    container.replaceChildren();

    const savedSelected = loadSelectedPath(currentProjectRoot);
    expandedPathsSet = new Set(loadExpandedPaths(currentProjectRoot));
    if (savedSelected) {
      for (const dir of ancestorDirPaths(savedSelected)) {
        expandedPathsSet.add(dir);
      }
    }

    container.onclick = (e) => {
      const row = e.target.closest('.codx-tree-row.is-file');
      if (!row || !container.contains(row)) return;
      e.preventDefault();
      e.stopPropagation();
      hideFileContextMenu();
      const relPath = row.dataset.relPath;
      if (!relPath) return;
      setActivePath(relPath);
      onSelect?.(relPath);
    };

    const rootItems = buildRootItems(tree, projectRoot);
    if (!rootItems.length) {
      const empty = document.createElement('div');
      empty.className = 'codx-tree-empty';
      empty.textContent = '无文件';
      container.appendChild(empty);
      return;
    }
    renderGroup(container, rootItems, 0, onSelect);
    applyExpandedPaths(container);

    if (savedSelected) {
      setActivePath(savedSelected);
    }
  }

  function clearActivePath() {
    setActivePath('');
  }

  function getSavedSelectedPath(projectRoot) {
    return loadSelectedPath(projectRoot);
  }

  function revealPath(relPath, projectRoot) {
    const norm = String(relPath || '')
      .replace(/\\/g, '/')
      .replace(/^\.\//, '')
      .replace(/^\/+/, '');
    if (!norm) return;
    if (projectRoot) currentProjectRoot = projectRoot;
    for (const dir of ancestorDirPaths(norm)) {
      expandedPathsSet.add(dir);
    }
    schedulePersistTreeState();
    if (!treeContainer) return;
    applyExpandedPaths(treeContainer);
    setActivePath(norm);
    const row = treeContainer.querySelector(
      `.codx-tree-row[data-rel-path="${CSS.escape(norm)}"]`
    );
    row?.scrollIntoView({ block: 'nearest' });
  }

  window.CodXFileTree = {
    renderFileTree,
    setActivePath,
    clearActivePath,
    getSavedSelectedPath,
    revealPath,
  };
})();
