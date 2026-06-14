/**
 * @file skill-log.js
 * @deprecated 请使用 shared/agent-log.js；保留 re-export 兼容旧引用
 */
const { emitAgentLog } = require('../../shared/agent-log');

module.exports = { emitSkillLog: emitAgentLog, emitAgentLog };
