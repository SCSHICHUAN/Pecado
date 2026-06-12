/**
 * @file register.js
 * 【功能】Workflow IPC：文件归类、PPT 大纲、定时启动应用
 * 【注册】main/js/main.js
 */
const fs = require('fs');
const path = require('path');
const { dialog, shell } = require('electron');
const { WORKFLOW } = require('../shared/ipc-channels');
const projectIo = require('../mcp-filesystem');
const { readSavedProjectRoot } = require('../mcp-filesystem/ipc');
const { organizeFiles } = require('./services/file-organize');
const { writeOutlineToProject } = require('./services/ppt-outline');
const {
  launchApplication,
  armSchedule,
  reloadAllSchedules,
  stopAllSchedules,
  upsertSchedule,
} = require('./services/schedule-runner');
const { listSchedules, deleteSchedule, getStorePath, getLastDownloadServiceUrl, saveLastDownloadServiceUrl, getDownloadServiceDir, saveDownloadServiceDir } = require('./store');
const {
  startDownloadServer,
  stopDownloadServer,
  getDownloadServerStatus,
} = require('./services/file-download-server');
const { clearVideoThumbnailCache } = require('./services/video-thumbnail');
const devDocsService = require('./dev-docs/service');
const { getDevDocsDir } = require('./dev-docs/store');

const PANEL_HTML = path.join(__dirname, 'html', 'panel.html');

function readPanelHtml() {
  return fs.readFileSync(PANEL_HTML, 'utf8');
}

function resolveProjectDir(payloadRoot) {
  const fromPayload = payloadRoot != null ? String(payloadRoot).trim() : '';
  if (fromPayload) return path.resolve(fromPayload);
  const status = projectIo.getStatus();
  if (status.connected && status.projectRoot) return path.resolve(status.projectRoot);
  const saved = readSavedProjectRoot();
  if (saved && fs.existsSync(saved) && fs.statSync(saved).isDirectory()) {
    return path.resolve(saved);
  }
  return '';
}

function resolveDownloadServiceDir(payloadFolder) {
  const fromPayload = payloadFolder != null ? String(payloadFolder).trim() : '';
  if (fromPayload) {
    const resolved = path.resolve(fromPayload);
    if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) return resolved;
    return '';
  }
  const saved = getDownloadServiceDir();
  if (saved && fs.existsSync(saved) && fs.statSync(saved).isDirectory()) {
    return path.resolve(saved);
  }
  return '';
}

/**
 * @param {import('electron').IpcMain} ipcMain
 * @param {() => import('electron').BrowserWindow | null} getMainWindowFn
 */
