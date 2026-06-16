/**
 * @file diagnostics.js
 * CodX 编辑错误标注：Monaco 内置诊断 + Apple 语言语法检查
 */
(function () {
  const MARKER_OWNER = 'codx-syntax';
  const DEBOUNCE_MS = 700;
  /** @type {typeof import('monaco-editor') | null} */
  let monacoRef = null;
  /** @type {Map<string, ReturnType<typeof setTimeout>>} */
  const timers = new Map();
  /** @type {Map<string, number>} */
  const reqIds = new Map();

  const MONACO_DIAG_LANGS = new Set([
    'javascript',
    'typescript',
    'json',
    'css',
    'scss',
    'less',
    'html',
    'handlebars',
    'razor',
  ]);

  function usesExternalSyntaxCheck(lang) {
    return ['swift', 'objective-c', 'c', 'cpp'].includes(lang);
  }

  function toMarkers(issues) {
    if (!monacoRef) return [];
    return (issues || []).map((item) => ({
      severity:
        item.severity === 'warning'
          ? monacoRef.MarkerSeverity.Warning
          : monacoRef.MarkerSeverity.Error,
      startLineNumber: Math.max(1, item.line || 1),
      startColumn: Math.max(1, item.column || 1),
      endLineNumber: Math.max(1, item.line || 1),
      endColumn: Math.max(2, (item.column || 1) + 1),
      message: item.message || '语法错误',
    }));
  }

  function clearMarkers(model) {
    if (!monacoRef || !model || model.isDisposed()) return;
    monacoRef.editor.setModelMarkers(model, MARKER_OWNER, []);
  }

  async function runExternalCheck(relPath, model) {
    const api = window.electronAPI;
    if (!api?.codxCheckSyntax || !model || model.isDisposed()) return;

    const nextId = (reqIds.get(relPath) || 0) + 1;
    reqIds.set(relPath, nextId);

    const res = await api.codxCheckSyntax({
      relPath,
      content: model.getValue(),
    });

    if (model.isDisposed() || reqIds.get(relPath) !== nextId) return;

    if (!res?.ok && res?.error) {
      clearMarkers(model);
      return;
    }

    monacoRef.editor.setModelMarkers(model, MARKER_OWNER, toMarkers(res?.issues));
  }

  function scheduleExternalCheck(relPath, model) {
    if (!relPath || !model || model.isDisposed()) return;
    const lang = model.getLanguageId();
    if (!usesExternalSyntaxCheck(lang)) {
      clearMarkers(model);
      return;
    }

    const prev = timers.get(relPath);
    if (prev) clearTimeout(prev);
    timers.set(
      relPath,
      setTimeout(() => {
        timers.delete(relPath);
        runExternalCheck(relPath, model).catch(() => clearMarkers(model));
      }, DEBOUNCE_MS)
    );
  }

  /** @type {WeakSet<import('monaco-editor').editor.ITextModel>} */
  const boundModels = new WeakSet();

  function bindModel(relPath, model) {
    if (!monacoRef || !model || model.isDisposed()) return;
    if (!boundModels.has(model)) {
      boundModels.add(model);
      model.onDidChangeContent(() => {
        scheduleExternalCheck(relPath, model);
      });
    }
    scheduleExternalCheck(relPath, model);
  }

  function bind(monaco, getRelPathForModel) {
    monacoRef = monaco;
    return {
      bindModel,
      scheduleExternalCheck,
      clearForRelPath(relPath, model) {
        if (timers.has(relPath)) {
          clearTimeout(timers.get(relPath));
          timers.delete(relPath);
        }
        reqIds.delete(relPath);
        if (model) clearMarkers(model);
      },
      usesExternalSyntaxCheck,
      isMonacoDiagLang(lang) {
        return MONACO_DIAG_LANGS.has(lang);
      },
      getRelPathForModel,
    };
  }

  window.CodXDiagnostics = { bind };
})();
