/**
 * @file index.js
 *
 * 【功能】mcp-filesystem 模块门面：统一导出 MCP 连接、读、写、路径沙箱 API。
 *   三层结构：
 *     - mcp-transport.js：stdio 子进程、listTools/callTool
 *     - read.js：read_text_file、directory_tree、resolveUnderProject
 *     - write.js：MCP write + 本地 fs 流式会话（beginWriteSession/scheduleWriteDelta/close）
 *   Electron 菜单与 IPC 不在此文件，见 ipc.js
 *
 * 【调用方】
 *   - mcp-filesystem/ipc.js、project-context.js
 *   - agent/*（agent-loop、tool-executor 经 callTool/listTools）
 *   - xcode/live-stream.js、xcode/prompt.js（resolveUnderProject、流式写）
 *
 * 【对外能力】
 *   连接：connect(root) / disconnect() / getStatus() / listTools() / callTool() / callToolText()
 *   读：readText(rel) / readDirectoryTree(opts) / listAllowedDirectories() / resolveUnderProject(root, rel)
 *   写：writeText / createDirectory / beginWriteSession / scheduleWriteDelta / awaitWritePending /
 *       closeWriteFile / closeAllWriteFiles / writeWholeFileToDisk
 *   常量：DEFAULT_TREE_EXCLUDES
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
