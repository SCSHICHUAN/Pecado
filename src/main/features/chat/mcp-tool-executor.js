/**
 * @file mcp-tool-executor.js
 * @domain chat
 *
 * 执行 MCP 工具调用（含 macOS 写盘策略与 Xcode 工程集成）。
 */
const mcpFs = require('../../mcp/filesystem-client');
const { resolveUnderProject } = require('../../mcp/project-path');
const xcodeWrite = require('../../mcp/xcode-write-stream');
const { getMainWindow } = require('../../mcp/context');
const { confirmCreateOperation, integrateAfterCreate } = require('../../mcp/xcode-prompt');
const xcodeProject = require('../../mcp/xcode-project');

const IS_DARWIN = process.platform === 'darwin';

function appendXcodeIntegrateNote(result, kind, relPath, projectRoot, xcodeMeta) {
  if (!xcodeMeta || !relPath) return result;
  const r = integrateAfterCreate(xcodeMeta, kind, relPath, projectRoot);
  let suffix = '';
  if (r.ok && !r.already) suffix = `\n已加入 Xcode 工程（${r.path}）。`;
  else if (r.already) suffix = '\n已在 Xcode 工程中。';
  else if (r.skipped) suffix = `\n${r.reason}`;
  else if (!r.ok) suffix = `\n加入 Xcode 失败：${r.reason}`;

  if (!suffix) return result;
  if (result?.content?.[0]?.text != null) {
    result.content[0].text += suffix;
  } else if (typeof result === 'object' && result.content) {
    result.content.push({ type: 'text', text: suffix.trim() });
  }
  return result;
}

/**
 * @param {string} name
 * @param {Record<string, unknown>} args
 * @param {{
 *   alreadyStreamedToDisk?: boolean,
 *   xcodeIntegrate?: boolean,
 *   xcodeMeta?: object|null,
 *   cancelled?: boolean,
 *   skipPrompt?: boolean,
 * }} [opts]
 */
async function executeMcpTool(name, args, opts = {}) {
  const projectRoot = mcpFs.getStatus().projectRoot;
  const relPath = args?.path != null ? String(args.path) : '';

  if (opts.cancelled) {
    return {
      isError: true,
      content: [{ type: 'text', text: '用户取消了创建操作。' }],
    };
  }

  if (opts.alreadyStreamedToDisk && name === 'write_file') {
    let result = {
      content: [{ type: 'text', text: `Successfully wrote to ${args.path}` }],
    };
    if (opts.xcodeIntegrate && opts.xcodeMeta) {
      result = appendXcodeIntegrateNote(result, 'write_file', relPath, projectRoot, opts.xcodeMeta);
    }
    return result;
  }

  const isCreateDir = name === 'create_directory';
  const isWriteFile = name === 'write_file';
  const isNewPath = relPath && !xcodeProject.pathExistsUnderRoot(projectRoot, relPath);

  let xcodeIntegrate = !!opts.xcodeIntegrate;
  let xcodeMeta = opts.xcodeMeta || null;

  if ((isCreateDir || isWriteFile) && isNewPath && !opts.skipPrompt) {
    const confirm = confirmCreateOperation(getMainWindow(), name, projectRoot, relPath);
    if (!confirm.proceed) {
      return {
        isError: true,
        content: [{ type: 'text', text: confirm.message }],
      };
    }
    xcodeIntegrate = confirm.integrateXcode;
    xcodeMeta = confirm.xcodeMeta;
    console.log('[xcode-prompt]', confirm.message);
  }

  let result;
  if (IS_DARWIN && isWriteFile && relPath) {
    const abs = resolveUnderProject(projectRoot, relPath);
    await xcodeWrite.writeWholeFileStreaming(abs, args.content);
    result = {
      content: [{ type: 'text', text: `Successfully wrote to ${args.path}` }],
    };
  } else {
    result = await mcpFs.callTool(name, args);
  }

  if (xcodeIntegrate && xcodeMeta && (isCreateDir || isWriteFile) && relPath) {
    result = appendXcodeIntegrateNote(result, name, relPath, projectRoot, xcodeMeta);
  }

  return result;
}

module.exports = { executeMcpTool };
