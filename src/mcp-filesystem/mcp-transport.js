/**
 * @file mcp-transport.js
 *
 * 【功能】MCP 协议 stdio 传输：spawn @modelcontextprotocol/server-filesystem 子进程并维护 Client 生命周期。
 *   - Electron 下用 process.execPath + ELECTRON_RUN_AS_NODE=1；否则系统 node
 *   - connect(root)：单例 connectPromise 防并发；disconnect 关闭 client
 *   - callTool / callToolText：后者提取 content[].text 拼接，isError 时 throw
 *   - getStatus() → { connected, projectRoot, toolNames }
 *
 * 【调用方】mcp-filesystem/index.js 再导出；read.js / write.js 经 callToolText 间接调用
 *
 * 【对外能力】
 *   connect(absRoot) → { projectRoot, tools }
 *   disconnect() / getStatus() / listTools() / callTool(name, args) / callToolText(name, args)
 */
const path = require('path');
const fs = require('fs');
const { Client } = require('@modelcontextprotocol/sdk/client');
const { StdioClientTransport } = require('@modelcontextprotocol/sdk/client/stdio.js');

const CLIENT_INFO = { name: 'pecado', version: '1.0.0' };

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

async function listTools() {
  ensureConnected();
  const listed = await client.listTools();
  return listed.tools || [];
}

module.exports = {
  connect,
  disconnect,
  getStatus,
  callTool,
  callToolText,
  listTools,
};
