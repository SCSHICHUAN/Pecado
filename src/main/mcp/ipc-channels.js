/**
 * @file ipc-channels.js
 *
 * MCP 相关 IPC 通道名（主进程 ↔ preload ↔ 渲染进程）。
 */
module.exports = {
  MCP_FS: {
    GET_STATUS: 'mcp-fs-get-status',
    PICK_PROJECT: 'mcp-fs-pick-project',
    CONNECT: 'mcp-fs-connect',
    PICK_AND_CONNECT: 'mcp-fs-pick-and-connect',
    DISCONNECT: 'mcp-fs-disconnect',
    LIST_TOOLS: 'mcp-fs-list-tools',
    CALL_TOOL: 'mcp-fs-call-tool',
    DIRECTORY_TREE: 'mcp-fs-directory-tree',
    READ_TEXT_FILE: 'mcp-fs-read-text-file',
    WRITE_FILE: 'mcp-fs-write-file',
    LIST_ALLOWED: 'mcp-fs-list-allowed',
    /** main → renderer：用户通过菜单/IPC 打开工程后推送 */
    PROJECT_CHANGED: 'mcp-fs-project-changed',
  },
};
