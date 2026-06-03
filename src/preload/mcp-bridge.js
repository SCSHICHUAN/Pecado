/**
 * @file mcp-bridge.js
 *
 * preload 侧 MCP filesystem IPC 桥（暴露给 electronAPI）。
 */
const { ipcRenderer } = require('electron');
const { MCP_FS } = require('../main/mcp/ipc-channels');

function createMcpBridge() {
  return {
    mcpFsGetStatus: () => ipcRenderer.invoke(MCP_FS.GET_STATUS),
    mcpFsPickProject: () => ipcRenderer.invoke(MCP_FS.PICK_PROJECT),
    mcpFsConnect: (projectRoot) => ipcRenderer.invoke(MCP_FS.CONNECT, { projectRoot }),
    mcpFsPickAndConnect: () => ipcRenderer.invoke(MCP_FS.PICK_AND_CONNECT),
    mcpFsDisconnect: () => ipcRenderer.invoke(MCP_FS.DISCONNECT),
    mcpFsListTools: () => ipcRenderer.invoke(MCP_FS.LIST_TOOLS),
    mcpFsCallTool: (name, args) => ipcRenderer.invoke(MCP_FS.CALL_TOOL, { name, arguments: args }),
    mcpFsDirectoryTree: (opts) => ipcRenderer.invoke(MCP_FS.DIRECTORY_TREE, opts || {}),
    mcpFsReadTextFile: (filePath, opts) =>
      ipcRenderer.invoke(MCP_FS.READ_TEXT_FILE, { path: filePath, ...(opts || {}) }),
    mcpFsWriteFile: (filePath, content) =>
      ipcRenderer.invoke(MCP_FS.WRITE_FILE, { path: filePath, content }),
    mcpFsListAllowed: () => ipcRenderer.invoke(MCP_FS.LIST_ALLOWED),
    /**
     * @param {(payload: { projectRoot: string, tools?: string[] }) => void} callback
     * @returns {() => void}
     */
    onMcpFsProjectChanged: (callback) => {
      const ch = MCP_FS.PROJECT_CHANGED;
      const fn = (_evt, payload) => {
        try {
          callback(payload);
        } catch (e) {
          console.error('[preload] onMcpFsProjectChanged', e);
        }
      };
      ipcRenderer.on(ch, fn);
      return () => ipcRenderer.removeListener(ch, fn);
    },
  };
}

module.exports = { createMcpBridge };