function register(ipcMain, getMainWindowFn) {
  reloadAllSchedules();

  ipcMain.handle(WORKFLOW.GET_PANEL_HTML, async () => {
    try {
      return { ok: true, html: readPanelHtml() };
    } catch (e) {
      return { ok: false, error: e.message || String(e) };
    }
  });

  ipcMain.handle(WORKFLOW.GET_STATE, async () => {
    const status = projectIo.getStatus();
    const savedRoot = readSavedProjectRoot();
    const projectRoot =
      status.projectRoot ||
      (savedRoot && fs.existsSync(savedRoot) ? savedRoot : '');
    return {
      ok: true,
      projectRoot,
      connected: Boolean(status.connected),
      schedules: listSchedules(),
      storePath: getStorePath(),
      downloadServer: getDownloadServerStatus(),
      lastDownloadServiceUrl: getLastDownloadServiceUrl(),
      downloadServiceDir: getDownloadServiceDir(),
      devDocsDir: getDevDocsDir(),
      devDocs: devDocsService.listDevDocs().docs || [],
    };
  });

  ipcMain.handle(WORKFLOW.ORGANIZE_FILES, async (_evt, payload) => {
    try {
      const dir = resolveProjectDir(payload?.sourceDir);
      if (!dir) return { ok: false, error: '请先 Open Folder 或指定有效目录' };
      return organizeFiles(dir, { dryRun: Boolean(payload?.dryRun) });
    } catch (e) {
      return { ok: false, error: e.message || String(e) };
    }
  });

  ipcMain.handle(WORKFLOW.CREATE_PPT_OUTLINE, async (_evt, payload) => {
    try {
      const root = resolveProjectDir(payload?.projectRoot);
      return writeOutlineToProject(root, payload || {});
    } catch (e) {
      return { ok: false, error: e.message || String(e) };
    }
  });

  ipcMain.handle(WORKFLOW.SAVE_SCHEDULE, async (_evt, payload) => {
    try {
      const saved = upsertSchedule(payload || {});
      armSchedule(saved);
      return { ok: true, schedule: saved, schedules: listSchedules() };
    } catch (e) {
      return { ok: false, error: e.message || String(e) };
    }
  });

  ipcMain.handle(WORKFLOW.DELETE_SCHEDULE, async (_evt, payload) => {
    try {
      const id = String(payload?.id || '').trim();
      if (!id) return { ok: false, error: '缺少任务 id' };
      deleteSchedule(id);
      reloadAllSchedules();
      return { ok: true, schedules: listSchedules() };
    } catch (e) {
      return { ok: false, error: e.message || String(e) };
    }
  });

  ipcMain.handle(WORKFLOW.RUN_SCHEDULE_NOW, async (_evt, payload) => {
    try {
      return launchApplication(payload || {});
    } catch (e) {
      return { ok: false, error: e.message || String(e) };
    }
  });

  ipcMain.handle(WORKFLOW.PICK_APP, async () => {
    const win = typeof getMainWindowFn === 'function' ? getMainWindowFn() : null;
    const result = await dialog.showOpenDialog(win, {
      title: '选择应用程序',
      properties: ['openFile'],
      filters: process.platform === 'darwin' ? [{ name: 'Application', extensions: ['app'] }] : undefined,
    });
    if (result.canceled || !result.filePaths?.[0]) {
      return { ok: false, canceled: true };
    }
    return { ok: true, appPath: result.filePaths[0] };
  });

  ipcMain.handle(WORKFLOW.PICK_FOLDER, async (_evt, payload) => {
    const win = typeof getMainWindowFn === 'function' ? getMainWindowFn() : null;
    const title = payload?.title ? String(payload.title) : '选择文件夹';
    const result = await dialog.showOpenDialog(win, {
      title,
      properties: ['openDirectory'],
    });
    if (result.canceled || !result.filePaths?.[0]) {
      return { ok: false, canceled: true };
    }
    const folderPath = result.filePaths[0];
    if (payload?.saveAsDownloadDir) {
      saveDownloadServiceDir(folderPath);
    }
    return { ok: true, folderPath, downloadServiceDir: getDownloadServiceDir() };
  });

  ipcMain.handle(WORKFLOW.DOWNLOAD_SERVER_START, async (_evt, payload) => {
    try {
      const dir = resolveDownloadServiceDir(payload?.folderPath);
      if (!dir) return { ok: false, error: '请先选择要共享的文件夹' };
      saveDownloadServiceDir(dir);
      const previousUrl = getLastDownloadServiceUrl();
      const result = await startDownloadServer(dir, { port: payload?.port });
      if (!result.ok) return result;
      const currentUrl = result.primaryUrl || result.localhostUrl || '';
      const urlChanged = Boolean(previousUrl && currentUrl && previousUrl !== currentUrl);
      if (currentUrl) saveLastDownloadServiceUrl(currentUrl);
      return {
        ...result,
        urlChanged,
        previousUrl,
        lastDownloadServiceUrl: currentUrl || getLastDownloadServiceUrl(),
        downloadServiceDir: getDownloadServiceDir(),
      };
    } catch (e) {
      return { ok: false, error: e.message || String(e) };
    }
  });

  ipcMain.handle(WORKFLOW.DOWNLOAD_SERVER_STOP, async () => {
    stopDownloadServer();
    return {
      ok: true,
      ...getDownloadServerStatus(),
      lastDownloadServiceUrl: getLastDownloadServiceUrl(),
      downloadServiceDir: getDownloadServiceDir(),
    };
  });

  ipcMain.handle(WORKFLOW.GET_DOWNLOAD_SERVER, async () => {
    return {
      ok: true,
      ...getDownloadServerStatus(),
      lastDownloadServiceUrl: getLastDownloadServiceUrl(),
      downloadServiceDir: getDownloadServiceDir(),
    };
  });

  ipcMain.handle(WORKFLOW.CLEAR_VIDEO_THUMB_CACHE, async () => {
    try {
      return { ok: true, ...clearVideoThumbnailCache(), ...getDownloadServerStatus() };
    } catch (e) {
      return { ok: false, error: e.message || String(e) };
    }
  });

  ipcMain.handle(WORKFLOW.OPEN_DOWNLOAD_URL, async (_evt, payload) => {
    try {
      const fromPayload = payload?.url != null ? String(payload.url).trim() : '';
      const url = fromPayload || getDownloadServerStatus().primaryUrl || '';
      if (!url) return { ok: false, error: '请先开启文件服务' };
      await shell.openExternal(url);
      return { ok: true, url };
    } catch (e) {
      return { ok: false, error: e.message || String(e) };
    }
  });

  ipcMain.handle(WORKFLOW.DEV_DOCS_LIST, async () => {
    try {
      return devDocsService.listDevDocs();
    } catch (e) {
      return { ok: false, error: e.message || String(e) };
    }
  });

  ipcMain.handle(WORKFLOW.DEV_DOCS_GET, async (_evt, payload) => {
    try {
      return devDocsService.getDevDoc(payload?.id);
    } catch (e) {
      return { ok: false, error: e.message || String(e) };
    }
  });

  ipcMain.handle(WORKFLOW.DEV_DOCS_PICK_FILE, async () => {
    const win = typeof getMainWindowFn === 'function' ? getMainWindowFn() : null;
    const result = await dialog.showOpenDialog(win, {
      title: '选择文件',
      properties: ['openFile'],
      filters: [{ name: 'All Files', extensions: ['*'] }],
    });
    if (result.canceled || !result.filePaths?.[0]) {
      return { ok: false, canceled: true };
    }
    return { ok: true, filePath: result.filePaths[0] };
  });

  ipcMain.handle(WORKFLOW.DEV_DOCS_CREATE, async (_evt, payload) => {
    try {
      return devDocsService.createManual(payload || {});
    } catch (e) {
      return { ok: false, error: e.message || String(e) };
    }
  });

  ipcMain.handle(WORKFLOW.DEV_DOCS_UPDATE, async (_evt, payload) => {
    try {
      return await devDocsService.updateDevDoc(payload || {});
    } catch (e) {
      return { ok: false, error: e.message || String(e) };
    }
  });

  ipcMain.handle(WORKFLOW.DEV_DOCS_READ_RESOURCE, async (_evt, payload) => {
    try {
      return await devDocsService.readDevDocResource(payload || {});
    } catch (e) {
      return { ok: false, error: e.message || String(e) };
    }
  });

  ipcMain.handle(WORKFLOW.DEV_DOCS_GENERATE_SKILL, async (_evt, payload) => {
    try {
      return await devDocsService.generateDevDocSkill(payload || {});
    } catch (e) {
      return { ok: false, error: e.message || String(e) };
    }
  });

  ipcMain.handle(WORKFLOW.DEV_DOCS_DELETE, async (_evt, payload) => {
    try {
      return devDocsService.deleteDevDoc(payload || {});
    } catch (e) {
      return { ok: false, error: e.message || String(e) };
    }
  });

  ipcMain.handle(WORKFLOW.DEV_DOCS_OPEN_DIR, async () => {
    try {
      const res = devDocsService.openDevDocsDir();
      if (!res?.ok || !res.dir) return { ok: false, error: '无法定位存储目录' };
      const err = await shell.openPath(res.dir);
      if (err) return { ok: false, error: err };
      return { ok: true, dir: res.dir };
    } catch (e) {
      return { ok: false, error: e.message || String(e) };
    }
  });

}

function shutdown() {
  stopAllSchedules();
  stopDownloadServer();
}

module.exports = { register, shutdown, reloadAllSchedules };
