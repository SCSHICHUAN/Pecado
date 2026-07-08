/**
 * @file codx-edit-plan.js
 * CodX 两轮编辑：第一轮 plan（line_start），第二轮按 pecado_LLM_line_end 切分流式 text。
 */

/** LLM 流式各段结束标记（不写入文件） */
const PECADO_LLM_LINE_END = 'pecado_LLM_line_end';

/**
 * @param {object} raw
 * @returns {{ op: string, startLine: number, endLine?: number, line_start?: number } | null}
 */
function normalizePlanEdit(raw) {
  const startLine = Math.max(
    1,
    Math.floor(Number(raw?.line_start ?? raw?.startLine) || 0)
  );
  if (!Number.isFinite(startLine) || startLine < 1) return null;

  const opRaw = String(raw?.op || '').toLowerCase();
  let op = 'insert_below';
  if (opRaw === 'insert_below' || opRaw === 'add' || opRaw === 'insert') op = 'insert_below';
  else if (opRaw === 'replace' || opRaw === 'edit') op = 'replace';
  else if (opRaw === 'delete' || opRaw === 'remove') op = 'delete';
  else if (raw?.endLine != null || raw?.line_end != null) {
    const endRaw = raw?.endLine ?? raw?.line_end;
    const endLine =
      endRaw != null && Number.isFinite(Number(endRaw)) ? Math.floor(Number(endRaw)) : undefined;
    if (endLine != null && endLine >= startLine && raw?.charCount === 0) {
      op = 'delete';
    } else if (endLine != null && endLine >= startLine) {
      op = 'replace';
    }
  }

  const endRaw = raw?.endLine ?? raw?.line_end;
  const endLine =
    endRaw != null && Number.isFinite(Number(endRaw)) ? Math.floor(Number(endRaw)) : undefined;

  return {
    op,
    startLine,
    line_start: startLine,
    endLine: endLine != null && endLine >= startLine ? endLine : undefined,
    line_end: endLine != null && endLine >= startLine ? endLine : undefined,
  };
}

/**
 * 大行号优先（自下而上改，避免行号偏移）
 * @param {Array<object>} edits
 */
function sortPlanEditsDesc(edits) {
  return [...edits].sort((a, b) => {
    const d = (b.startLine || 0) - (a.startLine || 0);
    if (d !== 0) return d;
    return (b.endLine || b.startLine || 0) - (a.endLine || a.startLine || 0);
  });
}

/**
 * @param {Array<object>} rawEdits
 * @returns {{ ok: true, edits: Array<object> } | { ok: false, error: string }}
 */
function validateCodxEditPlan(rawEdits) {
  if (!Array.isArray(rawEdits) || !rawEdits.length) {
    return { ok: false, error: 'edits 须为非空数组' };
  }
  const normalized = rawEdits.map(normalizePlanEdit).filter(Boolean);
  if (!normalized.length) {
    return { ok: false, error: 'edits 每项须含 line_start（或 startLine）' };
  }
  const edits = sortPlanEditsDesc(normalized);
  for (let i = 0; i < edits.length; i += 1) {
    const ed = edits[i];
    if (ed.op === 'replace' || ed.op === 'delete') {
      const end = ed.endLine ?? ed.line_end;
      if (end == null || end < ed.startLine) {
        return { ok: false, error: `edits[${i}]：${ed.op} 须含有效 line_end（≥ line_start）` };
      }
    }
  }
  return { ok: true, edits };
}

/** 流末尾可能是 marker 前缀，展示时剔除 */
function stripPartialMarkerSuffix(text, marker = PECADO_LLM_LINE_END) {
  const s = String(text ?? '');
  for (let len = Math.min(marker.length - 1, s.length); len >= 1; len -= 1) {
    if (marker.startsWith(s.slice(-len))) {
      return s.slice(0, -len);
    }
  }
  return s;
}

/**
 * 按 plan 顺序（大行号优先）用 pecado_LLM_line_end 切分连续流 text
 * @param {string} rawStream
 * @param {Array<object>} edits
 */
function distributeStreamByMarker(rawStream, edits) {
  const raw = String(rawStream ?? '');
  const marker = PECADO_LLM_LINE_END;
  /** @type {Array<{ text: string, complete: boolean }>} */
  const parts = [];
  let pos = 0;

  for (let i = 0; i < (edits || []).length; i += 1) {
    const idx = raw.indexOf(marker, pos);
    if (idx >= 0) {
      parts.push({ text: raw.slice(pos, idx), complete: true });
      pos = idx + marker.length;
    } else {
      parts.push({ text: stripPartialMarkerSuffix(raw.slice(pos), marker), complete: false });
      pos = raw.length;
      break;
    }
  }

  while (parts.length < (edits || []).length) {
    parts.push({ text: '', complete: false });
  }

  const out = (edits || []).map((ed, j) => ({
    ...ed,
    streamText: parts[j]?.text ?? '',
    complete: parts[j]?.complete ?? false,
  }));
  return { edits: out, consumed: raw.length };
}

/**
 * @deprecated 旧 charCount 协议
 * @param {string} rawStream
 * @param {Array<{ charCount: number, streamText?: string }>} edits
 */
function distributeStreamByCharCount(rawStream, edits) {
  const raw = String(rawStream ?? '');
  let offset = 0;
  const out = (edits || []).map((ed) => {
    const count = Math.max(0, ed.charCount || 0);
    const streamText = raw.slice(offset, offset + count);
    offset += count;
    return {
      ...ed,
      streamText,
      complete: count === 0 || streamText.length >= count,
    };
  });
  return { edits: out, consumed: offset };
}

/**
 * @param {string} rawStream
 * @param {Array<object>} edits
 */
function distributeStream(rawStream, edits) {
  const raw = String(rawStream ?? '');
  const list = edits || [];
  if (raw.includes(PECADO_LLM_LINE_END)) {
    return distributeStreamByMarker(raw, list);
  }
  const markerMode = list.every((ed) => ed.charCount == null || ed.charCount === undefined);
  if (markerMode) {
    return distributeStreamByMarker(raw, list);
  }
  return distributeStreamByCharCount(raw, list);
}

module.exports = {
  PECADO_LLM_LINE_END,
  normalizePlanEdit,
  sortPlanEditsDesc,
  validateCodxEditPlan,
  stripPartialMarkerSuffix,
  distributeStreamByMarker,
  distributeStreamByCharCount,
  distributeStream,
};
