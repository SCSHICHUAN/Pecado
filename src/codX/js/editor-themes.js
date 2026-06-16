/**
 * @file editor-themes.js
 * CodX Monaco 编辑器配色主题
 */
(function () {
  /** Xcode Classic (Dark) — 对照 Xcode 现代深色 */
  const XCODE_CLASSIC_DARK_RULES = [
    { token: 'comment', foreground: '67D47B' },
    { token: 'comment.doc', foreground: '67D47B' },
    { token: 'comment.block', foreground: '67D47B' },
    { token: 'comment.line', foreground: '67D47B' },

    { token: 'string', foreground: 'FF8170' },
    { token: 'string.escape', foreground: 'FF8170' },
    { token: 'string.regexp', foreground: 'FF8170' },

    { token: 'keyword', foreground: 'FF7AB2' },
    { token: 'keyword.control', foreground: 'FF7AB2' },
    { token: 'keyword.flow', foreground: 'FF7AB2' },
    { token: 'storage', foreground: 'FF7AB2' },
    { token: 'storage.modifier', foreground: 'FF7AB2' },
    { token: 'variable.language', foreground: 'FF7AB2' },
    { token: 'constant.language', foreground: 'FF7AB2' },

    { token: 'constant.numeric', foreground: 'F2D06B' },
    { token: 'constant.character', foreground: 'F2D06B' },
    { token: 'number', foreground: 'F2D06B' },
    { token: 'number.hex', foreground: 'F2D06B' },
    { token: 'number.float', foreground: 'F2D06B' },

    { token: 'keyword.preprocessor', foreground: 'D98D60' },
    { token: 'meta.preprocessor', foreground: 'D98D60' },

    { token: 'markup.underline.link', foreground: '60B4F0' },
    { token: 'string.link', foreground: '60B4F0' },

    { token: 'entity.name.type', foreground: 'B789E5' },
    { token: 'entity.name.class', foreground: 'B789E5' },
    { token: 'support.class', foreground: 'B789E5' },
    { token: 'support.type', foreground: 'B789E5' },
    { token: 'type', foreground: 'B789E5' },
    { token: 'type.identifier', foreground: 'B789E5' },

    { token: 'support.constant', foreground: 'D273A5' },
    { token: 'support.variable.property', foreground: 'D273A5' },
    { token: 'entity.name.function', foreground: 'D0A8FF' },
    { token: 'entity.name.function.project', foreground: '6BD0B3' },
    { token: 'support.function', foreground: 'D0A8FF' },
    { token: 'meta.function-call', foreground: 'D0A8FF' },

    { token: 'variable.other.readwrite', foreground: '6BD0B3' },

    { token: 'entity.name.tag', foreground: 'FF7AB2' },
    { token: 'delimiter', foreground: 'FFFFFF' },
    { token: 'operator', foreground: 'FFFFFF' },
    { token: 'identifier', foreground: 'FFFFFF' },
    { token: 'variable', foreground: 'FFFFFF' },
    { token: 'variable.parameter', foreground: 'FFFFFF' },
  ];

  const DEFAULT_FONT = {
    fontFamily: 'Menlo, Monaco, Consolas, monospace',
    fontSize: 12,
    fontWeight: 'normal',
  };

  const XCODE_CLASSIC_FONT = {
    fontFamily: '"SF Mono", Menlo, Monaco, monospace',
    fontSize: 12,
    fontWeight: '500',
  };

  /** Cursor Dark — 对照 Cursor IDE 内置主题（BioHazard786/cursor-theme-vscode） */
  const CURSOR_DARK_RULES = [
    { token: 'comment', foreground: '6A6A6A', fontStyle: 'italic' },
    { token: 'comment.doc', foreground: '6A6A6A', fontStyle: 'italic' },
    { token: 'comment.block', foreground: '6A6A6A', fontStyle: 'italic' },
    { token: 'comment.line', foreground: '6A6A6A', fontStyle: 'italic' },

    { token: 'string', foreground: 'E394DC' },
    { token: 'string.escape', foreground: 'E394DC' },
    { token: 'string.regexp', foreground: 'E394DC' },

    { token: 'keyword', foreground: '82D2CE' },
    { token: 'keyword.control', foreground: '82D2CE' },
    { token: 'keyword.flow', foreground: '82D2CE' },
    { token: 'storage', foreground: '82D2CE' },
    { token: 'storage.modifier', foreground: '82D2CE' },
    { token: 'storage.type', foreground: '82D2CE' },
    { token: 'constant.language', foreground: '82D2CE' },

    { token: 'constant.numeric', foreground: 'EBC88D' },
    { token: 'constant.character', foreground: 'EBC88D' },
    { token: 'number', foreground: 'EBC88D' },
    { token: 'number.hex', foreground: 'EBC88D' },
    { token: 'number.float', foreground: 'EBC88D' },

    { token: 'keyword.preprocessor', foreground: 'A8CC7C' },
    { token: 'meta.preprocessor', foreground: 'A8CC7C' },

    { token: 'variable.language', foreground: 'CC7C8A' },

    { token: 'entity.name.function', foreground: 'EFB080' },
    { token: 'entity.name.function.project', foreground: 'EFB080' },
    { token: 'support.function', foreground: 'EFB080' },
    { token: 'meta.function-call', foreground: 'EFB080' },

    { token: 'entity.name.type', foreground: 'EFB080' },
    { token: 'entity.name.class', foreground: 'EFB080' },
    { token: 'support.class', foreground: '87C3FF' },
    { token: 'support.type', foreground: '87C3FF' },
    { token: 'type', foreground: '87C3FF' },
    { token: 'type.identifier', foreground: '87C3FF' },

    { token: 'support.constant', foreground: 'F8C762' },
    { token: 'support.variable.property', foreground: 'AAA0FA' },
    { token: 'variable.other.readwrite', foreground: '87C3FF' },

    { token: 'entity.name.tag', foreground: '87C3FF' },
    { token: 'tag', foreground: '87C3FF' },
    { token: 'attribute.name', foreground: 'AAA0FA' },

    { token: 'markup.underline.link', foreground: '81A1C1' },

    { token: 'delimiter', foreground: 'D6D6DD' },
    { token: 'operator', foreground: 'D6D6DD' },
    { token: 'identifier', foreground: 'D6D6DD' },
    { token: 'variable', foreground: 'D6D6DD' },
    { token: 'variable.parameter', foreground: 'D6D6DD' },
  ];

  const CURSOR_DARK_FONT = {
    fontFamily: '"JetBrains Mono", Menlo, Monaco, Consolas, monospace',
    fontSize: 12,
    fontWeight: 'normal',
    fontLigatures: true,
  };

  const THEME_FALLBACK_COLORS = {
    'xcode-dark': { background: '#1F1F24', foreground: '#FFFFFF' },
    'cursor-dark': { background: '#181818', foreground: '#E4E4E4' },
    'pecado-dark': { background: '#1c1c1e', foreground: '#e8e8e8' },
  };

  /** @param {Record<string, string>} [colors] */
  function mergeThemeColors(colors = {}) {
    return { ...colors };
  }

  /** @type {Record<string, { label: string, builtin?: boolean, font?: typeof DEFAULT_FONT, data?: object }>} */
  const THEMES = {
    'pecado-dark': {
      label: 'Pecado 深色（默认）',
      font: DEFAULT_FONT,
      data: {
        base: 'vs-dark',
        inherit: true,
        rules: [],
        colors: mergeThemeColors({
          'editor.background': '#1c1c1e',
          'editor.foreground': '#e8e8e8',
          'editorLineNumber.foreground': '#5a5a5e',
          'editor.selectionBackground': '#3a5a8a',
          'editorCursor.foreground': '#ffffff',
          'editor.lineHighlightBackground': '#2a2a2e',
        }),
      },
    },
    'xcode-light': {
      label: 'Xcode 浅色',
      font: DEFAULT_FONT,
      data: {
        base: 'vs',
        inherit: true,
        rules: [
          { token: 'comment', foreground: '008e00' },
          { token: 'string', foreground: 'df0002' },
          { token: 'constant.numeric', foreground: '3a00dc' },
          { token: 'constant.language', foreground: 'c800a4' },
          { token: 'keyword', foreground: 'c800a4' },
          { token: 'storage', foreground: 'c900a4' },
          { token: 'entity.name.class', foreground: '438288' },
          { token: 'entity.name.tag', foreground: '790ead' },
          { token: 'support.function', foreground: '450084' },
          { token: 'support.type', foreground: '790ead' },
        ],
        colors: mergeThemeColors({
          'editor.foreground': '#000000',
          'editor.background': '#ffffff',
          'editor.selectionBackground': '#b5d5ff',
          'editor.lineHighlightBackground': '#00000012',
          'editorCursor.foreground': '#000000',
          'editorLineNumber.foreground': '#888888',
        }),
      },
    },
    'xcode-dark': {
      label: 'Xcode Classic (Dark)',
      font: XCODE_CLASSIC_FONT,
      data: {
        base: 'vs-dark',
        inherit: true,
        rules: XCODE_CLASSIC_DARK_RULES,
        colors: mergeThemeColors({
          'editor.background': '#1F1F24',
          'editor.foreground': '#FFFFFF',
          'editorLineNumber.foreground': '#868686',
          'editorLineNumber.activeForeground': '#C6C6C6',
          'editor.selectionBackground': '#3A3D41',
          'editor.inactiveSelectionBackground': '#3A3D41',
          'editorCursor.foreground': '#FFFFFF',
          'editor.lineHighlightBackground': '#2A2D2E',
          'editorIndentGuide.background': '#404040',
          'editorIndentGuide.activeBackground': '#707070',
        }),
      },
    },
    'cursor-dark': {
      label: 'Cursor Dark',
      font: CURSOR_DARK_FONT,
      data: {
        base: 'vs-dark',
        inherit: true,
        rules: CURSOR_DARK_RULES,
        colors: mergeThemeColors({
          'editor.background': '#181818',
          'editor.foreground': '#E4E4E4',
          'editorLineNumber.foreground': '#858585',
          'editorLineNumber.activeForeground': '#E4E4E4',
          'editor.selectionBackground': '#404040',
          'editor.inactiveSelectionBackground': '#404040',
          'editorCursor.foreground': '#E4E4E4',
          'editor.lineHighlightBackground': '#262626',
          'editor.lineHighlightBorder': '#262626',
          'editorIndentGuide.background': '#2E2E2E',
          'editorIndentGuide.activeBackground': '#4A4A4A',
          'editor.selectionHighlightBackground': '#404040',
          'editor.wordHighlightBackground': '#2E2E2E',
          'editor.findMatchBackground': '#88C0D066',
          'editor.findMatchHighlightBackground': '#88C0D044',
        }),
      },
    },
    'vs-dark': {
      label: 'Visual Studio 深色',
      font: DEFAULT_FONT,
      builtin: true,
    },
    vs: {
      label: 'Visual Studio 浅色',
      font: DEFAULT_FONT,
      builtin: true,
    },
  };

  const DEFAULT_THEME = 'pecado-dark';
  let currentTheme = DEFAULT_THEME;

  function listThemes() {
    return Object.entries(THEMES).map(([id, meta]) => ({ id, label: meta.label }));
  }

  function normalizeThemeId(id) {
    const key = String(id || '').trim();
    return THEMES[key] ? key : DEFAULT_THEME;
  }

  function getFontOptions(themeId) {
    const id = normalizeThemeId(themeId);
    return THEMES[id]?.font || DEFAULT_FONT;
  }

  function registerAll(monaco) {
    if (!monaco) return;
    for (const [id, meta] of Object.entries(THEMES)) {
      if (meta.builtin || !meta.data) continue;
      monaco.editor.defineTheme(id, meta.data);
    }
  }

  function apply(monaco, themeId) {
    if (!monaco) return DEFAULT_THEME;
    const id = normalizeThemeId(themeId);
    registerAll(monaco);
    monaco.editor.setTheme(id);
    currentTheme = id;
    syncFallbackEditor(id);
    return id;
  }

  function getCurrentTheme() {
    return currentTheme;
  }

  function syncFallbackEditor(themeId) {
    const ta = document.querySelector('.codx-fallback-editor');
    if (!ta) return;
    const light = themeId === 'vs' || themeId === 'xcode-light';
    const font = getFontOptions(themeId);
    const dark = THEME_FALLBACK_COLORS[themeId] || THEME_FALLBACK_COLORS['pecado-dark'];
    ta.style.background = light ? '#ffffff' : dark.background;
    ta.style.color = light ? '#000000' : dark.foreground;
    ta.style.fontFamily = font.fontFamily;
    ta.style.fontWeight = font.fontWeight;
    ta.style.fontVariantLigatures = font.fontLigatures ? 'normal' : 'none';
  }

  window.CodXEditorThemes = {
    THEMES,
    DEFAULT_THEME,
    DEFAULT_FONT,
    listThemes,
    normalizeThemeId,
    getFontOptions,
    registerAll,
    apply,
    getCurrentTheme,
  };
})();
