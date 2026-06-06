/**
 * @file register.js
 * @module gitgraph
 *
 * 【职责】Git 面板主进程：状态 / pull / push / commit + 提供 gitgraph/html/index.html。
 * 【注册】main/js/main.js → gitgraph.register(ipcMain)
 * 【渲染】gitgraph/js/index.js（由 main/html/index.html 加载）
 */
const fs = require('fs');
const path = require('path');
const { GIT } = require('../../shared/ipc-channels');
const { readSavedProjectRoot } = require('./project-root');
const gitRunner = require('./git-runner');

const PANEL_HTML_PATH = path.join(__dirname, '..', 'html', 'index.html');

function resolveProjectRoot(payload) {
  const fromPayload = payload?.projectRoot ? String(payload.projectRoot).trim() : '';
  return fromPayload || readSavedProjectRoot();
}

function register(ipcMain) {
  ipcMain.handle(GIT.GET_PANEL_HTML, async () => {
    try {
      const html = fs.readFileSync(PANEL_HTML_PATH, 'utf8');
      return { ok: true, html };
    } catch (e) {
      return { ok: false, error: e.message || String(e) };
    }
  });

  ipcMain.handle(GIT.GET_STATE, async (_event, payload) => {
    try {
      const projectRoot = resolveProjectRoot(payload);
      if (!projectRoot) {
        return {
          ok: true,
          isRepo: false,
          projectRoot: '',
          branch: '',
          status: null,
          graphData: [],
          hint: '请通过 File → Open Folder 打开工程目录',
        };
      }
      return await gitRunner.getRepoState(projectRoot);
    } catch (e) {
      return { ok: false, error: e.message || String(e) };
    }
  });

  ipcMain.handle(GIT.PULL, async (_event, payload) => {
    try {
      const projectRoot = resolveProjectRoot(payload);
      const { stdout, stderr } = await gitRunner.pull(projectRoot);
      const state = await gitRunner.getRepoState(projectRoot);
      return { ok: true, output: (stdout + stderr).trim(), ...state };
    } catch (e) {
      return { ok: false, error: e.message || String(e) };
    }
  });

  ipcMain.handle(GIT.PUSH, async (_event, payload) => {
    try {
      const projectRoot = resolveProjectRoot(payload);
      const { stdout, stderr } = await gitRunner.push(projectRoot);
      const state = await gitRunner.getRepoState(projectRoot);
      return { ok: true, output: (stdout + stderr).trim(), ...state };
    } catch (e) {
      return { ok: false, error: e.message || String(e) };
    }
  });

  ipcMain.handle(GIT.COMMIT, async (_event, payload) => {
    try {
      const projectRoot = resolveProjectRoot(payload);
      const message = payload?.message || '';
      const { stdout, stderr } = await gitRunner.commitAll(projectRoot, message);
      const state = await gitRunner.getRepoState(projectRoot);
      return { ok: true, output: (stdout + stderr).trim(), ...state };
    } catch (e) {
      return { ok: false, error: e.message || String(e) };
    }
  });
}

module.exports = { register };
