/**
 * @file codx-edit-ops.js
 * CodX 行级编辑：add / edit / delete，行号相对 read 原文，偏移由调用方累计。
 */

/**
 * @param {{ op?: string, startLine?: number, endLine?: number | null, text?: string, streamText?: string }} ed
 * @returns {'add' | 'edit' | 'delete'}
 */
function inferCodxOp(ed) {
  const raw = String(ed?.op || '').toLowerCase();
  if (raw === 'add' || raw === 'insert') return 'add';
  if (raw === 'edit' || raw === 'replace') return 'edit';
  if (raw === 'delete' || raw === 'remove') return 'delete';

  const start = Math.max(1, Math.floor(Number(ed?.startLine) || 1));
  const end = ed?.endLine;
  const hasEnd = end != null && Number.isFinite(Number(end)) && Number(end) >= start;
  const text = ed?.streamText ?? ed?.text;
  if (text != null && String(text).length > 0) return 'edit';
  if (!hasEnd) return 'edit';
  if (text === '' || text == null) return 'delete';
  return 'edit';
}

/**
 * @param {string} content
 * @param {{ op?: string, startLine?: number, endLine?: number | null, text?: string, streamText?: string }} ed
 */
function applyCodxEditOp(content, ed) {
  return applyCodxEditOpInner(content, enrichCodxEditForApply(ed));
}

function applyCodxEditOpInner(content, ed) {
  const op = inferCodxOp(ed);
  const startLine = ed?.startLine;
  const endLine = ed?.endLine;
  const text = String(ed?.streamText ?? ed?.text ?? '');

  const lines = String(content ?? '').split('\n');
  const si = Math.max(1, Math.floor(Number(startLine) || 1)) - 1;

  if (op === 'add') {
    const ins = text.split('\n');
    lines.splice(si, 0, ...ins);
    return lines.join('\n');
  }

  const hasEnd =
    endLine != null && Number.isFinite(Number(endLine)) && Number(endLine) >= Number(startLine);
  const ei = hasEnd ? Math.max(si, Math.floor(Number(endLine)) - 1) : si;

  if (op === 'delete') {
    lines.splice(si, ei - si + 1);
    return lines.join('\n');
  }

  const ins = text.split('\n');
  lines.splice(si, ei - si + 1, ...ins);
  return lines.join('\n');
}

/**
 * @param {{ op?: string, startLine?: number, endLine?: number | null, text?: string, streamText?: string }} ed
 * @returns {number}
 */
function computeCodxEditDelta(ed) {
  return computeCodxEditDeltaInner(enrichCodxEditForApply(ed));
}

function computeCodxEditDeltaInner(ed) {
  const op = inferCodxOp(ed);
  const start = Math.max(1, Math.floor(Number(ed?.startLine) || 1));
  const end = ed?.endLine;
  const hasEnd = end != null && Number.isFinite(Number(end)) && Number(end) >= start;
  const repLines = hasEnd ? Math.floor(Number(end)) - start + 1 : 0;
  const insLines = String(ed?.streamText ?? ed?.text ?? '').split('\n').length;

  if (op === 'add') return insLines;
  if (op === 'delete') return -repLines;
  return insLines - repLines;
}

/**
 * 原文行号 → 应用指定 edits 后当前文档行号（用于 Monaco 锚点 / 滚动）
 * @param {number} originalLine
 * @param {Array<{ op?: string, startLine?: number, endLine?: number | null, streamText?: string, text?: string, complete?: boolean }>} edits
 * @param {{ completeOnly?: boolean, beforeArrayIndex?: number }} [opts]
 */
function mapOriginalLineToCurrent(originalLine, edits, opts = {}) {
  const ol = Math.max(1, Math.floor(Number(originalLine) || 1));
  if (!edits?.length) return ol;

  const { completeOnly = true, beforeArrayIndex = -1 } = opts;
  let offset = 0;
  const sorted = edits
    .map((ed, arrayIndex) => ({ ed: enrichCodxEditForApply(ed), arrayIndex, raw: ed }))
    .sort((a, b) => {
      const d = (a.ed.startLine || 0) - (b.ed.startLine || 0);
      return d !== 0 ? d : a.arrayIndex - b.arrayIndex;
    });

  for (const { ed, arrayIndex, raw } of sorted) {
    if (completeOnly && !raw.complete) continue;
    if (beforeArrayIndex >= 0 && arrayIndex >= beforeArrayIndex) continue;

    const op = inferCodxOp(ed);
    const start = Math.max(1, Math.floor(Number(ed.startLine) || 1));
    const end = ed.endLine;
    const hasEnd = end != null && Number.isFinite(Number(end)) && Number(end) >= start;
    const delta = computeCodxEditDeltaInner(ed);
    const rangeEnd = op === 'add' ? start - 1 : hasEnd ? Math.floor(Number(end)) : start;

    if (ol > rangeEnd) offset += delta;
    else if (op !== 'add' && hasEnd && ol >= start && ol <= Math.floor(Number(end))) {
      return start + offset;
    }
  }
  return ol + offset;
}

/**
 * 按 line_start + 流式 text 推断 replace 范围（写隔离：每段只改自己的行块）
 * @param {{ startLine?: number, endLine?: number, streamText?: string, text?: string, complete?: boolean, op?: string }} ed
 */
function enrichCodxEditForApply(ed) {
  const startLine = Math.max(1, Math.floor(Number(ed?.startLine) || 1));
  const text = String(ed?.streamText ?? ed?.text ?? '');
  const explicitOp = String(ed?.op || '').toLowerCase();
  if (explicitOp === 'delete' || explicitOp === 'remove') {
    const endLine =
      ed?.endLine != null && Number(ed.endLine) >= startLine
        ? Math.floor(Number(ed.endLine))
        : startLine;
    return { ...ed, op: 'delete', startLine, endLine };
  }
  if (!text) {
    return { ...ed, op: 'edit', startLine, endLine: startLine };
  }
  const lineCount = text.split('\n').length;
  return {
    ...ed,
    op: 'edit',
    startLine,
    endLine: startLine + lineCount - 1,
  };
}

module.exports = {
  inferCodxOp,
  applyCodxEditOp,
  computeCodxEditDelta,
  mapOriginalLineToCurrent,
  enrichCodxEditForApply,
};
