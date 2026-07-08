/**
 * @file codx-stream-ops.js
 * codx_edit 流：insert_code | edit_code | del_code | insert_blanks + pecado_block_end
 */

const PECADO_BLOCK_END = 'pecado_block_end';

const STREAM_OPS = ['insert_code', 'edit_code', 'del_code', 'insert_blanks'];

const PLAN_TO_STREAM = {
  insert_code: 'insert_code',
  edit_code: 'edit_code',
  del_code: 'del_code',
  insert_blanks: 'insert_blanks',
};

function stripPartialMarkerSuffix(text, marker = PECADO_BLOCK_END) {
  const s = String(text ?? '');
  for (let len = Math.min(marker.length - 1, s.length); len >= 1; len -= 1) {
    if (marker.startsWith(s.slice(-len))) return s.slice(0, -len);
  }
  return s;
}

function blankLinesText(count) {
  const n = Math.max(1, Math.floor(Number(count)) || 1);
  return Array(n).fill('').join('\n');
}

function canonicalStreamOp(head) {
  const h = String(head || '').trim().toLowerCase();
  if (STREAM_OPS.includes(h)) return h;
  return '';
}

/** 段首行是否为尚未收完的 op 关键词（如 insert / insert_co） */
function isPartialStreamOpPrefix(line) {
  const h = String(line || '').trim().toLowerCase();
  if (!h || canonicalStreamOp(h)) return false;
  return STREAM_OPS.some((op) => op.startsWith(h) && h.length < op.length);
}

function streamOpFromPlan(planEd) {
  const op = String(planEd?.op || '').toLowerCase();
  return PLAN_TO_STREAM[op] || '';
}

function planRangeDisplay(start, end) {
  const s = Math.floor(Number(start) || 1);
  const e = Math.floor(Number(end) || s);
  return e > s ? `${s}-${e}` : String(s);
}

function parseOpSegmentBody(body, complete) {
  const raw = String(body ?? '');
  const lines = raw.replace(/^\uFEFF/, '').split('\n');
  let i = 0;
  while (i < lines.length && !lines[i].trim()) i += 1;
  if (i >= lines.length) return { streamOp: '', streamText: '', complete };

  const head = lines[i].trim();
  const streamOp = canonicalStreamOp(head);
  if (streamOp) {
    if (streamOp === 'insert_code' || streamOp === 'edit_code') {
      return { streamOp, streamText: lines.slice(i + 1).join('\n'), complete };
    }
    return { streamOp, streamText: '', complete };
  }

  // 关键词还在流入：不写入 Monaco / streamText
  if (isPartialStreamOpPrefix(head)) {
    return { streamOp: '', streamText: lines.slice(i + 1).join('\n'), complete };
  }

  // 无段头（plan 已给 op）：整段视为代码
  return { streamOp: '', streamText: raw, complete };
}

function mergeOpSegmentWithPlan(parsed, planEd) {
  const complete = !!parsed.complete;
  const planStart = planEd?.startLine ?? planEd?.line_start ?? 1;
  const planEnd = planEd?.endLine ?? planEd?.line_end ?? planStart;
  const rangeText = planRangeDisplay(planStart, planEnd);
  const streamOp = parsed.streamOp || streamOpFromPlan(planEd);

  if (streamOp === 'del_code') {
    return {
      ...(planEd || {}),
      op: 'del_code',
      streamOp,
      startLine: planStart,
      line_start: planStart,
      endLine: planEnd,
      line_end: planEnd,
      rangeText,
      streamText: '',
      complete,
    };
  }

  if (streamOp === 'insert_blanks') {
    const blankCount = Math.max(1, planEnd - planStart + 1);
    return {
      ...(planEd || {}),
      op: 'insert_blanks',
      streamOp,
      startLine: planStart,
      line_start: planStart,
      endLine: planEnd,
      line_end: planEnd,
      rangeText,
      blankCount,
      streamText: complete ? blankLinesText(blankCount) : '',
      complete,
    };
  }

  if (streamOp === 'edit_code') {
    return {
      ...(planEd || {}),
      op: 'edit_code',
      streamOp,
      startLine: planStart,
      line_start: planStart,
      endLine: planEnd,
      line_end: planEnd,
      rangeText,
      streamText: parsed.streamText ?? '',
      complete,
    };
  }

  if (streamOp === 'insert_code') {
    return {
      ...(planEd || {}),
      op: 'insert_code',
      streamOp,
      startLine: planStart,
      line_start: planStart,
      endLine: planStart,
      line_end: planStart,
      streamText: parsed.streamText ?? '',
      complete,
    };
  }

  return {
    ...(planEd || {}),
    op: String(planEd?.op || 'insert_code').toLowerCase(),
    streamOp: '',
    streamText: parsed.streamText ?? '',
    complete,
  };
}

function distributeOpStreamByMarker(rawStream, planEdits) {
  const raw = String(rawStream ?? '');
  const parts = [];
  let pos = 0;
  const planLen = Math.max((planEdits || []).length, 1);

  for (let i = 0; i < planLen; i += 1) {
    const idx = raw.indexOf(PECADO_BLOCK_END, pos);
    if (idx >= 0) {
      parts.push({ body: raw.slice(pos, idx), complete: true });
      pos = idx + PECADO_BLOCK_END.length;
    } else {
      parts.push({ body: stripPartialMarkerSuffix(raw.slice(pos)), complete: false });
      pos = raw.length;
      break;
    }
  }

  while (parts.length < (planEdits || []).length) {
    parts.push({ body: '', complete: false });
  }

  const edits = [];
  const segmentCount = Math.max(parts.length, (planEdits || []).length);
  for (let j = 0; j < segmentCount; j += 1) {
    const part = parts[j] || { body: '', complete: false };
    const parsed = parseOpSegmentBody(part.body, part.complete);
    const planEd = planEdits?.[j];
    if (!parsed.streamOp && !planEd) continue;
    edits.push(mergeOpSegmentWithPlan(parsed, planEd));
  }

  return { edits, consumed: raw.length };
}

module.exports = {
  PECADO_BLOCK_END,
  STREAM_OPS,
  PLAN_TO_STREAM,
  canonicalStreamOp,
  isPartialStreamOpPrefix,
  streamOpFromPlan,
  parseOpSegmentBody,
  mergeOpSegmentWithPlan,
  distributeOpStreamByMarker,
  blankLinesText,
  planRangeDisplay,
};
