/**
 * @file format.js
 *
 * 【功能】送入火山 API 前的数据格式化（llm-server 内部，不对外 export）。
 *   - normalizeMessageContent：string / text[] / null → API 可接受的 string
 *   - sanitizeToolCallsForApi：补全 id、type、function.name/arguments 默认值
 *   - sanitizeMessagesForVolcApi：assistant+tool_calls、tool 角色、普通 role 分支处理
 *   - mcpToolsToFunctionTools：MCP listTools 结果 → OpenAI 风格 { type:'function', function:{...} }
 *   - sanitizeJsonSchema：裁剪 inputSchema 为 API 允许的 JSON Schema 子集
 *   - resolveToolsForApi：opts.tools 优先，否则 mcpTools 转换
 *
 * 【调用方】llm-server/http.js（messages）；llm-server/stream.js（tools/mcpTools）
 *
 * 【对外能力】module.exports 供 llm-server 子模块 require；agent 不应直接依赖本文件
 */

/** @param {unknown} content */
function normalizeMessageContent(content) {
  if (content == null) return '';
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const hasImage = content.some(
      (p) => p && p.type === 'image_url' && p.image_url
    );
    if (hasImage) {
      return content.filter(
        (p) => p && (p.type === 'text' || p.type === 'image_url')
      );
    }
    return content
      .map((p) => (p && p.type === 'text' && p.text != null ? String(p.text) : ''))
      .join('');
  }
  return String(content);
}

/** @param {unknown} toolCalls */
function sanitizeToolCallsForApi(toolCalls) {
  if (!Array.isArray(toolCalls)) return [];
  return toolCalls.map((tc) => ({
    id: tc.id || '',
    type: tc.type || 'function',
    function: {
      name: tc.function?.name || '',
      arguments: tc.function?.arguments ?? '{}',
    },
  }));
}

/** @param {Array<Record<string, unknown>>} messages */
function sanitizeMessagesForVolcApi(messages) {
  return messages.map((m) => {
    const role = m.role;
    if (role === 'assistant' && Array.isArray(m.tool_calls) && m.tool_calls.length) {
      return {
        role: 'assistant',
        content: normalizeMessageContent(m.content),
        tool_calls: sanitizeToolCallsForApi(m.tool_calls),
      };
    }
    if (role === 'tool') {
      const text = normalizeMessageContent(m.content);
      return {
        role: 'tool',
        tool_call_id: m.tool_call_id,
        content: text || '(empty tool result)',
      };
    }
    return {
      role,
      content: normalizeMessageContent(m.content),
    };
  });
}

/** @param {unknown} schema */
function sanitizeJsonSchema(schema) {
  if (!schema || typeof schema !== 'object') {
    return { type: 'object', properties: {} };
  }
  /** @type {Record<string, unknown>} */
  const out = { type: schema.type || 'object' };
  if (schema.properties && typeof schema.properties === 'object') {
    out.properties = schema.properties;
  } else {
    out.properties = {};
  }
  if (Array.isArray(schema.required)) out.required = schema.required;
  if (typeof schema.description === 'string') out.description = schema.description;
  return out;
}

/**
 * @param {Array<{ name: string, description?: string, inputSchema?: object }>} mcpTools
 * @returns {Array<{ type: 'function', function: object }>}
 */
function mcpToolsToFunctionTools(mcpTools) {
  if (!Array.isArray(mcpTools)) return [];
  return mcpTools
    .filter((t) => t && typeof t.name === 'string' && t.name.trim())
    .map((t) => ({
      type: 'function',
      function: {
        name: t.name,
        description: t.description || `MCP tool: ${t.name}`,
        parameters: sanitizeJsonSchema(t.inputSchema),
      },
    }));
}

/**
 * @param {{ tools?: Array<object>, mcpTools?: Array<object> }} opts
 * @returns {Array<object> | undefined}
 */
function resolveToolsForApi(opts) {
  if (opts.tools?.length) return opts.tools;
  if (opts.mcpTools?.length) return mcpToolsToFunctionTools(opts.mcpTools);
  return undefined;
}

module.exports = {
  sanitizeMessagesForVolcApi,
  sanitizeToolCallsForApi,
  mcpToolsToFunctionTools,
  resolveToolsForApi,
};
