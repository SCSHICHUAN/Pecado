/**
 * @file preview-page.js
 * 【功能】预览窗口正文展示
 */
(function () {
  const bodyEl = document.getElementById('preview-body');
  const subtitleEl = document.getElementById('preview-subtitle');
  const toolbarEl = document.getElementById('preview-toolbar');
  const finderBtn = document.getElementById('preview-finder-btn');
  let currentFilePath = '';

  finderBtn?.addEventListener('click', () => {
    if (!currentFilePath) return;
    window.previewAPI?.openInFinder?.(currentFilePath).catch(() => {});
  });

  window.previewAPI?.onContent?.((payload) => {
    const title = String(payload?.title || '预览').trim() || '预览';
    document.title = title;

    currentFilePath = String(payload?.filePath || '').trim();
    const subtitle = String(payload?.subtitle || currentFilePath || '').trim();

    if (subtitleEl) {
      subtitleEl.textContent = subtitle;
      subtitleEl.hidden = !subtitle;
    }

    if (bodyEl) {
      bodyEl.textContent = String(payload?.body || '').trim() || '(空)';
    }

    if (toolbarEl) toolbarEl.hidden = !currentFilePath;
    if (finderBtn) finderBtn.hidden = !currentFilePath;
  });
})();
