/**
 * @file index.js
 *
 * 【功能】xcode 模块门面：工程发现、pbxproj 修改、流式写盘、确认对话框。
 */
const project = require('./project');
const prompt = require('./prompt');
const liveStream = require('./live-stream');
const pathParse = require('./path-parse');

module.exports = {
  ...project,
  ...prompt,
  ...liveStream,
  ...pathParse,
};
