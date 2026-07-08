/**
 * @file read-text-file.js
 * Agent read_text_file 唯一入口：CodX 已打开 → Monaco；否则 → 磁盘。
 * 统一 L 行号格式与 head/tail 截断。
 */
const projectIo = require('../mcp-filesystem');
const { prepareMcpToolPath } = require('../mcp-filesystem/read');
const { formatWithLineNumbers } = require('../shared/line-numbers');

const READ_TEXT_TOOL_NAMES = new Set(['read_text_file', 'read_file']);

function isReadTextFileToolName(name) {
  return READ_TEXT_TOOL_NAMES.has(String(name || ''));
}

/**
 * @param {string} text
 * @param {{ head?: number, tail?: number }} [opts]
 */
function applyHeadTailSlice(text, opts = {}) {
  const lines = String(text ?? '').split('\n');
  const head = opts.head;
  const tail = opts.tail;
  if (head != null && Number.isFinite(Number(head))) {
    return lines.slice(0, Math.max(0, Math.floor(Number(head)))).join('\n');
  }
  if (tail != null && Number.isFinite(Number(tail))) {
    const n = Math.max(0, Math.floor(Number(tail)));
    return lines.slice(Math.max(0, lines.length - n)).join('\n');
  }
  return String(text ?? '');
}

function formatReadObservation(rawText, opts = {}) {
  const sliced = applyHeadTailSlice(rawText, opts);
  return formatWithLineNumbers(sliced);
}

/**
 * @param {string} relPath
 * @param {import('electron').WebContents} [sender]
 * @returns {Promise<{ content: string, relPath: string } | null>}
 */
async function readFromCodxMonaco(relPath, sender) {
  if (!relPath || !sender || sender.isDestroyed()) return null;
  try {
    const result = await sender.executeJavaScript(
      `(window.CodXEditor && window.CodXEditor.readTextForAgent(${JSON.stringify(relPath)})) || null`
    );
    if (!result || result.content == null) return null;
    return {
      content: String(result.content),
      relPath: String(result.relPath || relPath),
    };
  } catch (_) {
    return null;
  }
}

/**
 * @param {object} args
 * @param {string} projectRoot
 */
async function readFromDisk(args, projectRoot) {
  const rawPath = args?.path != null ? String(args.path).trim() : '';
  if (!rawPath) {
    throw new Error('read_text_file：缺少 path');
  }
  const callArgs = { path: prepareMcpToolPath(rawPath, projectRoot) };
  if (args.head != null) callArgs.head = args.head;
  if (args.tail != null) callArgs.tail = args.tail;

  let raw;
  if (args.head != null || args.tail != null) {
    raw = await projectIo.callToolText('read_text_file', callArgs);
  } else {
    raw = await projectIo.readText(callArgs.path);
  }

  return { content: String(raw ?? ''), source: 'disk' };
}

/**
 * @param {import('./task-dispatcher').RoutedTask} routedTask
 * @param {{ streamContext?: object, sender?: import('electron').WebContents }} [execOpts]
 */
async function EXECUTE_read_text_file(routedTask, execOpts = {}) {
  const { name, args } = routedTask.task;
  if (!isReadTextFileToolName(name)) {
    return {
      isError: true,
      content: [{ type: 'text', text: `read-text-file：非读文件工具 ${name}` }],
    };
  }

  const projectRoot = projectIo.getStatus().projectRoot;
  const readPath = args?.path != null ? String(args.path).trim() : '';
  const sliceOpts = {
    head: args?.head,
    tail: args?.tail,
  };

  if (!readPath) {
    try {
      const disk = await readFromDisk(args, projectRoot);
      const mcpSliced = args?.head != null || args?.tail != null;
      const text = mcpSliced
        ? formatWithLineNumbers(disk.content)
        : formatReadObservation(disk.content, sliceOpts);
      return { content: [{ type: 'text', text }], readSource: 'disk' };
    } catch (e) {
      return {
        isError: true,
        content: [{ type: 'text', text: e.message || String(e) }],
      };
    }
  }

  const codx = await readFromCodxMonaco(readPath, execOpts.sender);
  if (codx) {
    const text = formatReadObservation(codx.content, sliceOpts);
    return {
      content: [{ type: 'text', text }],
      readSource: 'codx',
    };
  }

  try {
    const disk = await readFromDisk(args, projectRoot);
    const mcpSliced = args?.head != null || args?.tail != null;
    const text = mcpSliced
      ? formatWithLineNumbers(disk.content)
      : formatReadObservation(disk.content, sliceOpts);
    return {
      content: [{ type: 'text', text }],
      readSource: 'disk',
    };
  } catch (e) {
    return {
      isError: true,
      content: [{ type: 'text', text: e.message || String(e) }],
    };
  }
}

module.exports = {
  isReadTextFileToolName,
  EXECUTE_read_text_file,
  formatReadObservation,
};
