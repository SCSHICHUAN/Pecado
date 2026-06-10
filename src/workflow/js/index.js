/**
 * @file index.js
 *
 * 【功能】Workflow 主面板 UI：文件归类、PPT 大纲、定时任务
 */
(function () {
  const PANEL_VERSION = '12';

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
      btn.addEventListener('click', () => switchTab(btn.dataset.wfTab || 'download'));
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
    });
  }

  async function init() {
    const mount = $('panel-workflow');
    if (!mount) return;
    await loadPanelHtml();
    bindUi();
    switchTab('download');
    setupProjectListener();
    await refreshState();
  }

  window.WorkflowPanel = {
    init: () => init().catch((e) => console.error('[workflow-ui]', e)),
  };
})();
