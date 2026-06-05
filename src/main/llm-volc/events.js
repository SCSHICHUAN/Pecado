/**
 * @file events.js
 * @domain volc
 *
 * 火山流式对话对外事件类型（与 Electron / MCP / Xcode 无关）。
 */

/** @typedef {'text_delta' | 'tool_call_delta' | 'round_complete' | 'error'} VolcEventType */

/**
 * @typedef {object} VolcTextDeltaEvent
 * @property {'text_delta'} type
 * @property {string} text
 */

/**
 * @typedef {object} VolcToolCallDeltaEvent
 * @property {'tool_call_delta'} type
 * @property {number} index
 * @property {string} [id]
 * @property {string} [name]
 * @property {string} [argumentsFragment]
 * @property {{ function?: { name?: string, arguments?: string } } | null} accumulated
 */

/**
 * @typedef {object} VolcRoundCompleteEvent
 * @property {'round_complete'} type
 * @property {string|null} finishReason
 * @property {string} content
 * @property {Array<object>} toolCalls
 */

/**
 * @typedef {object} VolcErrorEvent
 * @property {'error'} type
 * @property {string} message
 */

/** @typedef {VolcTextDeltaEvent | VolcToolCallDeltaEvent | VolcRoundCompleteEvent | VolcErrorEvent} VolcStreamEvent */

module.exports = {};
