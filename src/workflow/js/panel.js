/**
 * @file panel.js
 * 【功能】Workflow 面板 UI（Skill · 文件服务 · 归类 · PPT · 定时任务）
 */
(function () {
  const PANEL_VERSION = '60';

  function getSkillView() {
    return $('wf-devdocs-skill-view');
  }

  function getSkillEdit() {
    return $('wf-devdocs-skill-edit');
  }

  /** @type {'view' | 'edit' | null} */
  let devDocSkillPanelMode = null;

  function setDevDocSkillPanelMode(mode) {
    const viewEl = getSkillView();
    const editEl = getSkillEdit();
    if (!viewEl || !editEl) return;
    if (mode !== 'view' && mode !== 'edit') return;
    devDocSkillPanelMode = mode;
    viewEl.hidden = mode !== 'view';
    editEl.hidden = mode !== 'edit';
  }

  /** @type {string} */
  let projectRoot = '';
  /** @type {object[]} */
  let schedules = [];
  /** @type {ReturnType<typeof setInterval> | null} */
  let downloadPollTimer = null;
  let downloadUserStopped = false;
  /** @type {{ changed: boolean, previousUrl: string } | null} */
  let downloadUrlChangedInfo = null;
  /** @type {string} */
  let downloadServiceDir = '';
  /** @type {object[]} */
  let devDocs = [];
  let devDocsListSelectMode = false;
  /** @type {Set<string>} */
  let devDocsSelectedIds = new Set();
  /** @type {string | null} */
  let activeDevDocId = null;
  let devDocEditing = false;
  /** @type {'url' | 'file' | 'manual' | null} */
  let devDocEditSource = null;
  /** @type {'markdown' | 'other' | null} */
  let devDocGenerateMode = null;
  /** 已保存 skill：编辑时隐藏来源/模式按钮，默认 markdown 路径 */
  let devDocSimpleEditMode = false;
  /** @type {ReturnType<typeof setTimeout> | null} */
  let devDocsStatusTimer = null;
  /** @type {{ manual: string, skill: string }} */
  let devDocEditDrafts = { manual: '', skill: '' };
  /** @type {{ sourceUrl: string, sourcePath: string }} */
  let devDocImportMeta = { sourceUrl: '', sourcePath: '' };
  /** @type {{ resourceFolderSource: string }} */
  let devDocResourceMeta = { resourceFolderSource: '' };
  /** @type {object | null} */
  let activeDevDoc = null;
  /** 添加 skill 尚未保存到服务端 */
  let devDocIsNewDraft = false;
  /** @type {object[]} */
  let uiImportItems = [];
  /** @type {ReturnType<typeof setTimeout> | null} */
  let uiImportStatusTimer = null;

  function $(id) {
    return document.getElementById(id);
  }

  function getApi() {
    return window.electronAPI;
  }

  function setLog(id, text) {
    const el = $(id);
    if (el) el.textContent = text || '';
  }

  function formatOrganizeResult(res, preview) {
    if (!res?.ok && res?.error) return res.error;
    const moves = res.moves || [];
    if (!moves.length) return preview ? '没有需要归类的顶层文件。' : '没有文件被移动。';
    const head = preview
      ? `预览：将移动 ${moves.length} 个文件\n`
      : `完成：已移动 ${res.moved || 0} 个文件\n`;
    const lines = moves.map((m) => `· ${m.fileName} → ${m.category}/`);
    const err = (res.errors || []).length ? `\n\n注意：\n${res.errors.join('\n')}` : '';
    return head + lines.join('\n') + err;
  }

  const WORKFLOW_TAB_KEY = 'workflow.lastTab';

  function getDefaultTab() {
    try {
      return localStorage.getItem(WORKFLOW_TAB_KEY) || 'skill';
    } catch {
      return 'skill';
    }
  }

  function switchTab(tabId) {
    document.querySelectorAll('.workflow-tab').forEach((btn) => {
      const active = btn.dataset.wfTab === tabId;
      btn.classList.toggle('is-active', active);
      btn.setAttribute('aria-selected', active ? 'true' : 'false');
    });
    document.querySelectorAll('.workflow-panel').forEach((panel) => {
      const active = panel.dataset.wfPanel === tabId;
      panel.classList.toggle('is-active', active);
      panel.hidden = !active;
    });
    if (tabId === 'download') {
      refreshDownloadServer()
        .then(() => maybeAutoStartDownloadServer())
        .catch(() => {});
      startDownloadPoll();
    } else {
      stopDownloadPoll();
    }
    if (tabId === 'skill') {
      refreshDevDocsList().catch(() => {});
    }
    if (tabId === 'ui-import') {
      refreshUiImportList().catch(() => {});
    }
    if (tabId === 'xcode') {
      refreshXcodeSimList().catch(() => {});
    }
    try { localStorage.setItem(WORKFLOW_TAB_KEY, tabId); } catch {}
  }

  function getDownloadDir() {
    const input = $('wf-dl-dir')?.value?.trim();
    return input || downloadServiceDir || '';
  }

  function syncDownloadDirInput(dir) {
    const value = String(dir || '').trim();
    if (value) downloadServiceDir = value;
    const input = $('wf-dl-dir');
    if (input) input.value = value || downloadServiceDir || '';
  }

  function formatBytes(n) {
    const num = Number(n);
    if (!Number.isFinite(num) || num < 0) return '—';
    if (num < 1024) return `${num} B`;
    if (num < 1024 * 1024) return `${(num / 1024).toFixed(1)} KB`;
    if (num < 1024 * 1024 * 1024) return `${(num / (1024 * 1024)).toFixed(1)} MB`;
    return `${(num / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }

  function formatLogTime(iso) {
    try {
      return new Date(iso).toLocaleString();
    } catch {
      return String(iso || '');
    }
  }

  function stopDownloadPoll() {
    if (downloadPollTimer) {
      clearInterval(downloadPollTimer);
      downloadPollTimer = null;
    }
  }

  function startDownloadPoll() {
    stopDownloadPoll();
    downloadPollTimer = setInterval(() => {
      refreshDownloadServer().catch(() => {});
    }, 2000);
  }

  async function refreshDownloadServer() {
    const res = await getApi()?.workflowGetDownloadServer?.();
    if (res?.ok) {
      renderDownloadServerUi({
        ...res,
        lastDownloadServiceUrl: res.lastDownloadServiceUrl || '',
        downloadServiceDir: res.downloadServiceDir || downloadServiceDir,
        urlChanged: downloadUrlChangedInfo?.changed,
        previousUrl: downloadUrlChangedInfo?.previousUrl,
      });
    }
  }

  async function copyServiceUrl(url, opts = {}) {
    const u = String(url || '').trim();
    if (!u) return false;
    try {
      await navigator.clipboard.writeText(u);
      if (opts.toast !== false) {
        const btn = $('wf-dl-copy');
        if (btn) {
          const prev = btn.textContent;
          btn.textContent = '已复制';
          setTimeout(() => {
            btn.textContent = prev;
          }, 1500);
        }
      }
      return true;
    } catch {
      return false;
    }
  }

  function renderThumbCacheUi(st) {
    const meta = $('wf-dl-cache-meta');
    const pathEl = $('wf-dl-cache-path');
    const count = st?.thumbCacheCount ?? 0;
    const bytes = st?.thumbCacheBytes ?? 0;
    if (meta) {
      meta.dataset.count = String(count);
      meta.textContent =
        count > 0 ? `${count} 张 · ${formatBytes(bytes)} · 下次浏览时重新生成` : '暂无缓存';
    }
    if (pathEl) {
      const dir = st?.thumbCacheDir || '';
      pathEl.textContent = dir || '—';
      pathEl.title = dir ? '在 Finder 中打开缓存目录' : '';
      pathEl.dataset.path = dir;
      pathEl.disabled = !dir;
    }
  }

  function setServiceControlButtons(running) {
    const startBtn = $('wf-dl-start');
    const stopBtn = $('wf-dl-stop');
    const openBtn = $('wf-dl-open');
    const copyBtn = $('wf-dl-copy');

    if (startBtn) {
      startBtn.disabled = running;
      startBtn.classList.toggle('is-active', !running);
      startBtn.classList.toggle('is-inactive', running);
    }
    if (stopBtn) {
      stopBtn.disabled = !running;
      stopBtn.classList.toggle('is-active', running);
      stopBtn.classList.toggle('is-inactive', !running);
    }
    if (openBtn) {
      openBtn.disabled = !running;
      openBtn.classList.toggle('is-inactive', !running);
    }
    if (copyBtn) {
      copyBtn.disabled = !running;
      copyBtn.classList.toggle('is-inactive', !running);
    }
  }

  function renderUrlChangeWarning(st) {
    const warnEl = $('wf-dl-url-warn');
    if (!warnEl) return;
    if (st.running && st.urlChanged && st.previousUrl) {
      warnEl.hidden = false;
      warnEl.textContent = `访问地址与上次不同（上次：${st.previousUrl}），请在手机上重新粘贴新地址。`;
      return;
    }
    warnEl.hidden = true;
    warnEl.textContent = '';
  }

  function renderDownloadServerUi(st) {
    const statusEl = $('wf-dl-status');
    const urlBox = $('wf-dl-url-box');
    const urlInput = $('wf-dl-url');
    const urlExtra = $('wf-dl-url-extra');
    const urlLabel = urlBox?.querySelector('.wf-url-label');

    if (st.running) {
      if (statusEl) {
        statusEl.textContent = `服务运行中 · ${st.fileCount || 0} 个文件 · 端口 ${st.port}`;
        statusEl.classList.add('is-running');
        statusEl.classList.remove('is-stopped');
      }
      if (urlBox) {
        urlBox.hidden = false;
        urlBox.classList.add('is-running');
        urlBox.classList.remove('is-stopped');
      }
      if (urlLabel) urlLabel.textContent = '手机访问地址';
      if (urlInput) urlInput.value = st.primaryUrl || st.localhostUrl || '';
      if (urlExtra) {
        const parts = [];
        if (st.localhostUrl && st.localhostUrl !== st.primaryUrl) parts.push(`本机 ${st.localhostUrl}`);
        const others = (st.urls || []).filter((u) => u !== st.primaryUrl);
        if (others.length) parts.push(`局域网 ${others.join(' · ')}`);
        urlExtra.textContent = parts.join('\n');
      }
      syncDownloadDirInput(st.rootDir || st.downloadServiceDir || downloadServiceDir);
    } else {
      if (statusEl) {
        statusEl.textContent = '服务已停止';
        statusEl.classList.remove('is-running');
        statusEl.classList.add('is-stopped');
      }
      const savedUrl = st.lastDownloadServiceUrl || '';
      if (urlBox) {
        urlBox.hidden = !savedUrl;
        urlBox.classList.remove('is-running');
        urlBox.classList.add('is-stopped');
      }
      if (urlLabel) urlLabel.textContent = savedUrl ? '上次服务地址（已停止）' : '手机访问地址';
      if (urlInput) urlInput.value = savedUrl;
      if (urlExtra) {
        urlExtra.textContent = savedUrl ? '服务未运行。重新开启后若地址变化，请更新手机上的粘贴地址。' : '';
      }
      syncDownloadDirInput(st.downloadServiceDir || downloadServiceDir);
      const fileList = $('wf-dl-file-list');
      if (fileList) fileList.innerHTML = '<li class="wf-schedule-empty">开启服务后显示</li>';
    }

    setServiceControlButtons(Boolean(st.running));
    renderUrlChangeWarning(st);
    renderDownloadLog(st.accessLog || []);
    renderThumbCacheUi(st);
    if (st.running) renderSharedFileList(st);
  }

  async function startDownloadService(folderPath) {
    const dir = String(folderPath || '').trim() || getDownloadDir();
    if (!dir) {
      window.alert('请先选择要共享的文件夹');
      return null;
    }
    const port = $('wf-dl-port')?.value;
    const res = await getApi()?.workflowDownloadServerStart?.({ folderPath: dir, port });
    if (!res?.ok) {
      window.alert(res?.error || '启动失败');
      return null;
    }
    if (res.downloadServiceDir) downloadServiceDir = res.downloadServiceDir;
    downloadUserStopped = false;
    if (res.urlChanged) {
      downloadUrlChangedInfo = { changed: true, previousUrl: res.previousUrl || '' };
    } else {
      downloadUrlChangedInfo = null;
    }
    renderDownloadServerUi({
      ...res,
      urlChanged: downloadUrlChangedInfo?.changed,
      previousUrl: downloadUrlChangedInfo?.previousUrl,
    });
    const url = res.primaryUrl || res.localhostUrl || '';
    if (url) await copyServiceUrl(url);
    if (res.urlChanged) {
      window.alert(`服务地址已变更，请在手机上重新粘贴新地址：\n${url}`);
    }
    return res;
  }

  async function maybeAutoStartDownloadServer() {
    if (downloadUserStopped) return;
    const st = await getApi()?.workflowGetDownloadServer?.();
    if (st?.running) {
      renderDownloadServerUi({
        ...st,
        lastDownloadServiceUrl: st.lastDownloadServiceUrl || '',
        downloadServiceDir: st.downloadServiceDir || downloadServiceDir,
        urlChanged: downloadUrlChangedInfo?.changed,
        previousUrl: downloadUrlChangedInfo?.previousUrl,
      });
      return;
    }
    const dir = getDownloadDir();
    if (!dir) return;
    await startDownloadService(dir);
  }

  function fileTypeFor(name, entry) {
    if (entry?.icon) return { icon: entry.icon, label: entry.label, kind: entry.kind };
    const ft = window.WorkflowFileType?.getFileTypeInfo?.(name);
    return ft || { icon: '📎', label: '文件', kind: 'file' };
  }

  function renderFileRow(name, metaHtml, typeInfo, thumbUrl) {
    const kind = typeInfo.kind || 'file';
    let iconHtml;
    if (thumbUrl && kind === 'video') {
      iconHtml = `<span class="wf-file-thumb-wrap" title="${escapeHtml(typeInfo.label)}">
        <img class="wf-file-thumb" src="${escapeHtml(thumbUrl)}" alt="" loading="lazy">
        <span class="wf-file-icon kind-video wf-file-thumb-fallback">${typeInfo.icon}</span>
      </span>`;
    } else {
      iconHtml = `<span class="wf-file-icon kind-${escapeHtml(kind)}" title="${escapeHtml(typeInfo.label)}">${typeInfo.icon}</span>`;
    }
    return `<li class="wf-download-log-item">
      ${iconHtml}
      <div class="wf-file-body">
        <div class="wf-download-log-name">${escapeHtml(name)}</div>
        ${metaHtml}
      </div>
    </li>`;
  }

  function renderSharedFileList(st) {
    const list = $('wf-dl-file-list');
    if (!list) return;
    const entries = st.entries || [...(st.dirs || []), ...(st.files || [])];
    if (!entries.length) {
      list.innerHTML = '<li class="wf-schedule-empty">此目录为空</li>';
      return;
    }
    list.innerHTML = entries
      .map((f) => {
        const isDir = f.type === 'dir' || f.kind === 'folder';
        const type = isDir
          ? { icon: '📁', label: '文件夹', kind: 'folder' }
          : fileTypeFor(f.name, f);
        const meta = isDir
          ? `<div class="wf-download-log-meta">${escapeHtml(type.label)} · 在手机浏览器中进入</div>`
          : `<div class="wf-download-log-meta">${escapeHtml(type.label)} · ${formatBytes(f.size)}${f.previewable ? ' · 可预览' : ''}</div>`;
        const name = f.rel || f.name;
        return renderFileRow(name, meta, type, f.thumbUrl);
      })
      .join('');
    list.querySelectorAll('.wf-file-thumb').forEach((img) => {
      img.addEventListener('error', () => {
        img.closest('.wf-file-thumb-wrap')?.classList.add('no-thumb');
      });
    });
  }

  function renderDownloadLog(log) {
    const list = $('wf-dl-log-list');
    if (!list) return;
    if (!log.length) {
      list.innerHTML = '<li class="wf-schedule-empty">暂无下载</li>';
      return;
    }
    list.innerHTML = log
      .map((entry) => {
        const type = fileTypeFor(entry.file || entry.relPath, entry);
        const meta = `<div class="wf-download-log-meta">${escapeHtml(formatLogTime(entry.time))} · ${escapeHtml(entry.ip || '—')} · ${formatBytes(entry.bytes)} · ${escapeHtml(type.label)}</div>`;
        return renderFileRow(entry.file || entry.relPath, meta, type);
      })
      .join('');
  }

  async function copyDownloadUrl() {
    const url = $('wf-dl-url')?.value?.trim();
    if (!url) return;
    const ok = await copyServiceUrl(url);
    if (!ok) window.prompt('复制此地址到手机浏览器：', url);
  }

  function updateProjectLabel() {
    const el = $('wf-project-label');
    if (!el) return;
    el.textContent = projectRoot ? projectRoot : '未打开工程（File → Open Folder）';
  }

  function getOrganizeDir() {
    const input = $('wf-organize-dir');
    const v = input?.value?.trim();
    return v || projectRoot || '';
  }

  async function refreshState() {
    const api = getApi();
    if (!api?.workflowGetState) return;
    const res = await api.workflowGetState();
    if (!res?.ok) return;
    projectRoot = res.projectRoot || '';
    schedules = res.schedules || [];
    downloadServiceDir = res.downloadServiceDir || '';
    updateProjectLabel();
    syncDownloadDirInput(downloadServiceDir);
    renderScheduleList();
    if (res.downloadServer) {
      renderDownloadServerUi({
        ...res.downloadServer,
        lastDownloadServiceUrl: res.lastDownloadServiceUrl || res.downloadServer.lastDownloadServiceUrl || '',
        downloadServiceDir: res.downloadServiceDir || downloadServiceDir,
      });
    }
    if (Array.isArray(res.devDocs)) {
      devDocs = res.devDocs;
      renderDevDocsList();
    }
    refreshUiImportList().catch(() => {});
  }

  function setUiImportStatus(text, kind) {
    const el = $('wf-ui-import-status');
    if (!el) return;
    if (uiImportStatusTimer) {
      clearTimeout(uiImportStatusTimer);
      uiImportStatusTimer = null;
    }
    const msg = String(text ?? '').trim();
    if (!msg) {
      el.hidden = true;
      el.textContent = '';
      el.className = 'wf-ui-import-status';
      return;
    }
    let tone = kind;
    if (!tone) {
      if (/失败|错误|无法|请先/.test(msg)) tone = 'error';
      else if (/已导入|成功|已打开/.test(msg)) tone = 'success';
      else tone = 'info';
    }
    el.hidden = false;
    el.textContent = msg;
    el.className = `wf-ui-import-status is-${tone}`;
    uiImportStatusTimer = setTimeout(() => {
      uiImportStatusTimer = null;
      setUiImportStatus('');
    }, 3500);
  }

  async function refreshUiImportList() {
    const list = $('wf-ui-import-list');
    if (!list) return;
    if (!projectRoot) {
      uiImportItems = [];
      list.innerHTML = '<li class="wf-skill-empty">请先 File → Open Folder 打开工程</li>';
      return;
    }
    const res = await getApi()?.workflowListUiDesigns?.({ projectRoot, includePreview: true });
    if (!res?.ok) {
      uiImportItems = [];
      list.innerHTML = `<li class="wf-skill-empty">${escapeHtml(res?.error || '无法读取设计稿列表')}</li>`;
      return;
    }
    uiImportItems = Array.isArray(res.items) ? res.items : [];
    renderUiImportList();
  }

  function renderUiImportList() {
    const list = $('wf-ui-import-list');
    if (!list) return;
    if (!uiImportItems.length) {
      list.innerHTML = '<li class="wf-skill-empty">暂无设计稿，点上方「添加 UI 文件」导入</li>';
      return;
    }
    list.innerHTML = uiImportItems
      .map((item) => {
        const kind = item.hasFramelink ? 'Framelink' : '文件夹';
        const jsonHint = item.jsonName ? ` · ${item.jsonName}` : '';
        const time = formatLogTime(item.mtime);
        const thumbHtml = item.previewBase64
          ? `<img class="wf-ui-import-thumb" src="data:image/png;base64,${escapeHtml(item.previewBase64)}" alt="">`
          : '';
        return `<li class="wf-skill-item wf-ui-import-item" data-rel-path="${escapeHtml(item.relPath)}" title="在 Finder 中打开">
          ${thumbHtml}
          <div class="wf-skill-item-main">
            <span class="wf-skill-item-title">${escapeHtml(item.name)}</span>
            <span class="wf-skill-item-meta">${escapeHtml(kind)}${escapeHtml(jsonHint)} · ${escapeHtml(time)}</span>
          </div>
        </li>`;
      })
      .join('');

    list.querySelectorAll('.wf-ui-import-item').forEach((row) => {
      row.addEventListener('click', () => {
        openUiDesignImport(row.dataset.relPath).catch((e) => setUiImportStatus(String(e), 'error'));
      });
    });
  }

  async function openUiDesignImport(relPath) {
    if (!projectRoot) {
      setUiImportStatus('请先 File → Open Folder 打开工程', 'error');
      return;
    }
    const res = await getApi()?.workflowOpenUiDesign?.({ projectRoot, relPath });
    if (!res?.ok) {
      setUiImportStatus(res?.error || '无法打开文件夹', 'error');
      return;
    }
  }

  function renderScheduleList() {
    const list = $('wf-schedule-list');
    if (!list) return;
    if (!schedules.length) {
      list.innerHTML = '<li class="wf-schedule-empty">暂无定时任务</li>';
      return;
    }
    list.innerHTML = schedules
      .map((s) => {
        const trigger =
          s.triggerType === 'daily'
            ? `每天 ${s.dailyTime || '09:00'}`
            : `每 ${s.intervalMinutes || 60} 分钟`;
        const target = s.appName || s.appPath || '（未指定应用）';
        return `<li class="wf-schedule-item" data-id="${s.id}">
          <div class="wf-schedule-item-main">
            <div>${escapeHtml(s.name || '未命名')}</div>
            <div class="wf-schedule-item-meta">${escapeHtml(trigger)} · ${escapeHtml(target)}</div>
          </div>
          <div class="wf-schedule-item-actions">
            <button type="button" data-action="run" data-id="${s.id}">运行</button>
            <button type="button" data-action="delete" data-id="${s.id}">删除</button>
          </div>
        </li>`;
      })
      .join('');

    list.querySelectorAll('button[data-action="run"]').forEach((btn) => {
      btn.addEventListener('click', () => {
        const sch = schedules.find((x) => x.id === btn.dataset.id);
        if (sch) runScheduleNow(sch);
      });
    });
    list.querySelectorAll('button[data-action="delete"]').forEach((btn) => {
      btn.addEventListener('click', () => deleteScheduleById(btn.dataset.id));
    });
  }

  function escapeHtml(s) {
    return String(s || '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  function pathLabelSame(node) {
    const path = String(node?.path || '').trim();
    const label = String(node?.label || node?.title || '').trim();
    if (!path || !label) return true;
    if (path === label) return true;
    if (!path.includes('/') && path.toLowerCase() === label.toLowerCase()) return true;
    return false;
  }

  function devDocSourceLabel(doc) {
    if (doc.sourceType === 'url' && doc.sourceUrl) return doc.sourceUrl;
    if (doc.sourceType === 'file' && doc.sourcePath) return doc.sourcePath;
    return '手动创建';
  }

  function setDevDocsStatus(text, kind) {
    const targets = [$('wf-devdocs-status'), $('wf-devdocs-list-status')].filter(Boolean);
    if (!targets.length) return;
    if (devDocsStatusTimer) {
      clearTimeout(devDocsStatusTimer);
      devDocsStatusTimer = null;
    }
    const msg = String(text ?? '').trim();
    if (!msg) {
      for (const el of targets) {
        el.hidden = true;
        el.textContent = '';
        el.className = el.id === 'wf-devdocs-list-status'
          ? 'wf-devdocs-list-status'
          : 'wf-devdocs-status';
      }
      return;
    }
    let tone = kind;
    if (!tone) {
      if (/失败|错误|无法|请填写|不能为空|请先选择|请先 File/.test(msg)) tone = 'error';
      else if (/已生成|已保存|已删除|成功|已导入/.test(msg)) tone = 'success';
      else tone = 'info';
    }
    for (const el of targets) {
      el.hidden = false;
      el.textContent = msg;
      el.className = `${
        el.id === 'wf-devdocs-list-status' ? 'wf-devdocs-list-status' : 'wf-devdocs-status'
      } is-${tone}`;
    }
    devDocsStatusTimer = setTimeout(() => {
      devDocsStatusTimer = null;
      setDevDocsStatus('');
    }, 3500);
  }

  function showDevDocsListView() {
    activeDevDocId = null;
    activeDevDoc = null;
    devDocEditing = false;
    devDocIsNewDraft = false;
    devDocEditSnapshot = null;
    const listView = $('wf-devdocs-list-view');
    const detailView = $('wf-devdocs-detail-view');
    if (listView) listView.hidden = false;
    if (detailView) detailView.hidden = true;
  }

  function showDevDocsDetailView() {
    const listView = $('wf-devdocs-list-view');
    const detailView = $('wf-devdocs-detail-view');
    if (listView) listView.hidden = true;
    if (detailView) detailView.hidden = false;
  }

  function isDevDocResourcesPinned(doc) {
    return normalizeDevDocContextMode(doc) === 'full';
  }

  function normalizeDevDocContextMode(doc) {
    const m = doc?.aiContextMode;
    if (m === 'full') return 'full';
    return 'skill';
  }

  function devDocDetailViewControlsHtml(doc) {
    const mode = isDevDocResourcesPinned(doc) ? 'full' : 'skill';
    return `<div class="wf-devdoc-controls-inner" data-id="${escapeHtml(doc.id)}">
      <div class="wf-devdoc-mode-switch" role="group" aria-label="显示模式">
        <button type="button" class="wf-devdoc-mode-btn${mode === 'skill' ? ' is-active' : ''}" data-mode="skill">skill</button>
        <button type="button" class="wf-devdoc-mode-btn${mode === 'full' ? ' is-active' : ''}" data-mode="full">原文</button>
      </div>
    </div>`;
  }

  function syncDevDocDetailViewControls(container, doc) {
    if (!container || !doc) return;
    const mode = isDevDocResourcesPinned(doc) ? 'full' : 'skill';
    container.querySelectorAll('.wf-devdoc-mode-btn').forEach((btn) => {
      btn.classList.toggle('is-active', btn.dataset.mode === mode);
    });
  }

  function bindDevDocDetailViewControls(container, doc) {
    if (!container || !doc) return;
    container.querySelectorAll('.wf-devdoc-mode-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        const nextFull = btn.dataset.mode === 'full';
        if (nextFull === isDevDocResourcesPinned(doc)) return;
        setDevDocPinResources(doc.id, nextFull).catch(() => {});
      });
    });
  }

  function devDocControlsHtml(doc, opts = {}) {
    const showEnable = opts.showEnable !== false;
    const showDelete = opts.showDelete === true;
    const enabled = doc.aiEnabled === true;
    const mode = isDevDocResourcesPinned(doc) ? 'full' : 'skill';
    const switchDisabled = enabled ? '' : ' is-disabled';
    const deleteHtml = showDelete
      ? `<button type="button" class="wf-btn wf-btn-sm wf-devdoc-delete-btn" data-id="${escapeHtml(doc.id)}" title="删除 skill" aria-label="删除 skill">删除</button>`
      : '';
    const enableHtml = showEnable
      ? `<label class="wf-devdoc-check wf-devdoc-enable-check" title="不勾选则不使用此 skill">
        <input type="checkbox" class="wf-devdoc-enable-switch" data-id="${escapeHtml(doc.id)}" ${enabled ? 'checked' : ''}>
      </label>`
      : '';
    return `<div class="wf-devdoc-controls-inner" data-id="${escapeHtml(doc.id)}">
      ${deleteHtml}<div class="wf-devdoc-mode-switch${switchDisabled}" role="group" aria-label="注入模式">
        <button type="button" class="wf-devdoc-mode-btn${mode === 'skill' ? ' is-active' : ''}" data-mode="skill">skill</button>
        <button type="button" class="wf-devdoc-mode-btn${mode === 'full' ? ' is-active' : ''}" data-mode="full">原文</button>
      </div>${enableHtml}
    </div>`;
  }

  function syncDevDocControls(container, doc) {
    if (!container || !doc) return;
    const enabled = doc.aiEnabled === true;
    const mode = isDevDocResourcesPinned(doc) ? 'full' : 'skill';
    const enableInput = container.querySelector('.wf-devdoc-enable-switch');
    const modeSwitch = container.querySelector('.wf-devdoc-mode-switch');
    if (enableInput) enableInput.checked = enabled;
    if (modeSwitch) {
      modeSwitch.classList.toggle('is-disabled', !enabled);
      modeSwitch.querySelectorAll('.wf-devdoc-mode-btn').forEach((btn) => {
        btn.classList.toggle('is-active', btn.dataset.mode === mode);
      });
    }
  }

  function bindDevDocControls(container, doc) {
    if (!container || !doc) return;
    const deleteBtn = container.querySelector('.wf-devdoc-delete-btn');
    deleteBtn?.addEventListener('click', (e) => {
      e.stopPropagation();
      deleteDevDocById(doc.id).catch(() => {});
    });
    const enableInput = container.querySelector('.wf-devdoc-enable-switch');
    enableInput?.addEventListener('change', (e) => {
      e.stopPropagation();
      toggleDevDocAi(doc.id, enableInput.checked).catch(() => {});
    });
    container.querySelectorAll('.wf-devdoc-mode-btn').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (doc.aiEnabled !== true) return;
        const nextFull = btn.dataset.mode === 'full';
        if (nextFull === isDevDocResourcesPinned(doc)) return;
        setDevDocPinResources(doc.id, nextFull).catch(() => {});
      });
    });
  }

  function syncDevDocsListSelectToolbar() {
    const editBtn = $('wf-devdocs-list-edit');
    const toggleBtn = $('wf-devdocs-list-toggle-all');
    const deleteBtn = $('wf-devdocs-list-delete');
    const listWrap = document.querySelector('.wf-skill-list-wrap');

    if (editBtn) editBtn.textContent = devDocsListSelectMode ? '完成' : '编辑';
    if (toggleBtn) toggleBtn.hidden = !devDocsListSelectMode || !devDocs.length;
    if (deleteBtn) deleteBtn.hidden = !devDocsListSelectMode;
    if (listWrap) listWrap.classList.toggle('is-select-mode', devDocsListSelectMode);

    if (toggleBtn && devDocsListSelectMode && devDocs.length) {
      const allSelected =
        devDocs.length > 0 && devDocs.every((d) => devDocsSelectedIds.has(d.id));
      toggleBtn.textContent = allSelected ? '取消全选' : '全选';
    }
  }

  function setDevDocsListSelectMode(on) {
    devDocsListSelectMode = Boolean(on);
    if (!devDocsListSelectMode) devDocsSelectedIds.clear();
    syncDevDocsListSelectToolbar();
    renderDevDocsList();
  }

  function toggleDevDocsListSelectAll() {
    if (!devDocs.length) return;
    const allSelected = devDocs.every((d) => devDocsSelectedIds.has(d.id));
    if (allSelected) {
      devDocsSelectedIds.clear();
    } else {
      devDocsSelectedIds = new Set(devDocs.map((d) => d.id));
    }
    syncDevDocsListSelectToolbar();
    renderDevDocsList();
  }

  function toggleDevDocListSelection(id, selected) {
    if (!id) return;
    if (selected) devDocsSelectedIds.add(id);
    else devDocsSelectedIds.delete(id);
    syncDevDocsListSelectToolbar();
  }

  function confirmDeleteAllDevDocs(total) {
    return new Promise((resolve) => {
      const overlay = $('wf-devdocs-delete-all-confirm');
      const msgEl = $('wf-devdocs-delete-all-msg');
      const inputEl = $('wf-devdocs-delete-all-input');
      const cancelBtn = $('wf-devdocs-delete-all-cancel');
      const okBtn = $('wf-devdocs-delete-all-ok');
      if (!overlay || !msgEl || !inputEl || !cancelBtn || !okBtn) {
        resolve(false);
        return;
      }

      msgEl.textContent = `即将删除全部 ${total} 个 skill，请输入 skills 确认删除：`;
      inputEl.value = '';
      overlay.hidden = false;
      inputEl.focus();

      const finish = (result) => {
        overlay.hidden = true;
        cancelBtn.removeEventListener('click', onCancel);
        okBtn.removeEventListener('click', onOk);
        inputEl.removeEventListener('keydown', onKeydown);
        resolve(result);
      };

      const onCancel = () => finish(false);
      const onOk = () => {
        if (inputEl.value.trim() === 'skills') finish(true);
        else window.alert('请输入 skills 确认');
      };
      const onKeydown = (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          onOk();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          onCancel();
        }
      };

      cancelBtn.addEventListener('click', onCancel);
      okBtn.addEventListener('click', onOk);
      inputEl.addEventListener('keydown', onKeydown);
    });
  }

  async function deleteSelectedDevDocs() {
    const ids = [...devDocsSelectedIds];
    if (!ids.length) {
      window.alert('请先选择要删除的 skill');
      return;
    }
    const total = devDocs.length;
    const n = ids.length;
    if (n >= total && total > 0) {
      if (!(await confirmDeleteAllDevDocs(total))) return;
    } else if (!window.confirm(`是否要删除 ${n} 个 skill？`)) {
      return;
    }

    const res = await getApi()?.workflowDevDocsDelete?.({ ids });
    if (!res?.ok) {
      window.alert(res?.error || '删除失败');
      return;
    }
    devDocs = res.docs || [];
    if (activeDevDocId && ids.includes(activeDevDocId)) {
      activeDevDocId = null;
      activeDevDoc = null;
      showDevDocsListView();
    }
    setDevDocsListSelectMode(false);
    renderDevDocsList();
    setDevDocsStatus(`已删除 ${res.deleted ?? n} 个 skill`);
  }

  function renderDevDocsList() {
    const list = $('wf-devdocs-list');
    if (!list) return;
    syncDevDocsListSelectToolbar();
    if (!devDocs.length) {
      list.innerHTML = '<li class="wf-skill-empty">NO Skills</li>';
      return;
    }
    list.innerHTML = devDocs
      .map((doc) => {
        const meta = devDocSourceLabel(doc);
        const kind =
          doc.sourceType === 'url' ? '链接' : doc.sourceType === 'file' ? '文件' : '手动';
        const checked = devDocsSelectedIds.has(doc.id) ? ' checked' : '';
        const selectHtml = devDocsListSelectMode
          ? `<label class="wf-devdoc-check wf-skill-item-select" title="选择">
              <input type="checkbox" class="wf-skill-select-cb" data-id="${escapeHtml(doc.id)}"${checked}>
            </label>`
          : '';
        return `<li class="wf-skill-item${devDocsListSelectMode ? ' is-selecting' : ''}" data-id="${escapeHtml(doc.id)}">
          ${selectHtml}
          <div class="wf-skill-item-main">
            <span class="wf-skill-item-title">${escapeHtml(doc.title || '未命名')}</span>
            <span class="wf-skill-item-meta">${escapeHtml(kind)} · ${escapeHtml(meta)}</span>
          </div>
          <div class="wf-devdoc-controls wf-skill-item-controls">${devDocControlsHtml(doc, { showDelete: !devDocsListSelectMode })}</div>
        </li>`;
      })
      .join('');

    list.querySelectorAll('.wf-skill-item-controls').forEach((ctrl) => {
      const id = ctrl.querySelector('.wf-devdoc-controls-inner')?.dataset.id;
      const doc = devDocs.find((d) => d.id === id);
      if (doc) bindDevDocControls(ctrl, doc);
    });

    list.querySelectorAll('.wf-skill-select-cb').forEach((cb) => {
      cb.addEventListener('click', (e) => e.stopPropagation());
      cb.addEventListener('change', (e) => {
        e.stopPropagation();
        toggleDevDocListSelection(cb.dataset.id, cb.checked);
      });
    });

    list.querySelectorAll('.wf-skill-item').forEach((item) => {
      const id = item.dataset.id;
      item.addEventListener('click', (e) => {
        if (e.target.closest('.wf-devdoc-controls') || e.target.closest('.wf-skill-item-select')) {
          return;
        }
        if (devDocsListSelectMode) {
          const cb = item.querySelector('.wf-skill-select-cb');
          if (cb) {
            cb.checked = !cb.checked;
            toggleDevDocListSelection(id, cb.checked);
          }
          return;
        }
        openDevDoc(id);
      });
    });
  }

  async function refreshDevDocsList() {
    const res = await getApi()?.workflowDevDocsList?.();
    if (res?.ok) {
      devDocs = res.docs || [];
      renderDevDocsList();
    }
  }

  async function setDevDocPinResources(id, pinned) {
    const next = pinned ? 'full' : 'skill';
    const res = await getApi()?.workflowDevDocsUpdate?.({
      id,
      aiContextMode: next,
    });
    if (!res?.ok) {
      window.alert(res?.error || '更新失败');
      await refreshDevDocsList();
      return;
    }
    const idx = devDocs.findIndex((d) => d.id === id);
    if (idx >= 0) devDocs[idx] = { ...devDocs[idx], aiContextMode: next };
    if (activeDevDocId === id && activeDevDoc) {
      activeDevDoc.aiContextMode = next;
      if (!devDocEditing) {
        renderDevDocSkillView(activeDevDoc);
      }
    }
    renderDevDocsList();
  }

  async function toggleDevDocAi(id, aiEnabled) {
    const res = await getApi()?.workflowDevDocsUpdate?.({ id, aiEnabled });
    if (!res?.ok) {
      window.alert(res?.error || '更新失败');
      await refreshDevDocsList();
      return;
    }
    const idx = devDocs.findIndex((d) => d.id === id);
    if (idx >= 0) devDocs[idx] = { ...devDocs[idx], aiEnabled };
    if (activeDevDocId === id && activeDevDoc) {
      activeDevDoc.aiEnabled = aiEnabled;
      syncDevDocControls($('wf-devdocs-detail-controls'), activeDevDoc);
    }
    renderDevDocsList();
  }

  function isDevDocHttpSource(text) {
    return /^https?:\/\//i.test(String(text || '').trim());
  }

  function syncDevDocImportMetaFromBar() {
    const source = $('wf-devdocs-detail-url')?.value?.trim() || '';
    if (!source) {
      devDocImportMeta.sourceUrl = '';
      devDocImportMeta.sourcePath = '';
      return;
    }
    if (isDevDocHttpSource(source)) {
      devDocImportMeta.sourceUrl = source;
      devDocImportMeta.sourcePath = '';
    } else {
      devDocImportMeta.sourceUrl = '';
      devDocImportMeta.sourcePath = source;
    }
  }

  function resetDevDocImportMeta(doc) {
    devDocImportMeta = {
      sourceUrl: doc?.sourceType === 'url' ? String(doc.sourceUrl || '').trim() : '',
      sourcePath: doc?.sourceType === 'file' ? String(doc.sourcePath || '').trim() : '',
    };
    const urlInput = $('wf-devdocs-detail-url');
    if (urlInput) urlInput.value = devDocImportMeta.sourceUrl || devDocImportMeta.sourcePath || '';
  }

  function resetDevDocResourceMeta(doc) {
    devDocResourceMeta = {
      resourceFolderSource: String(doc?.resourceFolderSource || '').trim(),
    };
    const input = $('wf-devdocs-detail-resource-folder');
    if (input) input.value = devDocResourceMeta.resourceFolderSource;
  }

  function getDevDocResourceFolderPath() {
    return (
      $('wf-devdocs-detail-resource-folder')?.value?.trim() ||
      devDocResourceMeta.resourceFolderSource ||
      ''
    );
  }

  function resetDevDocEditSession() {
    devDocEditSource = null;
    devDocGenerateMode = null;
    devDocSimpleEditMode = false;
    devDocEditDrafts = { manual: '', skill: '' };
    devDocImportMeta = { sourceUrl: '', sourcePath: '' };
    devDocResourceMeta = { resourceFolderSource: '' };
    devDocEditSnapshot = null;

    const urlInput = $('wf-devdocs-detail-url');
    if (urlInput) urlInput.value = '';

    const resourceInput = $('wf-devdocs-detail-resource-folder');
    if (resourceInput) resourceInput.value = '';

    const editEl = getSkillEdit();
    if (editEl) {
      editEl.value = '';
      editEl.placeholder = '---\nname: ...\ndescription: "..."\n---';
    }

    const viewEl = getSkillView();
    if (viewEl) viewEl.innerHTML = '';

    const treeEl = $('wf-devdocs-skill-tree');
    if (treeEl) {
      treeEl.innerHTML = '<p class="wf-skill-tree-empty">暂无 Layer 树，生成 skill 后将自动生成。</p>';
    }

    const resourceTreeEl = $('wf-devdocs-resource-tree');
    if (resourceTreeEl) {
      resourceTreeEl.innerHTML =
        '<p class="wf-skill-tree-empty">暂无资源文件树，保存时选择资源文件夹后将自动生成。</p>';
    }

    $('wf-devdocs-edit-source-switch')?.querySelectorAll('[data-source]').forEach((btn) => {
      btn.classList.remove('is-active');
    });
    $('wf-devdocs-generate-mode-switch')?.querySelectorAll('[data-generate-mode]').forEach((btn) => {
      btn.classList.remove('is-active');
    });

    setDevDocSkillPanelMode('view');
  }

  function resetDevDocEditDrafts(doc) {
    devDocEditDrafts = {
      manual: doc?.content || '',
      skill: doc?.skillMarkdown || '',
    };
  }

  function captureDevDocEditSnapshot() {
    stashDevDocEditDraft();
    return {
      source: devDocEditSource,
      generateMode: devDocGenerateMode,
      manual: devDocEditDrafts.manual,
      skill: devDocEditDrafts.skill,
      sourceUrl: devDocImportMeta.sourceUrl,
      sourcePath: devDocImportMeta.sourcePath,
      resourceFolderSource: getDevDocResourceFolderPath(),
      urlBar: $('wf-devdocs-detail-url')?.value?.trim() || '',
    };
  }

  function isDevDocEditDirty() {
    if (!devDocEditing) return false;
    const base = devDocEditSnapshot;
    if (!base) return false;
    const now = captureDevDocEditSnapshot();
    return JSON.stringify(now) !== JSON.stringify(base);
  }

  async function ensureActiveDevDocPersisted() {
    if (activeDevDocId) return activeDevDocId;
    if (!devDocIsNewDraft) return null;
    const res = await getApi()?.workflowDevDocsCreate?.({ title: '未命名 skill', content: '' });
    if (!res?.ok) throw new Error(res?.error || '创建失败');
    activeDevDocId = res.doc.id;
    activeDevDoc = { ...activeDevDoc, ...res.doc, id: res.doc.id };
    devDocIsNewDraft = false;
    await refreshDevDocsList();
    return activeDevDocId;
  }

  function canEditSkillContent() {
    if (!devDocEditing) return false;
    if (devDocSimpleEditMode) return true;
    return devDocEditSource === 'manual';
  }

  function renderDevDocSkillEditingHint() {
    const viewEl = getSkillView();
    if (!viewEl) return;
    let hint = '请先选择 链接、文件 或 手动';
    if (devDocEditSource === 'manual') {
      hint = '请选择 markdown 或 其他，然后在下方输入内容';
    } else if (devDocEditSource === 'url') {
      hint = '请填写链接，并选择 markdown 或 其他';
    } else if (devDocEditSource === 'file') {
      hint = '请选择或填写文件路径，并选择 markdown 或 其他';
    }
    viewEl.innerHTML = `<p class="wf-skill-view-empty">${escapeHtml(hint)}</p>`;
  }

  function syncDevDocSkillPanelView(editing) {
    if (!editing) {
      if (activeDevDoc) renderDevDocSkillView(activeDevDoc);
      return;
    }
    if (canEditSkillContent()) {
      loadSkillEditorForEditMode(activeDevDoc);
      setDevDocSkillPanelMode('edit');
      return;
    }
    renderDevDocSkillEditingHint();
    setDevDocSkillPanelMode('view');
  }

  function loadSkillEditorFromDoc(doc) {
    loadSkillEditorForEditMode(doc);
  }

  function syncSkillEditorPlaceholder() {
    const editEl = getSkillEdit();
    if (!editEl || devDocSimpleEditMode) return;
    if (devDocEditSource !== 'manual') {
      editEl.placeholder = '---\nname: ...\ndescription: "..."\n---';
      return;
    }
    if (devDocGenerateMode === 'markdown') {
      editEl.placeholder = '# 标题\n\nMarkdown 正文…';
    } else if (devDocGenerateMode === 'other') {
      editEl.placeholder = 'HTML / 纯文本 / Markdown 原文…';
    } else {
      editEl.placeholder = '请输入内容…';
    }
  }

  function loadSkillEditorForEditMode(doc = activeDevDoc) {
    const editEl = getSkillEdit();
    if (!editEl) return;
    if (devDocSimpleEditMode) {
      editEl.value = devDocEditDrafts.skill || doc?.skillMarkdown || '';
      editEl.placeholder = '---\nname: ...\ndescription: "..."\n---';
      return;
    }
    if (devDocEditSource === 'manual') {
      editEl.value = devDocEditDrafts.manual ?? doc?.content ?? '';
      syncSkillEditorPlaceholder();
      return;
    }
    editEl.value = devDocEditDrafts.skill || doc?.skillMarkdown || '';
    editEl.placeholder = '---\nname: ...\ndescription: "..."\n---';
  }

  function isDevDocSavedSkill(doc) {
    return Boolean(String(doc?.skillMarkdown || '').trim());
  }

  function syncDevDocEditToolbar() {
    const auxPanel = $('wf-devdocs-detail-aux');
    const importLine = $('wf-devdocs-detail-import-line');
    const importLabel = $('wf-devdocs-import-label');
    const pickBtn = $('wf-devdocs-detail-pick-file');
    const urlInput = $('wf-devdocs-detail-url');
    const sourceSwitch = $('wf-devdocs-edit-source-switch');
    const genSwitch = $('wf-devdocs-generate-mode-switch');
    const mode = devDocEditSource;

    const hideSourceUi = !devDocEditing || devDocSimpleEditMode;
    if (sourceSwitch) sourceSwitch.hidden = hideSourceUi;
    if (genSwitch) genSwitch.hidden = hideSourceUi;

    const showImport = !devDocSimpleEditMode && (mode === 'url' || mode === 'file');
    if (auxPanel) auxPanel.hidden = !devDocEditing;
    if (importLine) {
      importLine.hidden = !showImport;
      importLine.classList.toggle('is-source-url', showImport && mode === 'url');
      importLine.classList.toggle('is-source-file', showImport && mode === 'file');
    }
    if (importLabel) importLabel.textContent = mode === 'file' ? '文件' : '链接';
    if (pickBtn) pickBtn.hidden = mode !== 'file';
    if (urlInput) {
      urlInput.hidden = false;
      urlInput.readOnly = mode === 'file';
      urlInput.placeholder =
        mode === 'url' ? 'https://…' : mode === 'file' ? '选择文件后显示路径' : 'https://…';
    }
  }

  function applyDevDocGenerateMode(mode, opts = {}) {
    const next = mode === 'markdown' || mode === 'other' ? mode : null;
    if (next !== devDocGenerateMode && !opts.skipStash) stashDevDocEditDraft();
    devDocGenerateMode = next;

    const switchEl = $('wf-devdocs-generate-mode-switch');
    switchEl?.querySelectorAll('[data-generate-mode]').forEach((btn) => {
      btn.classList.toggle('is-active', next != null && btn.dataset.generateMode === next);
    });

    if (!opts.skipContentUpdate && devDocEditSource === 'manual') {
      syncSkillEditorPlaceholder();
    }
    syncDevDocEditToolbar();
    syncDevDocSkillPanelView(devDocEditing);
  }

  function stashDevDocEditDraft() {
    if (!devDocEditing) return;
    const v = getSkillEdit()?.value ?? '';
    if (devDocSimpleEditMode) {
      devDocEditDrafts.skill = v;
      return;
    }
    if (devDocEditSource === 'manual') {
      devDocEditDrafts.manual = v;
    } else {
      devDocEditDrafts.skill = v;
    }
  }

  function applyDevDocEditSource(mode, opts = {}) {
    const next = mode === 'url' || mode === 'file' || mode === 'manual' ? mode : null;
    if (next !== devDocEditSource && !opts.skipStash) stashDevDocEditDraft();
    devDocEditSource = next;

    const switchEl = $('wf-devdocs-edit-source-switch');
    switchEl?.querySelectorAll('[data-source]').forEach((btn) => {
      btn.classList.toggle('is-active', next != null && btn.dataset.source === next);
    });

    const urlInput = $('wf-devdocs-detail-url');
    if (urlInput && !opts.skipBarUpdate) {
      if (next === 'url') {
        urlInput.value = devDocImportMeta.sourceUrl || '';
      } else if (next === 'file') {
        urlInput.value = devDocImportMeta.sourcePath || '';
      } else if (next === 'manual') {
        urlInput.value = '';
      }
    }

    if (!opts.skipContentUpdate) {
      loadSkillEditorForEditMode();
    }
    syncDevDocEditToolbar();
    syncDevDocSkillPanelView(devDocEditing);
  }

  function syncDevDocDetailHead(editing) {
    const detailControls = $('wf-devdocs-detail-controls');
    const editToolbar = $('wf-devdocs-edit-toolbar');
    if (detailControls) {
      detailControls.hidden = editing;
      detailControls.classList.toggle('is-view-only', !editing);
    }
    if (editToolbar) {
      const hideToolbar = !editing || devDocSimpleEditMode;
      editToolbar.hidden = hideToolbar;
      editToolbar.classList.toggle('is-edit-only', editing && !devDocSimpleEditMode);
    }
    syncDevDocEditToolbar();
  }

  function setDevDocEditMode(editing) {
    devDocEditing = editing;
    const editBtn = $('wf-devdocs-edit');
    const saveBtn = $('wf-devdocs-generate-skill');
    const titleEl = $('wf-devdocs-detail-title');
    if (editBtn) editBtn.hidden = editing;
    if (saveBtn) saveBtn.hidden = !editing;
    if (editing) {
      devDocSimpleEditMode = isDevDocSavedSkill(activeDevDoc);
      if (devDocSimpleEditMode) {
        devDocEditSource = 'manual';
        devDocGenerateMode = 'markdown';
      } else {
        devDocEditSource = null;
        devDocGenerateMode = null;
        applyDevDocGenerateMode(null, { skipStash: true });
        $('wf-devdocs-edit-source-switch')
          ?.querySelectorAll('[data-source]')
          .forEach((btn) => btn.classList.remove('is-active'));
      }
    } else {
      devDocSimpleEditMode = false;
    }
    syncDevDocDetailHead(editing);
    if (titleEl) {
      titleEl.hidden = true;
      titleEl.contentEditable = 'false';
      titleEl.classList.remove('is-editing');
    }
    syncDevDocSkillPanelView(editing);
    if (editing) devDocEditSnapshot = captureDevDocEditSnapshot();
    else devDocEditSnapshot = null;
  }

  function renderSkillLayerTree(container, tree, skillName, emptyText) {
    if (!container) return;
    const nodes = tree?.nodes || [];
    if (!nodes.length) {
      container.innerHTML = `<p class="wf-skill-tree-empty">${escapeHtml(
        emptyText || '暂无 Layer 树，生成 skill 后将自动生成。'
      )}</p>`;
      return;
    }

    try {
      const rootName = escapeHtml(tree?.skillName || skillName || 'skill');

      function walk(nodeList, prefix) {
        const lines = [];
        nodeList.forEach((node, i) => {
          const isLast = i === nodeList.length - 1;
          const branch = isLast ? '└── ' : '├── ';
          const pathText = escapeHtml(node.path || node.label || '');
          const childPrefix = prefix + (isLast ? '    ' : '│   ');
          const labelText = escapeHtml(node.label || node.title || '');
          const children = node.children || [];
          const showLabelLine = !pathLabelSame(node);

          lines.push(`${prefix}${branch}${pathText}`);

          if (showLabelLine && children.length) {
            lines.push(`${childPrefix}├── ${labelText}`);
            lines.push(...walk(children, `${childPrefix}│   `));
          } else if (showLabelLine) {
            lines.push(`${childPrefix}└── ${labelText}`);
          } else if (children.length) {
            lines.push(...walk(children, childPrefix));
          }
        });
        return lines;
      }

      const body = [rootName, ...walk(nodes, '')].join('\n');
      container.innerHTML = `<pre class="wf-skill-tree-ascii">${body}</pre>`;
    } catch (e) {
      container.innerHTML = `<p class="wf-skill-tree-empty">Layer 树渲染失败：${escapeHtml(e.message || String(e))}</p>`;
    }
  }

  async function importUiDesignFromPicker() {
    if (!projectRoot) {
      setUiImportStatus('请先 File → Open Folder 打开工程', 'error');
      return;
    }
    setUiImportStatus('选择 Figma 导出文件夹…', 'info');
    const res = await getApi()?.workflowImportUiDesign?.({ projectRoot });
    if (res?.canceled) {
      setUiImportStatus('');
      return;
    }
    if (!res?.ok) {
      setUiImportStatus(res?.error || '导入失败', 'error');
      return;
    }
    let msg = `已导入到 ${res.relPath}`;
    if (res.renamed) msg += '（目标已存在，已自动重命名）';
    if (!res.hasFramelink) msg += '；未检测到 Framelink JSON，请确认文件夹内容';
    setUiImportStatus(msg, 'success');
    await refreshUiImportList();
  }

  // ─── Xcode 模拟器 ───
  /** @type {Array<{ udid:string, name:string, os:string, state:string }>} */
  let simCandidates = [];
  /** @type {{ udid:string, name:string, os:string }|null} */
  let selectedSim = null;

  async function refreshXcodeSimList() {
    const api = getApi();
    if (!api?.workflowListSimulators) {
      const list = $('wf-xcode-sim-list');
      if (list) list.innerHTML = '<div class="wf-xcode-sim-empty">API 不可用</div>';
      return;
    }
    const list = $('wf-xcode-sim-list');
    if (list) list.innerHTML = '<div class="wf-xcode-sim-empty">加载中…</div>';
    const res = await getApi()?.workflowListSimulators?.();
    if (!res?.ok) {
      if (list) list.innerHTML = `<div class="wf-xcode-sim-empty">加载失败：${escapeHtml(res?.error || '未知错误')}</div>`;
      return;
    }
    simCandidates = Array.isArray(res.simulators) ? res.simulators : [];
    selectedSim = res.preferred || null;
    renderXcodeSimList();
  }

  function renderXcodeSimList() {
    const list = $('wf-xcode-sim-list');
    if (!list) return;

    if (!simCandidates.length) {
      list.innerHTML = '<div class="wf-xcode-sim-empty">无可用模拟器，点击「刷新」重新获取</div>';
      return;
    }

    // 按 iOS 版本分组
    const versionMap = new Map();
    for (const s of simCandidates) {
      const v = s.os || '未知';
      if (!versionMap.has(v)) versionMap.set(v, []);
      versionMap.get(v).push(s);
    }
    const versions = [...versionMap.keys()].sort((a, b) => {
      const aParts = a.split('.').map(Number);
      const bParts = b.split('.').map(Number);
      for (let i = 0; i < Math.max(aParts.length, bParts.length); i++) {
        if ((aParts[i] || 0) !== (bParts[i] || 0)) return (bParts[i] || 0) - (aParts[i] || 0);
      }
      return 0;
    });

    let html = '';
    for (const ver of versions) {
      const devices = versionMap.get(ver) || [];
      html += `<div class="wf-xcode-sim-group">`;
      html += `<div class="wf-xcode-sim-group-label">iOS ${escapeHtml(ver)}</div>`;
      for (const s of devices) {
        const sel = selectedSim && selectedSim.udid === s.udid ? ' is-selected' : '';
        const booted = s.state === 'Booted' ? ' is-booted' : '';
        const stateLabel = s.state === 'Booted' ? '已启动' : '';
        html += `<div class="wf-xcode-sim-row${sel}" data-udid="${escapeHtml(s.udid)}" data-name="${escapeHtml(s.name)}" data-os="${escapeHtml(ver)}">`;
        html += `<span class="wf-xcode-sim-radio"></span>`;
        html += `<span class="wf-xcode-sim-name">${escapeHtml(s.name)}</span>`;
        if (stateLabel) {
          html += `<span class="wf-xcode-sim-state${booted}">${stateLabel}</span>`;
        }
        html += `</div>`;
      }
      html += `</div>`;
    }
    list.innerHTML = html;

    // 点击选择
    list.querySelectorAll('.wf-xcode-sim-row').forEach((row) => {
      row.addEventListener('click', () => {
        selectXcodeSim(row.dataset.udid, row.dataset.name, row.dataset.os);
      });
    });
  }

  async function selectXcodeSim(udid, name, os) {
    const res = await getApi()?.workflowSaveSimulator?.({ udid, name, os });
    if (!res?.ok) {
      const log = $('wf-xcode-log');
      if (log) log.textContent = `保存失败：${res?.error || '未知错误'}`;
      return;
    }
    selectedSim = { udid, name, os };
    renderXcodeSimList();
    const log = $('wf-xcode-log');
    if (log) log.textContent = `已选择：${name} (iOS ${os})`;
  }

  // ─── DevDocs Storage ───

  async function openDevDocsStorageDir() {
    const res = await getApi()?.workflowDevDocsOpenDir?.();
    if (!res?.ok) {
      setDevDocsStatus( res?.error || '无法打开文件夹');
    }
  }

  function renderDevDocSkillView(doc) {
    if (devDocEditing) return;
    const viewEl = getSkillView();
    const md = doc.skillMarkdown || doc.skillDisplayMarkdown || '';
    if (viewEl) {
      const api = getApi();
      if (api?.renderMarkdown) {
        viewEl.innerHTML = api.renderMarkdown(md);
        bindDevDocMarkdownLinks(viewEl);
      } else {
        viewEl.textContent = md;
      }
    }
    setDevDocSkillPanelMode('view');
    renderSkillLayerTree($('wf-devdocs-skill-tree'), doc.layerTree, doc.skillName);
    renderSkillLayerTree(
      $('wf-devdocs-resource-tree'),
      doc.resourceTree,
      doc.skillName,
      '暂无资源文件树，保存时选择资源文件夹后将自动生成。'
    );
  }

  function bindDevDocMarkdownLinks(container) {
    container.querySelectorAll('a[href]').forEach((a) => {
      a.addEventListener('click', (e) => {
        e.preventDefault();
        const href = a.getAttribute('href');
        if (href && /^https?:/i.test(href)) {
          getApi()?.workflowOpenDownloadUrl?.({ url: href }).catch(() => {});
        }
      });
    });
  }

  async function openDevDoc(id, opts = {}) {
    if (!id) return;
    setDevDocsStatus( '');
    const res = await getApi()?.workflowDevDocsGet?.({ id });
    if (!res?.ok) {
      setDevDocsStatus( res?.error || '加载失败');
      return;
    }
    activeDevDocId = id;
    activeDevDoc = res.doc;
    devDocIsNewDraft = false;
    devDocEditing = false;
    showDevDocsDetailView();

    const titleEl = $('wf-devdocs-detail-title');
    const title = res.doc.title || res.doc.skillName || '未命名 skill';
    if (titleEl) titleEl.textContent = title;

    syncDevDocDetailHead(false);

    resetDevDocEditDrafts(res.doc);
    resetDevDocImportMeta(res.doc);
    resetDevDocResourceMeta(res.doc);

    if (opts.editing) setDevDocEditMode(true);
    else {
      setDevDocEditMode(false);
      renderDevDocSkillView(res.doc);
    }
  }

  async function saveSavedSkillViaMarkdownPath() {
    stashDevDocEditDraft();
    const skillMarkdown = devDocEditDrafts.skill ?? '';
    if (!String(skillMarkdown).trim()) {
      window.alert('Skill 内容不能为空');
      return;
    }
    try {
      await ensureActiveDevDocPersisted();
    } catch (e) {
      window.alert(String(e));
      return;
    }
    setDevDocsStatus('保存 skill 中…');
    const resourceFolderPath = getDevDocResourceFolderPath();
    const genPayload = {
      id: activeDevDocId,
      title: activeDevDoc?.title || undefined,
      data: skillMarkdown,
      editSourceMode: 'markdown',
      sourceType: 'manual',
    };
    if (resourceFolderPath) genPayload.resourceFolderPath = resourceFolderPath;

    const res = await getApi()?.workflowDevDocsGenerateSkill?.(genPayload);
    if (!res?.ok) {
      window.alert(res?.error || '保存失败');
      setDevDocsStatus(res?.error || '保存失败', 'error');
      return;
    }
    setDevDocEditMode(false);
    await openDevDoc(activeDevDocId);
    await refreshDevDocsList();
    setDevDocsStatus(`已保存 skill：${res.name || res.title || res.skillName || ''}`);
  }

  async function saveActiveDevDoc() {
    if (!activeDevDocId && !devDocIsNewDraft) return;
    stashDevDocEditDraft();
    if (devDocSimpleEditMode) {
      await saveSavedSkillViaMarkdownPath();
      return;
    }
    if (!devDocEditSource) {
      window.alert('请先选择 链接、文件 或 手动');
      return;
    }
    if (!devDocGenerateMode) {
      window.alert('请先选择 markdown 或 其他');
      return;
    }
    await saveActiveDevDocFromSource();
  }

  async function saveActiveDevDocFromSource() {
    syncDevDocImportMetaFromBar();
    const title = activeDevDoc?.title || $('wf-devdocs-detail-title')?.textContent?.trim();
    const source = $('wf-devdocs-detail-url')?.value?.trim() || '';
    const readPayload = {};

    if (devDocEditSource === 'url') {
      if (!isDevDocHttpSource(source)) {
        window.alert('请填写有效的 https 链接');
        return;
      }
      readPayload.sourceUrl = source;
    } else if (devDocEditSource === 'file') {
      if (!source) {
        window.alert('请选择或填写文件路径');
        return;
      }
      readPayload.sourcePath = source;
    } else if (devDocEditSource === 'manual') {
      readPayload.content = devDocEditDrafts.manual ?? '';
    }

    try {
      await ensureActiveDevDocPersisted();
    } catch (e) {
      window.alert(String(e));
      return;
    }

    readPayload.id = activeDevDocId;

    setDevDocsStatus('读取数据…');
    const read = await getApi()?.workflowDevDocsReadResource?.(readPayload);
    if (!read?.ok) {
      window.alert(read?.error || '读取失败');
      setDevDocsStatus(read?.error || '读取失败', 'error');
      return;
    }

    setDevDocsStatus('生成 skill 中…');
    const resourceFolderPath = getDevDocResourceFolderPath();
    const genPayload = {
      id: activeDevDocId,
      title: title || undefined,
      data: read.data,
      editSourceMode: devDocGenerateMode === 'markdown' ? 'markdown' : 'other',
      sourceType: read.sourceType,
      sourceUrl: read.sourceUrl || undefined,
      sourcePath: read.sourcePath || undefined,
    };
    if (resourceFolderPath) genPayload.resourceFolderPath = resourceFolderPath;

    const res = await getApi()?.workflowDevDocsGenerateSkill?.(genPayload);
    if (!res?.ok) {
      window.alert(res?.error || '生成失败');
      setDevDocsStatus(res?.error || '生成失败', 'error');
      return;
    }
    setDevDocEditMode(false);
    await openDevDoc(activeDevDocId);
    await refreshDevDocsList();
    setDevDocsStatus(`已生成 skill：${res.name || res.title || res.skillName || ''}`);
  }

  async function pickDevDocFileForEdit() {
    const pick = await getApi()?.workflowDevDocsPickFile?.();
    if (!pick?.ok || pick.canceled) return;
    const filePath = pick.filePath || '';
    const urlInput = $('wf-devdocs-detail-url');
    if (urlInput) urlInput.value = filePath;
    devDocImportMeta = { sourceUrl: '', sourcePath: filePath };
    applyDevDocEditSource('file');
    setDevDocsStatus('已选择文件');
  }

  async function pickDevDocResourceFolder() {
    const pick = await getApi()?.workflowDevDocsPickFolder?.();
    if (!pick?.ok || pick.canceled) return;
    const folderPath = pick.folderPath || '';
    const input = $('wf-devdocs-detail-resource-folder');
    if (input) input.value = folderPath;
    devDocResourceMeta.resourceFolderSource = folderPath;
    setDevDocsStatus('已选择资源文件夹');
  }

  async function createEmptySkill() {
    devDocIsNewDraft = true;
    activeDevDocId = null;
    activeDevDoc = {
      title: '未命名 skill',
      sourceType: 'manual',
      content: '',
      skillMarkdown: '',
      layerTree: null,
      aiEnabled: true,
      aiContextMode: 'skill',
    };
    resetDevDocEditSession();
    setDevDocsStatus('');
    showDevDocsDetailView();

    const titleEl = $('wf-devdocs-detail-title');
    if (titleEl) titleEl.textContent = activeDevDoc.title;

    syncDevDocDetailHead(false);
    setDevDocEditMode(true);
    setDevDocsStatus('请编辑 skill');
  }

  async function deleteDevDocById(id) {
    const docId = String(id || '').trim();
    if (!docId || !window.confirm('删除该 skill？')) return;
    const res = await getApi()?.workflowDevDocsDelete?.({ id: docId });
    if (!res?.ok) {
      window.alert(res?.error || '删除失败');
      return;
    }
    devDocs = res.docs || [];
    if (activeDevDocId === docId) showDevDocsListView();
    renderDevDocsList();
    setDevDocsStatus('已删除');
  }

  async function deleteActiveDevDoc() {
    if (devDocIsNewDraft && !activeDevDocId) {
      if (isDevDocEditDirty() && !window.confirm('放弃未保存的编辑？')) return;
      devDocIsNewDraft = false;
      devDocEditSnapshot = null;
      setDevDocEditMode(false);
      showDevDocsListView();
      return;
    }
    if (!activeDevDocId) return;
    await deleteDevDocById(activeDevDocId);
  }

  async function loadPanelHtml() {
    const mount = $('panel-workflow');
    if (!mount) return null;
    const api = getApi();
    if (!api?.workflowGetPanelHtml) {
      mount.innerHTML = '<div class="workflow-load-error">Workflow API 不可用</div>';
      return null;
    }
    if (mount.dataset.panelVersion === PANEL_VERSION && mount.dataset.loaded === '1') {
      return mount;
    }
    const res = await api.workflowGetPanelHtml();
    if (!res?.ok) {
      mount.innerHTML = `<div class="workflow-load-error">${escapeHtml(res?.error || '加载失败')}</div>`;
      return null;
    }
    mount.innerHTML = res.html;
    mount.dataset.loaded = '1';
    mount.dataset.panelVersion = PANEL_VERSION;
    mount.dataset.uiBound = '';
    return mount;
  }

  function syncScheduleTriggerUi() {
    const type = $('wf-sch-trigger')?.value || 'interval';
    const intervalWrap = $('wf-sch-interval-wrap');
    const dailyWrap = $('wf-sch-daily-wrap');
    if (intervalWrap) intervalWrap.hidden = type !== 'interval';
    if (dailyWrap) dailyWrap.hidden = type !== 'daily';
  }

  function bindUi() {
    const mount = $('panel-workflow');
    if (!mount || mount.dataset.uiBound === '1') return;
    mount.dataset.uiBound = '1';

    mount.querySelectorAll('.workflow-tab').forEach((btn) => {
      btn.addEventListener('click', () => switchTab(btn.dataset.wfTab || 'skill'));
    });

    $('wf-sch-trigger')?.addEventListener('change', syncScheduleTriggerUi);
    syncScheduleTriggerUi();

    $('wf-organize-pick')?.addEventListener('click', async () => {
      const res = await getApi()?.workflowPickFolder?.({ title: '选择要归类的文件夹' });
      if (res?.ok && res.folderPath) {
        const input = $('wf-organize-dir');
        if (input) input.value = res.folderPath;
      }
    });

    $('wf-dl-pick')?.addEventListener('click', async () => {
      const res = await getApi()?.workflowPickFolder?.({
        title: '选择要共享的文件夹',
        saveAsDownloadDir: true,
      });
      if (res?.ok && res.folderPath) {
        if (res.downloadServiceDir) downloadServiceDir = res.downloadServiceDir;
        syncDownloadDirInput(res.folderPath);
        await startDownloadService(res.folderPath);
      }
    });

    $('wf-dl-start')?.addEventListener('click', async () => {
      await startDownloadService(getDownloadDir());
    });

    $('wf-dl-stop')?.addEventListener('click', async () => {
      downloadUserStopped = true;
      downloadUrlChangedInfo = null;
      const res = await getApi()?.workflowDownloadServerStop?.();
      if (res?.ok) {
        renderDownloadServerUi({
          ...res,
          lastDownloadServiceUrl: res.lastDownloadServiceUrl || '',
          downloadServiceDir: res.downloadServiceDir || downloadServiceDir,
        });
      }
    });

    $('wf-dl-copy')?.addEventListener('click', () => {
      copyDownloadUrl().catch(() => {
        window.alert('复制失败，请手动选择地址复制');
      });
    });

    $('wf-dl-open')?.addEventListener('click', async () => {
      const url = $('wf-dl-url')?.value?.trim();
      if (!url) {
        window.alert('请先开启文件服务');
        return;
      }
      const res = await getApi()?.workflowOpenDownloadUrl?.({ url });
      if (!res?.ok) window.alert(res?.error || '无法打开浏览器');
    });

    $('wf-dl-cache-path')?.addEventListener('click', async () => {
      const dir = $('wf-dl-cache-path')?.dataset?.path;
      if (!dir) return;
      const res = await getApi()?.mcpFsOpenProjectRoot?.({ projectRoot: dir });
      if (!res?.ok) window.alert(res?.error || '无法打开目录');
    });

    $('wf-dl-clear-cache')?.addEventListener('click', async () => {
      const count = Number($('wf-dl-cache-meta')?.dataset?.count || 0);
      const msg =
        count > 0
          ? `将删除 ${count} 张视频封面缓存，下次浏览时会重新生成。继续？`
          : '当前没有视频封面缓存。仍要执行清除？';
      if (!window.confirm(msg)) return;
      const res = await getApi()?.workflowClearVideoThumbCache?.();
      if (!res?.ok) {
        window.alert(res?.error || '清除失败');
        return;
      }
      renderDownloadServerUi(res);
    });

    $('wf-organize-preview')?.addEventListener('click', async () => {
      const dir = getOrganizeDir();
      if (!dir) {
        setLog('wf-organize-log', '请先 Open Folder 或选择文件夹。');
        return;
      }
      setLog('wf-organize-log', '预览中…');
      const res = await getApi()?.workflowOrganizeFiles?.({ sourceDir: dir, dryRun: true });
      setLog('wf-organize-log', formatOrganizeResult(res, true));
    });

    $('wf-organize-run')?.addEventListener('click', async () => {
      const dir = getOrganizeDir();
      if (!dir) {
        setLog('wf-organize-log', '请先 Open Folder 或选择文件夹。');
        return;
      }
      if (!window.confirm(`确定将「${dir}」顶层文件按类型归类？`)) return;
      setLog('wf-organize-log', '执行中…');
      const res = await getApi()?.workflowOrganizeFiles?.({ sourceDir: dir, dryRun: false });
      setLog('wf-organize-log', formatOrganizeResult(res, false));
    });

    $('wf-ppt-generate')?.addEventListener('click', async () => {
      const title = $('wf-ppt-title')?.value?.trim();
      if (!title) {
        setLog('wf-ppt-log', '请填写标题。');
        return;
      }
      setLog('wf-ppt-log', '生成中…');
      const res = await getApi()?.workflowCreatePptOutline?.({
        title,
        topic: $('wf-ppt-topic')?.value?.trim() || title,
        slideCount: $('wf-ppt-slides')?.value,
        audience: $('wf-ppt-audience')?.value?.trim(),
      });
      if (!res?.ok) {
        setLog('wf-ppt-log', res?.error || '生成失败');
        return;
      }
      setLog(
        'wf-ppt-log',
        `已保存：${res.relPath || res.path}\n\n---\n\n${(res.content || '').slice(0, 1200)}${(res.content || '').length > 1200 ? '\n…' : ''}`
      );
    });

    $('wf-sch-pick-app')?.addEventListener('click', async () => {
      const res = await getApi()?.workflowPickApp?.();
      if (res?.ok && res.appPath) {
        const input = $('wf-sch-app-path');
        if (input) input.value = res.appPath;
      }
    });

    $('wf-sch-test')?.addEventListener('click', () => {
      runScheduleNow(readScheduleForm());
    });

    $('wf-sch-save')?.addEventListener('click', async () => {
      const payload = readScheduleForm();
      if (!payload.appName && !payload.appPath) {
        setLog('wf-schedule-log', '请填写应用名称或选择 .app 路径。');
        return;
      }
      const res = await getApi()?.workflowSaveSchedule?.(payload);
      if (!res?.ok) {
        setLog('wf-schedule-log', res?.error || '保存失败');
        return;
      }
      schedules = res.schedules || [];
      renderScheduleList();
      setLog('wf-schedule-log', `已保存：${payload.name}`);
    });

    $('wf-devdocs-open-dir')?.addEventListener('click', () => {
      openDevDocsStorageDir().catch((e) => setDevDocsStatus( String(e)));
    });
    $('wf-devdocs-detail-pick-file')?.addEventListener('click', () => {
      pickDevDocFileForEdit().catch((e) => setDevDocsStatus(String(e)));
    });
    $('wf-devdocs-detail-pick-resource-folder')?.addEventListener('click', () => {
      pickDevDocResourceFolder().catch((e) => setDevDocsStatus(String(e)));
    });
    $('wf-devdocs-detail-url')?.addEventListener('input', () => {
      syncDevDocImportMetaFromBar();
    });
    $('wf-devdocs-add-skill')?.addEventListener('click', () => {
      createEmptySkill().catch((e) => setDevDocsStatus(String(e)));
    });
    $('wf-ui-import-pick')?.addEventListener('click', () => {
      importUiDesignFromPicker().catch((e) => setUiImportStatus(String(e), 'error'));
    });
    $('wf-xcode-refresh')?.addEventListener('click', () => {
      refreshXcodeSimList().catch(() => {});
    });
    $('wf-devdocs-list-edit')?.addEventListener('click', () => {
      setDevDocsListSelectMode(!devDocsListSelectMode);
    });
    $('wf-devdocs-list-toggle-all')?.addEventListener('click', () => {
      toggleDevDocsListSelectAll();
    });
    $('wf-devdocs-list-delete')?.addEventListener('click', () => {
      deleteSelectedDevDocs().catch((e) => setDevDocsStatus(String(e), 'error'));
    });
    $('wf-devdocs-back')?.addEventListener('click', () => {
      if (devDocEditing && isDevDocEditDirty()) {
        if (!window.confirm('有未保存的编辑，确定返回？')) return;
      }
      devDocIsNewDraft = false;
      devDocEditSnapshot = null;
      setDevDocEditMode(false);
      showDevDocsListView();
    });
    $('wf-devdocs-edit')?.addEventListener('click', () => {
      if (!activeDevDocId) return;
      if (activeDevDoc) {
        resetDevDocEditDrafts(activeDevDoc);
        resetDevDocImportMeta(activeDevDoc);
        resetDevDocResourceMeta(activeDevDoc);
      }
      setDevDocEditMode(true);
    });
    $('wf-devdocs-edit-source-switch')?.querySelectorAll('[data-source]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (!devDocEditing) return;
        applyDevDocEditSource(btn.dataset.source);
      });
    });
    $('wf-devdocs-generate-mode-switch')?.querySelectorAll('[data-generate-mode]').forEach((btn) => {
      btn.addEventListener('click', () => {
        if (!devDocEditing) return;
        applyDevDocGenerateMode(btn.dataset.generateMode);
      });
    });
    $('wf-devdocs-generate-skill')?.addEventListener('click', () => {
      saveActiveDevDoc().catch((e) => window.alert(String(e)));
    });
    $('wf-devdocs-delete')?.addEventListener('click', () => {
      deleteActiveDevDoc().catch((e) => window.alert(String(e)));
    });
  }

  function readScheduleForm() {
    return {
      name: $('wf-sch-name')?.value?.trim() || '未命名任务',
      triggerType: $('wf-sch-trigger')?.value === 'daily' ? 'daily' : 'interval',
      intervalMinutes: $('wf-sch-interval')?.value,
      dailyTime: $('wf-sch-daily')?.value?.trim(),
      appName: $('wf-sch-app-name')?.value?.trim(),
      appPath: $('wf-sch-app-path')?.value?.trim(),
      enabled: true,
    };
  }

  async function runScheduleNow(payload) {
    setLog('wf-schedule-log', '启动中…');
    const res = await getApi()?.workflowRunScheduleNow?.(payload);
    setLog('wf-schedule-log', res?.ok ? res.message || '已启动' : res?.error || '启动失败');
  }

  async function deleteScheduleById(id) {
    if (!id || !window.confirm('删除该定时任务？')) return;
    const res = await getApi()?.workflowDeleteSchedule?.({ id });
    if (res?.ok) {
      schedules = res.schedules || [];
      renderScheduleList();
      setLog('wf-schedule-log', '已删除');
    }
  }

  function setupProjectListener() {
    const api = getApi();
    if (!api?.onMcpFsProjectChanged) return;
    api.onMcpFsProjectChanged(({ projectRoot: root }) => {
      projectRoot = root || '';
      updateProjectLabel();
      refreshUiImportList().catch(() => {});
    });
  }

  async function init() {
    const mount = $('panel-workflow');
    if (!mount) return;
    await loadPanelHtml();
    bindUi();
    switchTab(getDefaultTab());
    setupProjectListener();
    await refreshState();
  }

  window.WorkflowPanel = {
    init: () => init().catch((e) => console.error('[workflow-ui]', e)),
  };
})();
