/**
 * @file codx-edit-ops.js
 * 浏览器端 CodX 行级编辑运算（与 shared/codx-edit-ops.js 保持一致）
 */
(function () {
  function normalizeCodxOp(raw) {
    const op = String(raw || '').toLowerCase();
    if (op === 'insert_below' || op === 'add' || op === 'insert') return 'insert_below';
    if (op === 'replace' || op === 'edit') return 'replace';
    if (op === 'delete' || op === 'remove') return 'delete';
    return op;
  }

  function inferCodxOp(ed) {
    const normalized = normalizeCodxOp(ed?.op);
    if (normalized === 'insert_below' || normalized === 'replace' || normalized === 'delete') {
      return normalized;
    }

    const start = Math.max(1, Math.floor(Number(ed?.startLine) || 1));
    const end = ed?.endLine;
    const hasEnd = end != null && Number.isFinite(Number(end)) && Number(end) >= start;
    const text = ed?.streamText ?? ed?.text;
    if (text != null && String(text).length > 0) return 'replace';
    if (!hasEnd) return 'insert_below';
    if (text === '' || text == null) return 'delete';
    return 'replace';
  }

  function enrichCodxEditForApply(ed) {
    const startLine = Math.max(1, Math.floor(Number(ed?.startLine) || 1));
    const text = String(ed?.streamText ?? ed?.text ?? '');
    const op = inferCodxOp(ed);

    if (op === 'delete') {
      const endLine =
        ed?.endLine != null && Number(ed.endLine) >= startLine
          ? Math.floor(Number(ed.endLine))
          : startLine;
      return { ...ed, op: 'delete', startLine, endLine };
    }

    if (op === 'insert_below') {
      return { ...ed, op: 'insert_below', startLine, endLine: startLine };
    }

    const explicitEnd =
      ed?.endLine != null && Number(ed.endLine) >= startLine
        ? Math.floor(Number(ed.endLine))
        : null;
    if (!text) {
      return {
        ...ed,
        op: 'replace',
        startLine,
        endLine: explicitEnd ?? startLine,
      };
    }
    const endLine = explicitEnd ?? startLine + text.split('\n').length - 1;
    return { ...ed, op: 'replace', startLine, endLine };
  }

  function applyCodxEditOp(content, ed) {
    return applyCodxEditOpRaw(content, enrichCodxEditForApply(ed));
  }

  function applyCodxEditOpRaw(content, ed) {
    const op = inferCodxOp(ed);
    const startLine = ed?.startLine;
    const endLine = ed?.endLine;
    const text = String(ed?.streamText ?? ed?.text ?? '');

    const lines = String(content ?? '').split('\n');
    const si = Math.max(1, Math.floor(Number(startLine) || 1));

    if (op === 'insert_below') {
      const ins = text.split('\n');
      lines.splice(si, 0, ...ins);
      return lines.join('\n');
    }

    const startIdx = si - 1;
    const hasEnd =
      endLine != null && Number.isFinite(Number(endLine)) && Number(endLine) >= Number(startLine);
    const ei = hasEnd ? Math.max(startIdx, Math.floor(Number(endLine)) - 1) : startIdx;

    if (op === 'delete') {
      lines.splice(startIdx, ei - startIdx + 1);
      return lines.join('\n');
    }

    const ins = text.split('\n');
    lines.splice(startIdx, ei - startIdx + 1, ...ins);
    return lines.join('\n');
  }

  function computeCodxEditDelta(ed) {
    return computeCodxEditDeltaRaw(enrichCodxEditForApply(ed));
  }

  function computeCodxEditDeltaRaw(ed) {
    const op = inferCodxOp(ed);
    const start = Math.max(1, Math.floor(Number(ed.startLine) || 1));
    const end = ed.endLine;
    const hasEnd = end != null && Number.isFinite(Number(end)) && Number(end) >= start;
    const repLines = hasEnd ? Math.floor(Number(end)) - start + 1 : 0;
    const insLines = String(ed.streamText ?? ed.text ?? '').split('\n').length;

    if (op === 'insert_below') return insLines;
    if (op === 'delete') return -repLines;
    return insLines - repLines;
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
      const delta = computeCodxEditDeltaRaw(ed);
      const rangeEnd =
        op === 'insert_below' ? start : hasEnd ? Math.floor(Number(end)) : start;

      if (ol > rangeEnd) offset += delta;
      else if (op === 'replace' && hasEnd && ol >= start && ol <= Math.floor(Number(end))) {
        return start + offset;
      }
    }
    return ol + offset;
  }

  window.CodXEditOps = {
    normalizeCodxOp,
    inferCodxOp,
    enrichCodxEditForApply,
    applyCodxEditOp,
    computeCodxEditDelta,
    mapOriginalLineToCurrent,
  };
})();
