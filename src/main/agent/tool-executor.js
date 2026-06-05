/**
 * @file tool-executor.js
 * @domain agent
 *
 * Agent 工具执行：读/写/建目录（经 mcp-filesystem）+ macOS Xcode 集成。
 */
const projectIo = require('../mcp-filesystem');
const { getMainWindow } = require('../mcp-filesystem/ipc');
const { confirmCreateOperation, integrateAfterCreate } = require('../xcode/prompt');
const xcodeProject = require('../xcode/project');

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
async function executeTool(name, args, opts = {}) {
  const projectRoot = projectIo.getStatus().projectRoot;
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
    const abs = projectIo.resolveUnderProject(projectRoot, relPath);
    await projectIo.writeWholeFileToDisk(abs, args.content);
    result = {
      content: [{ type: 'text', text: `Successfully wrote to ${args.path}` }],
    };
  } else {
    result = await projectIo.callTool(name, args);
  }

  if (xcodeIntegrate && xcodeMeta && (isCreateDir || isWriteFile) && relPath) {
    result = appendXcodeIntegrateNote(result, name, relPath, projectRoot, xcodeMeta);
  }

  return result;
}

module.exports = { executeTool };
