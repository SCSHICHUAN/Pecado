/**
 * @file prompt.js
 *
 * 【功能】新建文件/目录前的用户确认 + 写入后 Xcode 工程集成。
 *   - confirmCreateOperation：findXcodeProject 无则直接 proceed；有则三按钮对话框
 *       「加入 Xcode 工程」|「仅写入磁盘」|「取消」
 *   - integrateAfterCreate：toXcodeRelPath → addFileToProject / addDirectoryToProject → openXcodeProject
 *   - 返回 proceed/integrateXcode/xcodeMeta/message 供 tool-executor 与 live-stream 使用
 *
 * 【调用方】xcode/live-stream.js（write_file 流式新建）；agent/tool-executor.js（MCP tool 执行前）
 *
 * 【对外能力】
 *   confirmCreateOperation(browserWindow, 'create_directory'|'write_file', projectRoot, relPath)
 *   → { proceed, integrateXcode, xcodeMeta, message }
 *   integrateAfterCreate(xcodeMeta, kind, relPath, projectRoot)
 *   → { ok, already?, skipped?, reason?, path? }
 */
const path = require('path');
const { dialog } = require('electron');
const xcodeProject = require('./project');

/** @returns {0|1|2} 0=加入 Xcode  1=仅磁盘  2=取消 */
function promptCreateChoiceSync(browserWindow, kind, relPath, xcodeMeta) {
  const isDir = kind === 'create_directory';
  const title = isDir ? '创建文件夹' : '创建文件';
  const detail =
    `路径：${relPath}\n\n` +
    `Xcode 工程：${xcodeMeta.name}.xcodeproj\n` +
    `选择「加入 Xcode 工程」将更新 project.pbxproj 并打开 Xcode。`;

  const opts = {
    type: 'question',
    title: 'Xcode 工程',
    message: `${title}：${relPath}`,
    detail,
    buttons: ['加入 Xcode 工程', '仅写入磁盘', '取消'],
    defaultId: 0,
    cancelId: 2,
    noLink: true,
  };

  const win = browserWindow && !browserWindow.isDestroyed() ? browserWindow : null;
  return win ? dialog.showMessageBoxSync(win, opts) : dialog.showMessageBoxSync(opts);
}

/**
 * @param {import('electron').BrowserWindow | null} browserWindow
 * @param {'create_directory'|'write_file'} kind
 * @param {string} projectRoot
 * @param {string} relPath
 * @returns {{ proceed: boolean, integrateXcode: boolean, xcodeMeta: object|null, message: string }}
 */
function confirmCreateOperation(browserWindow, kind, projectRoot, relPath) {
  const xcodeMeta = xcodeProject.findXcodeProject(projectRoot);
  if (!xcodeMeta) {
    return {
      proceed: true,
      integrateXcode: false,
      xcodeMeta: null,
      message: '未找到 .xcodeproj，已仅写入磁盘。',
    };
  }

  const choice = promptCreateChoiceSync(browserWindow, kind, relPath, xcodeMeta);
  if (choice === 2) {
    return {
      proceed: false,
      integrateXcode: false,
      xcodeMeta,
      message: '用户取消了创建操作。',
    };
  }

  return {
    proceed: true,
    integrateXcode: choice === 0,
    xcodeMeta,
    message: choice === 0 ? '将写入磁盘并加入 Xcode 工程。' : '将仅写入磁盘，不修改 Xcode 工程。',
  };
}

/**
 * @param {object} xcodeMeta
 * @param {'create_directory'|'write_file'} kind
 * @param {string} relPath 相对 MCP projectRoot
 * @param {string} projectRoot
 */
function integrateAfterCreate(xcodeMeta, kind, relPath, projectRoot) {
  if (!xcodeMeta) return { ok: false, reason: 'no xcode project' };

  const absPath = path.resolve(projectRoot, relPath);
  const xcodeRel = xcodeProject.toXcodeRelPath(xcodeMeta.xcodeRoot, absPath);
  if (!xcodeRel) {
    return { ok: false, reason: '路径不在 Xcode 工程根目录内' };
  }

  let result;
  if (kind === 'create_directory') {
    result = xcodeProject.addDirectoryToProject(xcodeMeta.pbxPath, xcodeRel);
  } else {
    result = xcodeProject.addFileToProject(xcodeMeta.pbxPath, xcodeRel, absPath);
  }

  if (result.ok) {
    xcodeProject.openXcodeProject(xcodeMeta.xcodeProjDir);
  }
  return result;
}

module.exports = {
  confirmCreateOperation,
  integrateAfterCreate,
};
