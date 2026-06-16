/**
 * @file ipc.js
 * CodX 主进程 IPC
 */
const { CODX } = require('../shared/ipc-channels');
const transport = require('../mcp-filesystem/mcp-transport');
const { resolveUnderProject } = require('../mcp-filesystem/read');
const { checkFileSyntax } = require('./syntax-check');

function register(ipcMain) {
  ipcMain.handle(CODX.CHECK_SYNTAX, async (_evt, payload = {}) => {
    const status = transport.getStatus();
    if (!status.connected || !status.projectRoot) {
      return { ok: false, issues: [], error: '工程未打开' };
    }
    const relPath = String(payload?.relPath || '').replace(/^\/+/, '');
    if (!relPath) return { ok: false, issues: [], error: '缺少 relPath' };
    try {
      const absPath = resolveUnderProject(status.projectRoot, relPath);
      return await checkFileSyntax({
        absPath,
        relPath,
        content: payload?.content,
      });
    } catch (e) {
      return { ok: false, issues: [], error: e.message || String(e) };
    }
  });
}

module.exports = { register };
