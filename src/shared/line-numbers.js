/**
 * @file line-numbers.js
 * 为 LLM 读文件输出添加行号前缀（L 格式，1-based）
 */

/**
 * @param {string} text
 * @param {number} [startLine=1]
 * @returns {string}
 */
function formatWithLineNumbers(text, startLine = 1) {
  const base = Math.max(1, Math.floor(startLine));
  const lines = String(text ?? '').split('\n');
  const width = Math.max(4, String(base + lines.length - 1).length);
  return lines
    .map((line, i) => {
      const n = String(base + i).padStart(width, ' ');
      return `L${n}|${line}`;
    })
    .join('\n');
}

module.exports = { formatWithLineNumbers };
