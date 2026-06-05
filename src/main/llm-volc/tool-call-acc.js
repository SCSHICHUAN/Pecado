/**
 * @file tool-call-acc.js
 * @domain volc
 *
 * SSE delta.tool_calls 按 index 累积为完整 tool_call。
 */

function createToolCallAccumulator() {
  /** @type {Map<number, { id: string, type: string, function: { name: string, arguments: string } }>} */
  const byIndex = new Map();

  function merge(deltaToolCalls) {
    if (!Array.isArray(deltaToolCalls)) return;
    for (const tc of deltaToolCalls) {
      const idx = tc.index ?? 0;
      if (!byIndex.has(idx)) {
        byIndex.set(idx, {
          id: '',
          type: 'function',
          function: { name: '', arguments: '' },
        });
      }
      const acc = byIndex.get(idx);
      if (tc.id) acc.id += tc.id;
      if (tc.type) acc.type = tc.type;
      if (tc.function?.name) acc.function.name += tc.function.name;
      if (tc.function?.arguments != null) acc.function.arguments += tc.function.arguments;
    }
  }

  function getAt(index) {
    return byIndex.get(index) || null;
  }

  function toArray() {
    return [...byIndex.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([index, v]) => ({
        index,
        id: v.id,
        type: v.type || 'function',
        function: { name: v.function.name, arguments: v.function.arguments },
      }));
  }

  return { merge, getAt, toArray, size: () => byIndex.size };
}

module.exports = { createToolCallAccumulator };
