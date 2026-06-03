/**
 * @file tools-schema.js
 *
 * MCP listTools → 火山 Function Calling 的 tools 数组。
 * 火山 tools 格式（OpenAI 兼容）:
 *   { type:"function", function:{ name, description, parameters:JSONSchema } }
 * parameters 来自 MCP 的 inputSchema（见 listTools 返回）。
 */

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

module.exports = { mcpToolsToFunctionTools, sanitizeJsonSchema };
