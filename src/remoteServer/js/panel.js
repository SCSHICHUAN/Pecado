/**
 * @file panel.js
 * 【功能】RemoteServer 渲染层：登录、文件树、Monaco/媒体预览、上传下载
 * 【入口】window.RemoteServerPanel.init() ← gitgraph showView('remote-server')
 * 【版本】PANEL_VERSION 与挂载 HTML 绑定；改 panel.html 须递增以免沿用旧 DOM
 */
(function () {
  /** 与 mount.dataset.loaded 对齐；改 html/panel.html 时 +1 */
  const PANEL_VERSION = '19';
  let currentDir = '/';
  let selectedPath = '';
  let selectedIsDir = false;
  let openFilePath = '';
  let dirty = false;
  let autoConnectTried = false;
  let modalResolver = null;
  let mediaMode = false;
  /** 已选待上传本地项（点「上传」才真正传） */
  let pendingUploadEntries = [];
  let expandedDirs = new Set();
  let uploadRunning = false;
  /** Monaco 实例；代码文件预览高亮；失败则回退 textarea */
  let codeEditor = null;
  let monacoRef = null;
  let editorUseFallback = false;
  let monacoLayoutBound = false;
  let editorLoading = false;

  /** 树/预览左右分割宽度（localStorage） */
  const RS_TREE_WIDTH_KEY = 'remoteServer.treeWidth';
  const RS_TREE_WIDTH_MIN = 200;
  const RS_PREVIEW_WIDTH_MIN = 280;
  const RS_TREE_WIDTH_MAX_RATIO = 0.68;

  const MEDIA_EXTS = new Set([
    '.png',
    '.jpg',
    '.jpeg',
    '.gif',
    '.webp',
    '.svg',
    '.ico',
    '.bmp',
    '.mp4',
    '.webm',
    '.mov',
    '.m4v',
    '.mp3',
    '.wav',
    '.m4a',
    '.aac',
    '.ogg',
    '.pdf',
  ]);

  function extOf(p) {
    const s = String(p || '');
    const i = s.lastIndexOf('.');
    return i >= 0 ? s.slice(i).toLowerCase() : '';
  }

  function isMediaPath(p) {
    return MEDIA_EXTS.has(extOf(p));
  }

  // —— Monaco / 编辑器表面 ——

  /** 扩展名 → Monaco language id；未知则 plaintext（用 textarea） */
  function guessLanguage(remotePath) {
    const map = {
      '.swift': 'swift',
      '.js': 'javascript',
      '.jsx': 'javascript',
      '.mjs': 'javascript',
      '.cjs': 'javascript',
      '.ts': 'typescript',
      '.tsx': 'typescript',
      '.json': 'json',
      '.jsonc': 'json',
      '.md': 'markdown',
      '.markdown': 'markdown',
      '.m': 'objective-c',
      '.mm': 'objective-c',
      '.h': 'objective-c',
      '.cpp': 'cpp',
      '.cc': 'cpp',
      '.cxx': 'cpp',
      '.c': 'c',
      '.hpp': 'cpp',
      '.html': 'html',
      '.htm': 'html',
      '.css': 'css',
      '.scss': 'scss',
      '.less': 'less',
      '.plist': 'xml',
      '.py': 'python',
      '.rb': 'ruby',
      '.go': 'go',
      '.rs': 'rust',
      '.yaml': 'yaml',
      '.yml': 'yaml',
      '.sh': 'shell',
      '.bash': 'shell',
      '.zsh': 'shell',
      '.fish': 'shell',
      '.xml': 'xml',
      '.sql': 'sql',
      '.java': 'java',
      '.kt': 'kotlin',
      '.kts': 'kotlin',
      '.php': 'php',
      '.lua': 'lua',
      '.vue': 'html',
      '.toml': 'ini',
      '.ini': 'ini',
      '.conf': 'ini',
      '.env': 'ini',
      '.dockerfile': 'dockerfile',
      '.makefile': 'makefile',
      '.mk': 'makefile',
      '.gradle': 'groovy',
      '.groovy': 'groovy',
      '.r': 'r',
      '.dart': 'dart',
      '.cs': 'csharp',
      '.vb': 'vb',
      '.scala': 'scala',
      '.clj': 'clojure',
      '.ex': 'elixir',
      '.exs': 'elixir',
      '.erl': 'erlang',
      '.hs': 'haskell',
      '.tf': 'hcl',
      '.proto': 'protobuf',
      '.graphql': 'graphql',
      '.gql': 'graphql',
    };
    const ext = extOf(remotePath);
    if (!ext && String(remotePath || '').toLowerCase().endsWith('dockerfile')) return 'dockerfile';
    if (!ext && String(remotePath || '').toLowerCase().endsWith('makefile')) return 'makefile';
    return map[ext] || 'plaintext';
  }

  function isCodePath(p) {
    return guessLanguage(p) !== 'plaintext';
  }

  function hideCodeEditorSurface() {
    $('rs-monaco-host')?.classList.add('hidden');
    const ta = $('rs-editor');
    if (ta) {
      ta.classList.add('hidden');
      ta.disabled = true;
    }
  }

  function showCodeEditorSurface(useMonaco) {
    const host = $('rs-monaco-host');
    const ta = $('rs-editor');
    if (useMonaco && codeEditor && !editorUseFallback) {
      host?.classList.remove('hidden');
      ta?.classList.add('hidden');
      return;
    }
    host?.classList.add('hidden');
    ta?.classList.remove('hidden');
  }

  function clearEditorContent() {
    if (codeEditor && monacoRef) {
      codeEditor.setValue('');
    }
    const ta = $('rs-editor');
    if (ta) {
      ta.value = '';
      ta.disabled = true;
    }
  }

  function getEditorContent() {
    if (codeEditor && !editorUseFallback) return codeEditor.getValue();
    return $('rs-editor')?.value ?? '';
  }

  async function ensureMonacoEditor() {
    if (editorUseFallback) return null;
    if (codeEditor && monacoRef) return codeEditor;
    const loader = window.CodXMonacoLoader;
    if (!loader?.loadMonaco) {
      editorUseFallback = true;
      return null;
    }
    const host = $('rs-monaco-host');
    if (!host) {
      editorUseFallback = true;
      return null;
    }
    try {
      const monaco = await loader.loadMonaco();
      monacoRef = monaco;
      window.CodXEditorThemes?.registerAll?.(monaco);
      window.CodXObjcMonarch?.register?.(monaco);
      const themeId = window.CodXEditorThemes?.apply?.(monaco) || 'vs-dark';
      codeEditor = monaco.editor.create(host, {
        value: '',
        language: 'plaintext',
        theme: themeId,
        automaticLayout: true,
        fontSize: 12.5,
        lineHeight: 20,
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace',
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        renderLineHighlight: 'line',
        wordWrap: 'off',
        padding: { top: 10, bottom: 10 },
        tabSize: 2,
        insertSpaces: true,
      });
      codeEditor.onDidChangeModelContent(() => {
        if (!openFilePath || mediaMode || editorLoading) return;
        dirty = true;
        const saveBtn = $('rs-save');
        if (saveBtn) saveBtn.disabled = false;
      });
      if (!monacoLayoutBound && window.ResizeObserver) {
        monacoLayoutBound = true;
        const wrap = $('rs-editor-wrap');
        if (wrap) {
          new ResizeObserver(() => {
            try {
              codeEditor?.layout?.();
            } catch (_) {}
          }).observe(wrap);
        }
      }
      return codeEditor;
    } catch (e) {
      console.error('[remote-server-ui] Monaco unavailable, fallback textarea', e);
      editorUseFallback = true;
      return null;
    }
  }

  async function setEditorContent(content, remotePath) {
    const lang = guessLanguage(remotePath);
    if (isCodePath(remotePath)) {
      const ed = await ensureMonacoEditor();
      if (ed && monacoRef) {
        showCodeEditorSurface(true);
        const ta = $('rs-editor');
        if (ta) {
          ta.disabled = true;
          ta.classList.add('hidden');
        }
        monacoRef.editor.setModelLanguage(ed.getModel(), lang);
        editorLoading = true;
        ed.setValue(content || '');
        editorLoading = false;
        ed.updateOptions({ readOnly: false });
        return;
      }
    }
    showCodeEditorSurface(false);
    const ta = $('rs-editor');
    if (ta) {
      ta.disabled = false;
      ta.value = content || '';
    }
  }

  function api() {
    return window.electronAPI;
  }

  function $(id, root) {
    if (!id) return null;
    // mount 是 Element，没有 getElementById；统一用 querySelector / document
    const scope = root && root.querySelector ? root : document;
    if (scope === document && typeof document.getElementById === 'function') {
      return document.getElementById(id);
    }
    try {
      return scope.querySelector('#' + CSS.escape(id));
    } catch (_) {
      return scope.querySelector('#' + String(id).replace(/"/g, '\\"'));
    }
  }

  function setMsg(el, text, kind) {
    if (!el) return;
    el.textContent = text || '';
    el.classList.toggle('is-error', kind === 'error');
    el.classList.toggle('is-ok', kind === 'ok');
  }

  function setConnectedUi(connected, meta) {
    const login = $('rs-login');
    const browser = $('rs-browser');
    const header = $('rs-header');
    const status = $('rs-status');
    const disc = $('rs-disconnect');
    if (login) login.classList.toggle('hidden', connected);
    if (browser) browser.classList.toggle('hidden', !connected);
    if (header) header.classList.toggle('rs-header--login', !connected);
    if (disc) disc.hidden = !connected;
    if (status) {
      if (connected) {
        status.textContent = `已连接 ${meta?.username || ''}@${meta?.host || ''}:${meta?.port || 22}`;
      } else {
        status.textContent = '未连接';
      }
    }
  }

  function setDownloadDirUi(dir) {
    const input = $('rs-download-dir');
    if (input) input.value = dir || '';
    if (input && dir) input.title = dir;
  }

  function setUploadPathUi(text) {
    const input = $('rs-upload-dir');
    const s = String(text || '');
    if (input) {
      input.value = s;
      input.title = s;
    }
  }

  function folderRootFromEntries(entries) {
    const first = (entries || []).find((e) => e?.relativePath);
    if (!first?.path) return '';
    const rel = String(first.relativePath).replace(/\\/g, '/');
    const parts = rel.split('/').filter(Boolean);
    if (!parts.length) return first.path;
    let p = String(first.path).replace(/\\/g, '/');
    for (let i = 0; i < parts.length - 1; i++) {
      const j = p.lastIndexOf('/');
      if (j <= 0) break;
      p = p.slice(0, j);
    }
    return p;
  }

  function formatUploadPathDisplay(entries) {
    const list = (entries || []).filter((e) => e?.path);
    if (!list.length) return '';
    if (list.length === 1) return list[0].path;
    if (list.every((e) => e.relativePath)) {
      const root = folderRootFromEntries(list);
      if (root) return root;
    }
    return list.map((e) => e.path).join(' · ');
  }

  function restoreUploadFromState(state) {
    const items = Array.isArray(state?.uploadItems)
      ? state.uploadItems
      : Array.isArray(state?.saved?.uploadItems)
        ? state.saved.uploadItems
        : [];
    pendingUploadEntries = items
      .map((ent) => ({
        path: String(ent?.path || '').trim(),
        relativePath: String(ent?.relativePath || '')
          .trim()
          .replace(/\\/g, '/'),
      }))
      .filter((ent) => ent.path);
    setUploadPathUi(formatUploadPathDisplay(pendingUploadEntries));
  }

  async function persistUploadPath(entries) {
    const list = (entries || []).filter((e) => e?.path);
    const a = api();
    if (!a?.remoteServerSetUploadPath) return;
    try {
      await a.remoteServerSetUploadPath({ uploadItems: list });
    } catch (e) {
      console.error('[remote-server-ui] save upload path', e);
    }
  }

  function stageUploadEntries(entries) {
    const list = (entries || []).filter((e) => e?.path);
    pendingUploadEntries = list;
    const display = formatUploadPathDisplay(list);
    setUploadPathUi(display);
    persistUploadPath(list);
    if (display) {
      setMsg($('rs-browser-msg'), '已选择上传路径，点击「上传」开始', 'ok');
    } else {
      setMsg($('rs-browser-msg'), '');
    }
  }

  function fillForm(saved) {
    if (!saved) return;
    if ($('rs-host')) $('rs-host').value = saved.host || '';
    if ($('rs-port')) $('rs-port').value = saved.port || 22;
    if ($('rs-user')) $('rs-user').value = saved.username || '';
    if ($('rs-pass')) $('rs-pass').value = saved.password || '';
    if (saved.lastPath) currentDir = saved.lastPath;
  }

  function readForm() {
    return {
      host: String($('rs-host')?.value || '').trim(),
      port: parseInt(String($('rs-port')?.value || '22'), 10) || 22,
      username: String($('rs-user')?.value || '').trim(),
      password: String($('rs-pass')?.value || ''),
    };
  }

  function normalizeRemotePath(p) {
    const s = String(p || '/').trim() || '/';
    const withSlash = s.startsWith('/') ? s : `/${s}`;
    if (withSlash !== '/' && withSlash.endsWith('/')) return withSlash.replace(/\/+$/, '');
    return withSlash;
  }

  function ancestorChain(targetPath) {
    const target = normalizeRemotePath(targetPath);
    if (target === '/') return ['/'];
    const parts = target.split('/').filter(Boolean);
    const chain = ['/'];
    let cur = '';
    for (const part of parts) {
      cur += `/${part}`;
      chain.push(cur);
    }
    return chain;
  }

  function rowDepth(row) {
    const pl = parseInt(row.style.paddingLeft, 10) || 10;
    return Math.max(0, Math.round((pl - 10) / 12));
  }

  function findTreeItemRow(itemPath) {
    const tree = $('rs-tree');
    if (!tree) return null;
    const p = normalizeRemotePath(itemPath);
    try {
      return tree.querySelector(`.rs-item[data-path="${CSS.escape(p)}"]`);
    } catch (_) {
      return tree.querySelector(`.rs-item[data-path="${p}"]`);
    }
  }

  function findTreeRow(dirPath) {
    const row = findTreeItemRow(dirPath);
    return row?.classList?.contains('is-dir') ? row : null;
  }

  // —— 文件树：展开 / 恢复 / 内联加载 ——

  async function expandTreeDir(dirPath) {
    const p = normalizeRemotePath(dirPath);
    const row = findTreeRow(p);
    if (!row) return false;
    const children = row.nextElementSibling;
    if (!children?.classList?.contains('rs-children')) return false;
    const twist = row.querySelector('.rs-twist');
    if (!children.hidden) {
      expandedDirs.add(p);
      return true;
    }
    children.hidden = false;
    if (twist) twist.textContent = '▾';
    await loadDirInto(children, p, rowDepth(row) + 1);
    expandedDirs.add(p);
    return true;
  }

  async function persistTreeState() {
    const a = api();
    if (!a?.remoteServerSaveTreeState) return;
    try {
      await a.remoteServerSaveTreeState({
        lastPath: currentDir,
        treeExpanded: [...expandedDirs],
        selectedPath,
        selectedIsDir,
      });
    } catch (e) {
      console.error('[remote-server-ui] save tree', e);
    }
  }

  async function restoreTreeView(targetPath, expandedList, selection) {
    const tree = $('rs-tree');
    if (!tree) return;
    const target = normalizeRemotePath(targetPath || '/');
    currentDir = target;
    if ($('rs-path')) $('rs-path').value = target;

    const selectPath = normalizeRemotePath(selection?.path || target);
    selectedIsDir = selection?.isDir !== undefined ? Boolean(selection.isDir) : true;

    expandedDirs = new Set((expandedList || []).map((p) => normalizeRemotePath(p)));
    const chain = ancestorChain(target);
    chain.forEach((p) => expandedDirs.add(p));
    if (selectPath !== target) {
      ancestorChain(selectPath).forEach((p) => expandedDirs.add(p));
    }

    try {
      tree.innerHTML = '';
      showTreeLoading(tree, 0);
      await loadDirInto(tree, '/', 0);

      const expandChain = ancestorChain(selectPath);
      for (let i = 0; i < expandChain.length; i++) {
        await expandTreeDir(expandChain[i]);
      }

      const extras = [...expandedDirs]
        .filter((p) => p !== '/' && !expandChain.includes(p))
        .sort((a, b) => a.length - b.length);
      for (const dir of extras) {
        await expandTreeDir(dir);
      }

      markSelected(selectPath);
      const activeRow = findTreeItemRow(selectPath);
      if (activeRow) {
        selectedIsDir = activeRow.dataset.isDir === '1';
        updateSelectionUi();
      }
      await persistTreeState();

      activeRow?.scrollIntoView?.({ block: 'nearest' });

      await previewSelection(selectPath, selectedIsDir);

      setMsg($('rs-browser-msg'), `已恢复 ${selectPath}`, 'ok');
    } catch (e) {
      setMsg($('rs-browser-msg'), e.message || String(e), 'error');
    }
  }

  function setUploadBtnState(running) {
    uploadRunning = running;
    const btn = $('rs-upload');
    if (!btn) return;
    btn.textContent = running ? '撤销' : '上传';
    btn.classList.toggle('rs-btn-danger', running);
  }

  function formatSize(n) {
    const x = Number(n) || 0;
    if (x < 1024) return `${x} B`;
    if (x < 1024 * 1024) return `${(x / 1024).toFixed(1)} KB`;
    return `${(x / 1024 / 1024).toFixed(1)} MB`;
  }

  function updateSelectionUi() {
    const delBtn = $('rs-delete');
    const dlBtn = $('rs-download');
    if (delBtn) delBtn.disabled = !selectedPath;
    if (dlBtn) dlBtn.disabled = !selectedPath || selectedIsDir;
  }

  function markSelected(path) {
    selectedPath = path ? normalizeRemotePath(path) : '';
    const tree = $('rs-tree');
    if (!tree) return;
    tree.querySelectorAll('.rs-item').forEach((el) => {
      const on = el.dataset.path === selectedPath;
      el.classList.toggle('is-selected', on);
      if (on) selectedIsDir = el.dataset.isDir === '1';
    });
    updateSelectionUi();
  }

  function showTreeLoading(container, depth) {
    if (!container) return;
    const pad = 10 + (Number(depth) || 0) * 12;
    container.innerHTML = '';
    const el = document.createElement('div');
    el.className = 'rs-tree-loading';
    el.style.paddingLeft = `${pad}px`;
    el.innerHTML =
      '<span class="rs-tree-spinner" aria-hidden="true"></span><span class="rs-tree-loading-text">加载中…</span>';
    container.appendChild(el);
  }

  function showTreeLoadError(container, depth, message) {
    if (!container) return;
    const pad = 10 + (Number(depth) || 0) * 12;
    container.innerHTML = '';
    const el = document.createElement('div');
    el.className = 'rs-tree-loading is-error';
    el.style.paddingLeft = `${pad}px`;
    el.textContent = message || '加载失败';
    container.appendChild(el);
  }

  async function loadDirInto(container, dirPath, depth) {
    const a = api();
    if (!a?.remoteServerListDir) return;
    showTreeLoading(container, depth);
    let res;
    try {
      res = await a.remoteServerListDir({ path: dirPath });
      if (!res?.ok) throw new Error(res?.error || '列目录失败');
    } catch (e) {
      showTreeLoadError(container, depth, e.message || String(e));
      throw e;
    }
    container.innerHTML = '';
    for (const item of res.items || []) {
      const row = document.createElement('div');
      row.className = `rs-item ${item.isDir ? 'is-dir' : 'is-file'}${
        !item.isDir && isMediaPath(item.path) ? ' is-media' : ''
      }`;
      row.dataset.path = item.path;
      row.dataset.isDir = item.isDir ? '1' : '0';
      row.style.paddingLeft = `${10 + depth * 12}px`;

      const twist = document.createElement('span');
      twist.className = 'rs-twist';
      twist.textContent = item.isDir ? '▸' : isMediaPath(item.path) ? '◉' : ' ';
      row.appendChild(twist);

      const name = document.createElement('span');
      name.className = 'rs-name';
      name.textContent = item.isDir ? `${item.name}/` : item.name;
      name.title = item.isDir
        ? item.path
        : `${item.path} · ${formatSize(item.size)}${isMediaPath(item.path) ? ' · 可预览' : ''}`;
      row.appendChild(name);

      const children = document.createElement('div');
      children.className = 'rs-children';
      children.hidden = true;

      row.addEventListener('click', async (e) => {
        e.stopPropagation();
        selectedIsDir = Boolean(item.isDir);
        markSelected(item.path);
        if (item.isDir) {
          const open = children.hidden;
          if (open) {
            twist.textContent = '▾';
            children.hidden = false;
            try {
              await loadDirInto(children, item.path, depth + 1);
              expandedDirs.add(item.path);
              persistTreeState();
            } catch (err) {
              children.hidden = true;
              twist.textContent = '▸';
              setMsg($('rs-browser-msg'), err.message || String(err), 'error');
            }
          } else {
            twist.textContent = '▸';
            children.hidden = true;
            children.innerHTML = '';
            expandedDirs.delete(item.path);
            persistTreeState();
          }
          currentDir = item.path;
          if ($('rs-path')) $('rs-path').value = currentDir;
          persistTreeState();
          await showFolderPreview(item.path);
        } else {
          await openFile(item.path);
          persistTreeState();
        }
      });

      container.appendChild(row);
      container.appendChild(children);
    }
  }

  async function refreshTree(dirPath) {
    const expanded = expandedDirs.size > 0 ? [...expandedDirs] : undefined;
    await restoreTreeView(dirPath || currentDir, expanded, {
      path: selectedPath || dirPath || currentDir,
      isDir: selectedIsDir,
    });
  }

  // —— 预览：文件夹统计 / 媒体 / 打开文件 ——

  function hideFolderPreview() {
    $('rs-folder-preview')?.classList.add('hidden');
  }

  function showFolderPreviewPane() {
    mediaMode = false;
    stopMedia();
    hideCodeEditorSurface();
    $('rs-media')?.classList.add('hidden');
    $('rs-folder-preview')?.classList.remove('hidden');
    if ($('rs-save')) $('rs-save').disabled = true;
    openFilePath = '';
    dirty = false;
  }

  async function showFolderPreview(dirPath) {
    const a = api();
    if (!a?.remoteServerListDir) return;
    const p = normalizeRemotePath(dirPath);
    showFolderPreviewPane();
    if ($('rs-editor-path')) $('rs-editor-path').textContent = p;
    const pathEl = $('rs-folder-preview-path');
    const statsEl = $('rs-folder-preview-stats');
    if (pathEl) pathEl.textContent = p;
    if (statsEl) statsEl.textContent = '统计中…';
    try {
      const res = await a.remoteServerListDir({ path: p });
      if (!res?.ok) throw new Error(res?.error || '读取目录失败');
      const items = res.items || [];
      const fileCount = items.filter((i) => !i.isDir).length;
      const dirCount = items.filter((i) => i.isDir).length;
      if (statsEl) statsEl.textContent = `${fileCount} 个文件，${dirCount} 个文件夹`;
    } catch (e) {
      if (statsEl) statsEl.textContent = e.message || String(e);
    }
  }

  async function previewSelection(itemPath, isDir) {
    if (!itemPath) return;
    if (isDir) {
      await showFolderPreview(itemPath);
    } else {
      await openFile(itemPath);
    }
  }

  function stopMedia() {
    const video = $('rs-media-video');
    const audio = $('rs-media-audio');
    if (video) {
      try {
        video.pause();
      } catch (_) {}
      video.removeAttribute('src');
      video.load?.();
    }
    if (audio) {
      try {
        audio.pause();
      } catch (_) {}
      audio.removeAttribute('src');
      audio.load?.();
    }
    const img = $('rs-media-img');
    if (img) img.removeAttribute('src');
    const pdf = $('rs-media-pdf');
    if (pdf) pdf.removeAttribute('src');
  }

  function showTextEditor() {
    mediaMode = false;
    stopMedia();
    hideFolderPreview();
    $('rs-media')?.classList.add('hidden');
    if (openFilePath && isCodePath(openFilePath) && codeEditor && !editorUseFallback) {
      showCodeEditorSurface(true);
    } else {
      showCodeEditorSurface(false);
      const ta = $('rs-editor');
      if (ta && openFilePath) ta.disabled = false;
    }
    if ($('rs-save')) $('rs-save').disabled = !openFilePath || !dirty;
  }

  function showMediaPane(kind, fileUrl, meta) {
    mediaMode = true;
    stopMedia();
    hideFolderPreview();
    hideCodeEditorSurface();
    const media = $('rs-media');
    const saveBtn = $('rs-save');
    if (saveBtn) saveBtn.disabled = true;
    if (!media) return;
    media.classList.remove('hidden');
    const img = $('rs-media-img');
    const video = $('rs-media-video');
    const audio = $('rs-media-audio');
    const pdf = $('rs-media-pdf');
    const hint = $('rs-media-hint');
    [img, video, audio, pdf].forEach((el) => el?.classList.add('hidden'));
    if (kind === 'image' && img) {
      img.classList.remove('hidden');
      img.src = fileUrl;
    } else if (kind === 'video' && video) {
      video.classList.remove('hidden');
      video.src = fileUrl;
    } else if (kind === 'audio' && audio) {
      audio.classList.remove('hidden');
      audio.src = fileUrl;
    } else if (kind === 'pdf' && pdf) {
      pdf.classList.remove('hidden');
      pdf.src = fileUrl;
    }
    if (hint) {
      const mode = meta?.mode === 'stream' ? '流式' : '本地';
      hint.textContent = `${meta?.title || ''} · ${formatSize(meta?.size || 0)} · ${meta?.mime || kind} · ${mode}`;
    }
  }

  async function openFile(remotePath) {
    const a = api();
    if (!a) return;
    if (dirty && openFilePath && openFilePath !== remotePath && !mediaMode) {
      const ok = window.confirm(`文件 ${openFilePath} 有未保存修改，丢弃并打开新文件？`);
      if (!ok) return;
    }

    if (isMediaPath(remotePath)) {
      if (!a.remoteServerPreviewMedia) {
        setMsg($('rs-browser-msg'), '预览 API 不可用，请重启应用', 'error');
        return;
      }
      setMsg($('rs-browser-msg'), '下载媒体预览中…');
      try {
        const res = await a.remoteServerPreviewMedia({ path: remotePath });
        if (!res?.ok) throw new Error(res?.error || '预览失败');
        openFilePath = res.path;
        dirty = false;
        if ($('rs-editor-path')) $('rs-editor-path').textContent = res.path;
        showMediaPane(res.kind, res.fileUrl, { ...res, mode: res.mode || 'stream' });
        const modeHint = res.mode === 'stream' ? '（流式播放，无需整文件下载）' : '';
        setMsg($('rs-browser-msg'), `正在预览 ${res.path}${modeHint}`, 'ok');
      } catch (e) {
        setMsg($('rs-browser-msg'), e.message || String(e), 'error');
      }
      return;
    }

    if (!a.remoteServerReadFile) return;
    setMsg($('rs-browser-msg'), '读取文件…');
    try {
      const res = await a.remoteServerReadFile({ path: remotePath });
      if (!res?.ok) throw new Error(res?.error || '读取失败');
      openFilePath = res.path;
      dirty = false;
      showTextEditor();
      await setEditorContent(res.content || '', res.path);
      if ($('rs-editor-path')) $('rs-editor-path').textContent = res.path;
      if ($('rs-save')) $('rs-save').disabled = true;
      setMsg($('rs-browser-msg'), `已打开 ${res.path}`, 'ok');
    } catch (e) {
      setMsg($('rs-browser-msg'), e.message || String(e), 'error');
    }
  }

  async function saveFile() {
    const a = api();
    if (!a?.remoteServerWriteFile || !openFilePath) return;
    const content = getEditorContent();
    setMsg($('rs-browser-msg'), '保存中…');
    try {
      const res = await a.remoteServerWriteFile({ path: openFilePath, content });
      if (!res?.ok) throw new Error(res?.error || '保存失败');
      dirty = false;
      if ($('rs-save')) $('rs-save').disabled = true;
      setMsg($('rs-browser-msg'), `已保存 ${openFilePath}`, 'ok');
    } catch (e) {
      setMsg($('rs-browser-msg'), e.message || String(e), 'error');
    }
  }

  function activeDir() {
    const typed = String($('rs-path')?.value || '').trim();
    if (typed) return typed.startsWith('/') ? typed : `/${typed}`;
    return currentDir || '/';
  }

  function askModal({ title, desc, placeholder, defaultValue, okText }) {
    return new Promise((resolve) => {
      const modal = $('rs-modal');
      const titleEl = $('rs-modal-title');
      const descEl = $('rs-modal-desc');
      const input = $('rs-modal-input');
      const okBtn = $('rs-modal-ok');
      if (!modal || !input) {
        resolve(null);
        return;
      }
      if (modalResolver) {
        modalResolver(null);
        modalResolver = null;
      }
      modalResolver = resolve;
      if (titleEl) titleEl.textContent = title || '确认';
      if (descEl) descEl.textContent = desc || '';
      if (okBtn) okBtn.textContent = okText || '确定';
      input.value = defaultValue != null ? String(defaultValue) : '';
      input.placeholder = placeholder || '';
      modal.classList.remove('hidden');
      modal.setAttribute('aria-hidden', 'false');
      setTimeout(() => {
        input.focus();
        input.select();
      }, 0);
    });
  }

  function closeModal(value) {
    const modal = $('rs-modal');
    if (modal) {
      modal.classList.add('hidden');
      modal.setAttribute('aria-hidden', 'true');
    }
    const resolve = modalResolver;
    modalResolver = null;
    if (resolve) resolve(value);
  }

  async function deleteSelected() {
    const a = api();
    if (!a?.remoteServerDelete || !selectedPath) return;
    const typed = await askModal({
      title: '删除确认',
      desc: `将删除：\n${selectedPath}\n\n请输入 del 继续`,
      placeholder: 'del',
      defaultValue: '',
      okText: '删除',
    });
    if (typed == null) return;
    if (String(typed).trim() !== 'del') {
      setMsg($('rs-browser-msg'), '已取消：未输入 del', 'error');
      return;
    }
    setMsg($('rs-browser-msg'), '删除中…');
    try {
      const res = await a.remoteServerDelete({ path: selectedPath, confirm: 'del' });
      if (!res?.ok) throw new Error(res?.error || '删除失败');
      if (openFilePath === selectedPath) {
        openFilePath = '';
        dirty = false;
        clearEditorContent();
        hideCodeEditorSurface();
        if ($('rs-editor-path')) $('rs-editor-path').textContent = '未打开文件';
        if ($('rs-save')) $('rs-save').disabled = true;
      }
      const parent = selectedPath.replace(/\/[^/]+\/?$/, '') || '/';
      await refreshTree(parent === selectedPath ? '/' : parent);
      setMsg($('rs-browser-msg'), '已删除', 'ok');
    } catch (e) {
      setMsg($('rs-browser-msg'), e.message || String(e), 'error');
    }
  }

  async function handleUploadResult(res, dir) {
    if (res?.cancelled) {
      if (res.ok && (res.uploaded || []).length) {
        const target = res.dir || dir;
        await refreshTree(target);
        setMsg($('rs-browser-msg'), res.warning || '上传已中断', 'error');
      } else {
        setMsg($('rs-browser-msg'), res.error || '上传已取消', 'error');
      }
      return;
    }
    if (!res?.ok) throw new Error(res?.error || '上传失败');
    if (res.cancelled) {
      setMsg($('rs-browser-msg'), '已取消上传');
      return;
    }
    const target = res.dir || dir;
    await refreshTree(target);
    const paths = (res.uploaded || []).join('，');
    const warn = res.warning ? `（部分失败：${res.warning}）` : '';
    const countHint =
      res.fileCount != null
        ? `共 ${res.fileCount} 个文件${res.dirCount ? `、${res.dirCount} 个空文件夹` : ''} · `
        : '';
    const detail = (res.details || [])
      .filter((d) => d.kind !== 'dir')
      .map((d) => `${d.realPath || d.path} (${d.size}B)`)
      .join('，');
    const summary = detail || paths || '(无)';
    const shortSummary = summary.length > 240 ? `${summary.slice(0, 240)}…` : summary;
    setMsg(
      $('rs-browser-msg'),
      `${countHint}已上传到 ${target}：${shortSummary}${warn}`,
      res.warning ? 'error' : 'ok'
    );
  }

  function parseFileUri(uri) {
    const line = String(uri || '')
      .split('\n')
      .map((s) => s.trim())
      .find((s) => s && !s.startsWith('#'));
    if (!line) return '';
    if (!line.startsWith('file://')) return '';
    try {
      const decoded = decodeURIComponent(line);
      let p = decoded.replace(/^file:\/\//, '');
      if (/^\/[A-Za-z]:/.test(p)) p = p.slice(1);
      return p;
    } catch (_) {
      return line.replace(/^file:\/\//, '');
    }
  }

  function collectDroppedEntries(e) {
    const entries = [];
    const seen = new Set();
    const add = (ent) => {
      const pathKey = ent.relativePath ? `${ent.path}::${ent.relativePath}` : ent.path;
      if (!ent.path || seen.has(pathKey)) return;
      seen.add(pathKey);
      entries.push(ent);
    };

    const a = api();
    const files = e.dataTransfer?.files;
    if (files?.length) {
      const items = [];
      for (let i = 0; i < files.length; i++) {
        const file = files[i];
        let p = '';
        if (a?.getPathForFile) {
          p = a.getPathForFile(file);
        }
        if (!p && file?.path) p = file.path;
        const relativePath = String(file.webkitRelativePath || '')
          .trim()
          .replace(/\\/g, '/');
        if (p) items.push({ path: p, relativePath });
      }

      const hasRelative = items.some((it) => it.relativePath);
      if (hasRelative) {
        items.forEach((it) => {
          if (it.relativePath) add({ path: it.path, relativePath: it.relativePath });
        });
        return entries;
      }

      items.forEach((it) => add({ path: it.path }));
      return entries;
    }

    if (e.dataTransfer) {
      const uri = e.dataTransfer.getData('text/uri-list') || e.dataTransfer.getData('text/plain');
      const fromUri = parseFileUri(uri);
      if (fromUri) add({ path: fromUri });
    }

    return entries;
  }

  // —— 上传：暂存 → 上传 / 撤销；拖拽到「上传路径」 ——

  function setUploadDropActive(active) {
    const wrap = $('rs-upload-drop');
    const bar = $('rs-upload-bar');
    if (wrap) wrap.classList.toggle('is-dragover', active);
    if (bar) bar.classList.toggle('is-dragover', active);
  }

  async function uploadLocalEntries(entries) {
    const a = api();
    if (!a?.remoteServerUpload) {
      setMsg($('rs-browser-msg'), '上传 API 不可用，请重启应用', 'error');
      return;
    }
    const list = (entries || []).filter((ent) => ent?.path);
    if (!list.length) {
      setMsg($('rs-browser-msg'), '没有可上传的内容', 'error');
      return;
    }
    const dir = activeDir();
    currentDir = dir;
    if ($('rs-path')) $('rs-path').value = dir;
    setMsg($('rs-browser-msg'), `正在上传到 ${dir} …`);
    setUploadBtnState(true);
    try {
      const hasRelative = list.some((ent) => ent.relativePath);
      const payload = hasRelative
        ? { dir, localEntries: list }
        : { dir, localPaths: list.map((ent) => ent.path) };
      const res = await a.remoteServerUpload(payload);
      await handleUploadResult(res, dir);
    } catch (e) {
      setMsg($('rs-browser-msg'), e.message || String(e), 'error');
    } finally {
      setUploadBtnState(false);
    }
  }

  async function uploadFiles() {
    const a = api();
    if (uploadRunning) {
      await a?.remoteServerCancelUpload?.();
      setMsg($('rs-browser-msg'), '正在取消上传…');
      return;
    }
    if (!pendingUploadEntries.length) {
      setMsg($('rs-browser-msg'), '请先拖拽或选择要上传的文件/文件夹', 'error');
      return;
    }
    await uploadLocalEntries(pendingUploadEntries);
  }

  function bindUploadPathDrop() {
    const bar = $('rs-upload-bar');
    const drop = $('rs-upload-drop');
    const targets = [bar, drop].filter(Boolean);
    let dragDepth = 0;
    let dropBusy = false;

    const onDragEnter = (e) => {
      e.preventDefault();
      e.stopPropagation();
      dragDepth += 1;
      setUploadDropActive(true);
    };
    const onDragOver = (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
      setUploadDropActive(true);
    };
    const onDragLeave = (e) => {
      e.preventDefault();
      e.stopPropagation();
      dragDepth = Math.max(0, dragDepth - 1);
      if (dragDepth === 0) setUploadDropActive(false);
    };
    const onDrop = async (e) => {
      e.preventDefault();
      e.stopPropagation();
      if (dropBusy) return;
      dropBusy = true;
      dragDepth = 0;
      setUploadDropActive(false);
      try {
        const entries = collectDroppedEntries(e);
        if (!entries.length) {
          setMsg($('rs-browser-msg'), '无法读取拖入内容，请重启应用后重试', 'error');
          return;
        }
        stageUploadEntries(entries);
      } finally {
        dropBusy = false;
      }
    };

    targets.forEach((el) => {
      el.addEventListener('dragenter', onDragEnter);
      el.addEventListener('dragover', onDragOver);
      el.addEventListener('dragleave', onDragLeave);
      el.addEventListener('drop', onDrop);
    });
  }

  async function pickUploadFiles() {
    const a = api();
    if (!a?.remoteServerPickUploadFiles) return;
    try {
      const res = await a.remoteServerPickUploadFiles();
      if (!res?.ok) throw new Error(res?.error || '选择文件失败');
      if (res.cancelled) return;
      const paths = (res.filePaths || []).map((p) => ({ path: p }));
      if (!paths.length) return;
      stageUploadEntries(paths);
    } catch (e) {
      setMsg($('rs-browser-msg'), e.message || String(e), 'error');
    }
  }

  async function pickDownloadDir() {
    const a = api();
    if (!a?.remoteServerPickDownloadDir) return;
    try {
      const res = await a.remoteServerPickDownloadDir();
      if (!res?.ok) throw new Error(res?.error || '选择目录失败');
      if (!res.cancelled && res.downloadDir) {
        setDownloadDirUi(res.downloadDir);
        setMsg($('rs-browser-msg'), `下载目录：${res.downloadDir}`, 'ok');
      }
    } catch (e) {
      setMsg($('rs-browser-msg'), e.message || String(e), 'error');
    }
  }

  async function downloadSelected() {
    const a = api();
    if (!a?.remoteServerDownload || !selectedPath) return;
    if (selectedIsDir) {
      setMsg($('rs-browser-msg'), '请选择文件，暂不支持下载文件夹', 'error');
      return;
    }
    setMsg($('rs-browser-msg'), '下载中…');
    const dlBtn = $('rs-download');
    if (dlBtn) dlBtn.disabled = true;
    try {
      const res = await a.remoteServerDownload({ path: selectedPath });
      if (!res?.ok) throw new Error(res?.error || '下载失败');
      setMsg(
        $('rs-browser-msg'),
        `已下载到 ${res.localPath}（${formatSize(res.size)}）`,
        'ok'
      );
    } catch (e) {
      setMsg($('rs-browser-msg'), e.message || String(e), 'error');
    } finally {
      updateSelectionUi();
    }
  }

  async function mkdir() {
    const a = api();
    if (!a?.remoteServerMkdir) return;
    const dir = activeDir();
    const name = await askModal({
      title: '新建文件夹',
      desc: `将在 ${dir} 下创建`,
      placeholder: '文件夹名',
      defaultValue: '',
      okText: '创建',
    });
    if (name == null) return;
    const n = String(name).trim();
    if (!n) {
      setMsg($('rs-browser-msg'), '文件夹名不能为空', 'error');
      return;
    }
    try {
      const res = await a.remoteServerMkdir({ dir, name: n });
      if (!res?.ok) throw new Error(res?.error || '创建失败');
      await refreshTree(dir);
      setMsg($('rs-browser-msg'), `已创建 ${res.path}`, 'ok');
    } catch (e) {
      setMsg($('rs-browser-msg'), e.message || String(e), 'error');
    }
  }

  function parentPath(p) {
    const s = String(p || '/');
    if (s === '/') return '/';
    const i = s.lastIndexOf('/');
    if (i <= 0) return '/';
    return s.slice(0, i) || '/';
  }

  async function connect(fromSaved) {
    const a = api();
    if (!a?.remoteServerConnect) {
      setMsg($('rs-login-msg'), 'RemoteServer API 不可用，请重启应用', 'error');
      return;
    }
    const form = readForm();
    if (!form.host || !form.username || !form.password) {
      setMsg($('rs-login-msg'), '请填写主机、用户名和密码', 'error');
      return;
    }
    const btn = $('rs-connect');
    if (btn) btn.disabled = true;
    setMsg($('rs-login-msg'), fromSaved ? '自动登录中…' : '登录中…');
    try {
      const res = await a.remoteServerConnect(form);
      if (!res?.ok) throw new Error(res?.error || '登录失败');
      setConnectedUi(true, res);
      setMsg($('rs-login-msg'), '登录成功，已保存配置', 'ok');
      const state = await a.remoteServerGetState();
      if (state?.downloadDir) setDownloadDirUi(state.downloadDir);
      restoreUploadFromState(state);
      const startPath = state?.lastPath || currentDir || '/';
      const expanded = state?.treeExpanded || state?.saved?.treeExpanded || [];
      await restoreTreeView(startPath, expanded, treeSelectionFromState(state));
    } catch (e) {
      setConnectedUi(false);
      setMsg($('rs-login-msg'), e.message || String(e), 'error');
    } finally {
      if (btn) btn.disabled = false;
    }
  }

  async function disconnect() {
    const a = api();
    try {
      await a?.remoteServerDisconnect?.();
    } catch (_) {}
    setConnectedUi(false);
    setMsg($('rs-login-msg'), '已断开');
  }

  function bindUi() {
    const mount = document.getElementById('panel-remote-server');
    if (!mount || mount.dataset.eventsBound === '1') return;
    const connectBtn = $('rs-connect');
    if (!connectBtn) {
      console.error('[remote-server-ui] rs-connect not found, panel html missing?');
      setMsg($('rs-login-msg'), '面板未加载完整，请切换页面后重试', 'error');
      return;
    }
    mount.dataset.eventsBound = '1';
    bindUploadPathDrop();
    connectBtn.addEventListener('click', () => connect(false));
    $('rs-disconnect')?.addEventListener('click', () => disconnect());
    $('rs-refresh')?.addEventListener('click', () => refreshTree($('rs-path')?.value || currentDir));
    $('rs-up')?.addEventListener('click', () => refreshTree(parentPath($('rs-path')?.value || currentDir)));
    $('rs-path')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') refreshTree($('rs-path').value || '/');
    });
    $('rs-upload')?.addEventListener('click', () => uploadFiles());
    $('rs-download')?.addEventListener('click', () => downloadSelected());
    $('rs-pick-download-dir')?.addEventListener('click', () => pickDownloadDir());
    $('rs-pick-upload-files')?.addEventListener('click', () => pickUploadFiles());
    $('rs-mkdir')?.addEventListener('click', () => mkdir());
    $('rs-delete')?.addEventListener('click', () => deleteSelected());
    $('rs-save')?.addEventListener('click', () => saveFile());
    $('rs-editor')?.addEventListener('input', () => {
      dirty = true;
      if ($('rs-save')) $('rs-save').disabled = !openFilePath;
    });
    ['rs-host', 'rs-port', 'rs-user', 'rs-pass'].forEach((id) => {
      $(id)?.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') connect(false);
      });
    });
    $('rs-modal-cancel')?.addEventListener('click', () => closeModal(null));
    $('rs-modal-ok')?.addEventListener('click', () => {
      closeModal($('rs-modal-input')?.value ?? '');
    });
    $('rs-modal-input')?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') closeModal($('rs-modal-input')?.value ?? '');
      if (e.key === 'Escape') closeModal(null);
    });
    $('rs-modal')?.addEventListener('click', (e) => {
      if (e.target === $('rs-modal')) closeModal(null);
    });
    setupSplitResizer();
  }

  /** 树与预览左右拖动；宽度写在 .rs-shell 的 --rs-tree-width */
  function setupSplitResizer() {
    const mount = document.getElementById('panel-remote-server');
    if (!mount || mount.dataset.splitResizerBound === '1') return;
    const handle = $('rs-split-resizer');
    const body = mount.querySelector('.rs-body');
    const treePanel = $('rs-tree-panel');
    const shell = mount.querySelector('.rs-shell');
    if (!handle || !body || !treePanel || !shell) return;
    mount.dataset.splitResizerBound = '1';

    function readTreeWidth() {
      try {
        const n = Number(localStorage.getItem(RS_TREE_WIDTH_KEY));
        if (Number.isFinite(n) && n >= RS_TREE_WIDTH_MIN) return n;
      } catch (_) {
        /* ignore */
      }
      return 320;
    }

    function clampTreeWidth(px) {
      const bodyW = body.clientWidth || mount.clientWidth || 0;
      const resizerW = handle.offsetWidth || 6;
      const maxByRatio = Math.floor(bodyW * RS_TREE_WIDTH_MAX_RATIO);
      const maxByRight = bodyW - resizerW - RS_PREVIEW_WIDTH_MIN;
      const maxW = Math.max(RS_TREE_WIDTH_MIN, Math.min(maxByRatio, maxByRight));
      return Math.min(maxW, Math.max(RS_TREE_WIDTH_MIN, px));
    }

    function applyTreeWidth(px) {
      const w = clampTreeWidth(px);
      shell.style.setProperty('--rs-tree-width', `${w}px`);
      try {
        localStorage.setItem(RS_TREE_WIDTH_KEY, String(Math.round(w)));
      } catch (_) {
        /* ignore */
      }
      try {
        codeEditor?.layout?.();
      } catch (_) {
        /* ignore */
      }
    }

    applyTreeWidth(readTreeWidth());

    let startX = 0;
    let startW = 0;

    const onMove = (e) => {
      applyTreeWidth(startW + (e.clientX - startX));
    };

    const onUp = () => {
      handle.classList.remove('is-dragging');
      document.body.classList.remove('rs-split-resizing');
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
      try {
        codeEditor?.layout?.();
      } catch (_) {
        /* ignore */
      }
    };

    handle.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      e.preventDefault();
      startX = e.clientX;
      startW = treePanel.getBoundingClientRect().width || readTreeWidth();
      handle.classList.add('is-dragging');
      document.body.classList.add('rs-split-resizing');
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    });

    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(() => {
        const current = treePanel.getBoundingClientRect().width || readTreeWidth();
        applyTreeWidth(current);
      });
      ro.observe(body);
    }
  }

  function treeSelectionFromState(state) {
    const path = state?.selectedPath || state?.saved?.selectedPath || state?.lastPath || '/';
    const isDir =
      state?.selectedIsDir != null
        ? Boolean(state.selectedIsDir)
        : state?.saved?.selectedIsDir !== false;
    return { path, isDir };
  }

  async function loadPanelHtml() {
    const mount = document.getElementById('panel-remote-server');
    if (!mount) return;
    if (mount.dataset.loaded === PANEL_VERSION && mount.querySelector('.rs-shell')) return;
    const a = api();
    if (!a?.remoteServerGetPanelHtml) throw new Error('RemoteServer API 不可用');
    const res = await a.remoteServerGetPanelHtml();
    if (!res?.ok) throw new Error(res?.error || '加载面板失败');
    mount.innerHTML = res.html;
    mount.dataset.loaded = PANEL_VERSION;
    mount.dataset.eventsBound = '';
    mount.dataset.splitResizerBound = '';
  }

  async function init() {
    const mount = document.getElementById('panel-remote-server');
    if (!mount) return;
    try {
      await loadPanelHtml();
      bindUi();
      const a = api();
      if (!a?.remoteServerGetState) {
        setMsg($('rs-login-msg'), 'RemoteServer API 不可用，请重启应用', 'error');
        return;
      }
      const state = await a.remoteServerGetState();
      if (!state?.ok) {
        setMsg($('rs-login-msg'), state?.error || '读取配置失败', 'error');
        return;
      }
      fillForm(state.saved);
      if (state.downloadDir) setDownloadDirUi(state.downloadDir);
      restoreUploadFromState(state);
      if (state.connected) {
        setConnectedUi(true, state);
        const startPath = state.lastPath || '/';
        const expanded = state.treeExpanded || state.saved?.treeExpanded || [];
        await restoreTreeView(startPath, expanded, treeSelectionFromState(state));
        return;
      }
      setConnectedUi(false);
      if (
        !autoConnectTried &&
        state.saved?.host &&
        state.saved?.username &&
        state.saved?.password
      ) {
        autoConnectTried = true;
        await connect(true);
      }
    } catch (e) {
      console.error('[remote-server-ui]', e);
      setMsg($('rs-login-msg'), e.message || String(e), 'error');
    }
  }

  window.RemoteServerPanel = {
    init: () => init().catch((e) => {
      console.error('[remote-server-ui]', e);
      try {
        setMsg(document.getElementById('rs-login-msg'), e.message || String(e), 'error');
      } catch (_) {}
    }),
  };
})();
