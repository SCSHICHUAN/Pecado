/**
 * @file index.js
 *
 * 工程读写 I/O（MCP server-filesystem + 本地磁盘写）。
 *
 * - 连接：connect / disconnect / getStatus / listTools
 * - 读：readText / readDirectoryTree
 * - 写：writeText（MCP）/ writeWholeFileToDisk / 流式 writeDisk API
 * - 路径：resolveUnderProject
 *
 * MCP 传输仅在 mcp-transport.js；Electron 接线见 ipc.js。
 */
const transport = require('./mcp-transport');
const read = require('./read');
const write = require('./write');

module.exports = {
  connect: transport.connect,
  disconnect: transport.disconnect,
  getStatus: transport.getStatus,
  listTools: transport.listTools,
  callTool: transport.callTool,
  callToolText: transport.callToolText,

  readText: read.readText,
  readDirectoryTree: read.readDirectoryTree,
  listAllowedDirectories: read.listAllowedDirectories,
  DEFAULT_TREE_EXCLUDES: read.DEFAULT_TREE_EXCLUDES,

  writeText: write.writeText,
  createDirectory: write.createDirectory,
  beginWriteSession: write.beginWriteSession,
  scheduleWriteDelta: write.scheduleLiveDelta,
  awaitWritePending: write.awaitPending,
  closeWriteFile: write.closeCodeFile,
  closeAllWriteFiles: write.closeAllCodeFiles,
  writeWholeFileToDisk: write.writeWholeFileStreaming,

  resolveUnderProject: read.resolveUnderProject,
};
