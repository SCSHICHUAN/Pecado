/**
 * @file filesystem-client.js
 *
 * 主进程 MCP 客户端：通过 stdio 拉起 `@modelcontextprotocol/server-filesystem` 子进程，
 * 对渲染进程提供 directory_tree / read_text_file / write_file 等工具调用。
 */
const path = require('path');
const fs = require('fs');
const { Client } = require('@modelcontextprotocol/sdk/client');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');

const CLIENT_INFO = { name: 'pecado-ai', version: '1.0.0' };
const DEFAULT_TREE_EXCLUDES = ['node_modules', '.git', 'dist', 'release', 'build', '.cursor', 'coverage'];

/** @type {import('@modelcontextprotocol/sdk/client/index.js').Client | null} */
let client = null;
/** @type {import('@modelcontextprotocol/sdk/client/stdio.js').StdioClientTransport | null} */
let transport = null;
let projectRoot = '';
let toolNames = [];
let connectPromise = null;

function getFilesystemServerEntry() {
  const pkgJson = require.resolve('@modelcontextprotocol/server-filesystem/package.json');
  return path.join(path.dirname(pkgJson), 'dist', 'index.js');
}

/** Electron 打包后用 execPath + ELECTRON_RUN_AS_NODE；开发/脚本里可用系统 node */
function getMcpSpawnCommand() {
  if (process.versions.electron) {
    return process.execPath;
  }
  return process.platform === 'win32' ? 'node.exe' : 'node';
}

function getMcpSpawnEnv() {
  const env = { ...process.env };
  if (process.versions.electron) {
    env.ELECTRON_RUN_AS_NODE = '1';
  }
  return env;
}

function extractToolText(result) {
  if (!result || result.isError) {
    const msg = (result?.content || [])
      .filter((c) => c && c.type === 'text' && c.text)
      .map((c) => c.text)
      .join('\n');
    throw new Error(msg || 'MCP 工具返回错误');
  }
  return (result.content || [])
    .filter((c) => c && c.type === 'text' && c.text)
    .map((c) => c.text)
    .join('\n');
}

async function disconnect() {
  connectPromise = null;
  toolNames = [];
  projectRoot = '';
  if (client) {
    try {
      await client.close();
    } catch (_) {}
    client = null;
  }
  transport = null;
}

/**
 * @param {string} root 绝对路径
 */
async function connect(root) {
  const absRoot = path.resolve(String(root || '').trim());
  if (!absRoot) throw new Error('工程目录不能为空');
  try {
    const st = fs.statSync(absRoot);
    if (!st.isDirectory()) throw new Error('路径不是目录');
  } catch (e) {
    if (e.code === 'ENOENT') throw new Error(`目录不存在：${absRoot}`);
    throw e;
  }

  if (connectPromise) await connectPromise;
  if (client && projectRoot === absRoot) {
    return { projectRoot: absRoot, tools: toolNames };
  }

  connectPromise = (async () => {
    await disconnect();
    const serverEntry = getFilesystemServerEntry();
    transport = new StdioClientTransport({
      command: getMcpSpawnCommand(),
      args: [serverEntry, absRoot],
      env: getMcpSpawnEnv(),
      stderr: 'pipe',
    });
    client = new Client(CLIENT_INFO, { capabilities: {} });
    await client.connect(transport);
    const listed = await client.listTools();
    toolNames = (listed.tools || []).map((t) => t.name);
    projectRoot = absRoot;
    console.log('[mcp-fs] connected', absRoot, 'tools:', toolNames.length);
    return { projectRoot: absRoot, tools: toolNames };
  })();

  try {
    return await connectPromise;
  } finally {
    connectPromise = null;
  }
}

function getStatus() {
  return {
    connected: !!client,
    projectRoot: projectRoot || null,
    tools: [...toolNames],
  };
}

function ensureConnected() {
  if (!client) throw new Error('MCP 文件系统未连接，请先选择工程目录');
}

/**
 * @param {string} name
 * @param {Record<string, unknown>} [args]
 */
async function callTool(name, args = {}) {
  ensureConnected();
  const result = await client.callTool({
    name: String(name),
    arguments: args && typeof args === 'object' ? args : {},
  });
  return result;
}

/**
 * @param {string} name
 * @param {Record<string, unknown>} [args]
 * @returns {Promise<string>} 工具返回的文本内容
 */
async function callToolText(name, args = {}) {
  const result = await callTool(name, args);
  return extractToolText(result);
}

async function directoryTree(opts = {}) {
  ensureConnected();
  const excludePatterns = Array.isArray(opts.excludePatterns)
    ? opts.excludePatterns
    : DEFAULT_TREE_EXCLUDES;
  const treePath = opts.path ? path.resolve(String(opts.path)) : projectRoot;
  const text = await callToolText('directory_tree', { path: treePath, excludePatterns });
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function readTextFile(filePath, opts = {}) {
  const args = { path: String(filePath) };
  if (opts.head != null) args.head = opts.head;
  if (opts.tail != null) args.tail = opts.tail;
  return callToolText('read_text_file', args);
}

async function writeFile(filePath, content) {
  return callToolText('write_file', {
    path: String(filePath),
    content: content == null ? '' : String(content),
  });
}

async function listAllowedDirectories() {
  return callToolText('list_allowed_directories', {});
}

async function listTools() {
  ensureConnected();
  const listed = await client.listTools();
  return listed.tools || [];
}

module.exports = {
  DEFAULT_TREE_EXCLUDES,
  connect,
  disconnect,
  getStatus,
  callTool,
  callToolText,
  directoryTree,
  readTextFile,
  writeFile,
  listAllowedDirectories,
  listTools,
};
