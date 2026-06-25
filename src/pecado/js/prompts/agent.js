/**
 * @file agent.js
 * Agent 模式 system：通用能力说明（非逐步剧本）
 */
const { buildCapabilityAgentPrompt } = require('../../../agent-loop/capability-prompt');

const AGENT_SYSTEM_PROMPT = buildCapabilityAgentPrompt();

module.exports = { AGENT_SYSTEM_PROMPT, buildCapabilityAgentPrompt };
