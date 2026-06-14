/**
 * @file index.js
 * 【功能】Skill 模块门面（存储 / 生成 / Agent）
 */
module.exports = {
  ...require('./service'),
  ...require('./store'),
  ...require('./resources'),
  ...require('./document'),
  ...require('./generate'),
  ...require('./llm-meta'),
  ...require('./agent/tools'),
  ...require('./agent/context'),
};
