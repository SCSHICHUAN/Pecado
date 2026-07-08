/**
 * @file codx-edit-ops.js
 * CodX 行级编辑：insert_code / del_code / insert_blanks / edit_code（从 start 本行）
 */

const { blankLinesText } = require('./codx-stream-ops');

function inferCodxOp(ed) {
  const op = String(ed?.op || ed?.streamOp || '').toLowerCase();
  if (op === 'insert_code') return 'insert_code';
  if (op === 'del_code') return 'del_code';
  if (op === 'insert_blanks') return 'insert_blanks';
  if (op === 'edit_code') return 'edit_code';
  return 'insert_code';
}

function enrichCodxEditForApply(ed) {
  const startLine = Math.max(1, Math.floor(Number(ed?.startLine ?? ed?.line_start) || 1));
  const text = String(ed?.streamText ?? ed?.text ?? '');
  const op = inferCodxOp(ed);
  const planEnd = ed?.endLine ?? ed?.line_end;
  const endLine =
    planEnd != null && Number(planEnd) >= startLine ? Math.floor(Number(planEnd)) : startLine;

  if (op === 'del_code') {
    return { ...ed, op: 'del_code', startLine, endLine, streamText: '' };
  }
  if (op === 'insert_blanks') {
    const blankCount = Math.max(1, endLine - startLine + 1);
    return {
      ...ed,
      op: 'insert_blanks',
      startLine,
      endLine: startLine,
      streamText: text || blankLinesText(blankCount),
    };
  }
  if (op === 'insert_code') {
    return { ...ed, op: 'insert_code', startLine, endLine: startLine, streamText: text };
  }
  if (op === 'edit_code') {
    return { ...ed, op: 'edit_code', startLine, endLine, streamText: text };
  }
  return { ...ed, op, startLine, endLine, streamText: text };
}

function applyCodxEditOpInner(content, ed) {
  const op = inferCodxOp(ed);
  const startLine = ed?.startLine;
  const endLine = ed?.endLine;
  const text = String(ed?.streamText ?? ed?.text ?? '');

  const lines = String(content ?? '').split('\n');
  const si = Math.max(1, Math.floor(Number(startLine) || 1));
  const startIdx = si - 1;

  if (op === 'insert_code' || op === 'insert_blanks') {
    lines.splice(startIdx, 0, ...text.split('\n'));
    return lines.join('\n');
  }

  const hasEnd =
    endLine != null && Number.isFinite(Number(endLine)) && Number(endLine) >= Number(startLine);
  const ei = hasEnd ? Math.max(startIdx, Math.floor(Number(endLine)) - 1) : startIdx;

  if (op === 'del_code') {
    lines.splice(startIdx, ei - startIdx + 1);
    return lines.join('\n');
  }

  return lines.join('\n');
}

function applyCodxEditOp(content, ed) {
  const enriched = enrichCodxEditForApply(ed);
  const op = inferCodxOp(enriched);

  if (op === 'edit_code') {
    const deleted = applyCodxEditOpInner(content, {
      ...enriched,
      op: 'del_code',
      streamText: '',
    });
    return applyCodxEditOpInner(deleted, {
      ...enriched,
      op: 'insert_code',
      endLine: enriched.startLine,
    });
  }

  return applyCodxEditOpInner(content, enriched);
}

function computeCodxEditDeltaInner(ed) {
  const op = inferCodxOp(ed);
  const start = Math.max(1, Math.floor(Number(ed?.startLine) || 1));
  const end = ed?.endLine;
  const hasEnd = end != null && Number.isFinite(Number(end)) && Number(end) >= start;
  const repLines = hasEnd ? Math.floor(Number(end)) - start + 1 : 0;
  const insLines = String(ed?.streamText ?? ed?.text ?? '').split('\n').length;

  if (op === 'insert_code' || op === 'insert_blanks') return insLines;
  if (op === 'del_code') return -repLines;
  if (op === 'edit_code') return insLines - repLines;
  return insLines;
}

function computeCodxEditDelta(ed) {
  const enriched = enrichCodxEditForApply(ed);
  if (inferCodxOp(enriched) === 'edit_code') {
    const del = computeCodxEditDeltaInner({ ...enriched, op: 'del_code', streamText: '' });
    const ins = computeCodxEditDeltaInner({
      ...enriched,
      op: 'insert_code',
      endLine: enriched.startLine,
    });
    return del + ins;
  }
  return computeCodxEditDeltaInner(enriched);
}

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
    const delta = computeCodxEditDelta(raw);
    const rangeEnd =
      op === 'insert_code' || op === 'insert_blanks'
        ? start - 1
        : hasEnd
          ? Math.floor(Number(end))
          : start;

    if (ol > rangeEnd) offset += delta;
    else if (op === 'edit_code' && hasEnd && ol >= start && ol <= Math.floor(Number(end))) {
      return start + offset;
    }
  }
  return ol + offset;
}

module.exports = {
  inferCodxOp,
  applyCodxEditOp,
  computeCodxEditDelta,
  mapOriginalLineToCurrent,
  enrichCodxEditForApply,
};
