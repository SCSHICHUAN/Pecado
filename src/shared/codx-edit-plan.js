/**
 * @file codx-edit-plan.js
 * CodX 两轮编辑：plan + 流（insert_code|edit_code|del_code|insert_blanks + pecado_block_end）
 */

const { PECADO_BLOCK_END, distributeOpStreamByMarker } = require('./codx-stream-ops');

const PLAN_OPS = ['insert_code', 'edit_code', 'del_code', 'insert_blanks'];

function normalizePlanEdit(raw) {
  const startLine = Math.max(
    1,
    Math.floor(Number(raw?.line_start ?? raw?.startLine) || 0)
  );
  if (!Number.isFinite(startLine) || startLine < 1) return null;

  const opRaw = String(raw?.op || '').toLowerCase();
  let op = 'insert_code';
  if (PLAN_OPS.includes(opRaw)) op = opRaw;

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

function sortPlanEditsDesc(edits) {
  return [...edits].sort((a, b) => {
    const d = (b.startLine || 0) - (a.startLine || 0);
    if (d !== 0) return d;
    return (b.endLine || b.startLine || 0) - (a.endLine || a.startLine || 0);
  });
}

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
    if (ed.op === 'del_code' || ed.op === 'edit_code' || ed.op === 'insert_blanks') {
      const end = ed.endLine ?? ed.line_end;
      if (end == null || end < ed.startLine) {
        return { ok: false, error: `edits[${i}]：${ed.op} 须含有效 line_end（≥ line_start）` };
      }
    }
    if (!PLAN_OPS.includes(ed.op)) {
      return { ok: false, error: `edits[${i}]：op 须为 ${PLAN_OPS.join(' | ')}` };
    }
  }
  return { ok: true, edits };
}

function distributeStream(rawStream, edits) {
  return distributeOpStreamByMarker(rawStream, edits || []);
}

module.exports = {
  PECADO_BLOCK_END,
  PLAN_OPS,
  normalizePlanEdit,
  sortPlanEditsDesc,
  validateCodxEditPlan,
  distributeStream,
};
