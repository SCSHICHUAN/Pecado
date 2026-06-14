/**
 * @file index.js
 * 【功能】xcode 模块门面（工程 / 流式写盘 / Agent 工具）
 */
const { XCODE_AGENT_GUIDE } = require('./agent/guide');

module.exports = {
  ...require('./project'),
  ...require('./prompt'),
  ...require('./stream'),
  ...require('./paths'),
  ...require('./agent/tools'),
  XCODE_AGENT_GUIDE,
};
