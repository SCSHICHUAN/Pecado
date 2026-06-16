/**
 * @file codx-edit-plan.js
 * 浏览器端 plan 切分（与 shared/codx-edit-plan.js 一致）
 */
(function () {
  const MARKER = 'pecado_LLM_line_end';

  function stripPartialMarkerSuffix(text) {
    const s = String(text ?? '');
    for (let len = Math.min(MARKER.length - 1, s.length); len >= 1; len -= 1) {
      if (MARKER.startsWith(s.slice(-len))) {
        return s.slice(0, -len);
      }
    }
    return s;
  }

  function distributeStreamByMarker(rawStream, edits) {
    const raw = String(rawStream ?? '');
    /** @type {Array<{ text: string, complete: boolean }>} */
    const parts = [];
    let pos = 0;

    for (let i = 0; i < (edits || []).length; i += 1) {
      const idx = raw.indexOf(MARKER, pos);
      if (idx >= 0) {
        parts.push({ text: raw.slice(pos, idx), complete: true });
        pos = idx + MARKER.length;
      } else {
        parts.push({ text: stripPartialMarkerSuffix(raw.slice(pos)), complete: false });
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

  function distributeStream(rawStream, edits) {
    const raw = String(rawStream ?? '');
    const list = edits || [];
    if (raw.includes(MARKER)) {
      return distributeStreamByMarker(raw, list);
    }
    const markerMode = list.every((ed) => ed.charCount == null || ed.charCount === undefined);
    if (markerMode) {
      return distributeStreamByMarker(raw, list);
    }
    return distributeStreamByCharCount(raw, list);
  }

  window.CodXEditPlan = {
    distributeStreamByMarker,
    distributeStreamByCharCount,
    distributeStream,
    PECADO_LLM_LINE_END: MARKER,
  };
})();
