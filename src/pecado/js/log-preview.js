/**
 * @file log-preview.js
 * 【功能】Log 预览：打开原生 macOS 窗口（系统标题栏 + 红黄绿按钮）
 */
(function () {
  function buildPayload(payload) {
    const kind = String(payload?.kind || '').trim();
    const base = {
      kind,
      title: String(payload?.title || '').trim() || '预览',
      skill: payload?.skill,
      skillDocId: payload?.skillDocId,
      sectionPath: payload?.sectionPath,
      filePath: payload?.filePath,
      resourcePath: payload?.resourcePath,
    };

    if (kind === 'text') {
      base.fullText =
        String(payload.fullText || '').trim() ||
        String(window.LogPanel?.getOutputPreview?.(payload.previewId) || '').trim();
    }

    return base;
  }

  async function openPreview(payload) {
    const api = window.electronAPI;
    if (!api?.openLogPreview) return;

    try {
      const res = await api.openLogPreview(buildPayload(payload || {}));
      if (!res?.ok && res?.error) {
        console.warn('[LogPreview]', res.error);
      }
    } catch (e) {
      console.warn('[LogPreview]', e.message || String(e));
    }
  }

  window.LogPreview = { openPreview };
})();
