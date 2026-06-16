/**
 * @file codx-edit-ops.js
 * 浏览器端 CodX 行级编辑运算（与 shared/codx-edit-ops.js 保持一致）
 */
(function () {
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

  function applyCodxEditOp(content, ed) {
    return applyCodxEditOpRaw(content, enrichCodxEditForApply(ed));
  }

  function applyCodxEditOpRaw(content, ed) {
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

    if (op === 'add') return insLines;
    if (op === 'delete') return -repLines;
    return insLines - repLines;
  }

  function mapOriginalLineToCurrent(originalLine, edits, opts = {}) {
    const ol = Math.max(1, Math.floor(Number(originalLine) || 1));
    if (!edits?.length) return ol;

    const { completeOnly = true, beforeArrayIndex = -1 } = opts;
    let offset = 0;
    const sorted = edits
      .map((ed, arrayIndex) => ({ ed: enrichCodxEditForApply(ed), arrayIndex }))
      .sort((a, b) => {
        const d = (a.ed.startLine || 0) - (b.ed.startLine || 0);
        return d !== 0 ? d : a.arrayIndex - b.arrayIndex;
      });

    for (const { ed, arrayIndex } of sorted) {
      if (completeOnly && !edits[arrayIndex]?.complete) continue;
      if (beforeArrayIndex >= 0 && arrayIndex >= beforeArrayIndex) continue;

      const op = inferCodxOp(ed);
      const start = Math.max(1, Math.floor(Number(ed.startLine) || 1));
      const end = ed.endLine;
      const hasEnd = end != null && Number.isFinite(Number(end)) && Number(end) >= start;
      const delta = computeCodxEditDeltaRaw(ed);
      const rangeEnd = op === 'add' ? start - 1 : hasEnd ? Math.floor(Number(end)) : start;

      if (ol > rangeEnd) offset += delta;
      else if (op !== 'add' && hasEnd && ol >= start && ol <= Math.floor(Number(end))) {
        return start + offset;
      }
    }
    return ol + offset;
  }

  window.CodXEditOps = {
    inferCodxOp,
    enrichCodxEditForApply,
    applyCodxEditOp,
    computeCodxEditDelta,
    mapOriginalLineToCurrent,
  };
})();
