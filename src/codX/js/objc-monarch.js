/**
 * @file objc-monarch.js
 * 增强 Objective-C Monarch 高亮，更接近 Xcode Classic (Dark)
 * — 「.」前变量白色，「.」后属性/方法分色；[] 内方法名分色
 */
(function () {
  const conf = {
    comments: { lineComment: '//', blockComment: ['/*', '*/'] },
    brackets: [
      ['{', '}'],
      ['[', ']'],
      ['(', ')'],
    ],
    autoClosingPairs: [
      { open: '{', close: '}' },
      { open: '[', close: ']' },
      { open: '(', close: ')' },
      { open: '"', close: '"' },
      { open: "'", close: "'" },
    ],
    surroundingPairs: [
      { open: '{', close: '}' },
      { open: '[', close: ']' },
      { open: '(', close: ')' },
      { open: '"', close: '"' },
      { open: "'", close: "'" },
    ],
  };

  const decpart = /\d(_?\d)*/;
  const decimal = /0|@decpart/;

  const keywords = [
    '#import',
    '#include',
    '#define',
    '#else',
    '#endif',
    '#if',
    '#ifdef',
    '#ifndef',
    '#ident',
    '#undef',
    '@class',
    '@defs',
    '@dynamic',
    '@encode',
    '@end',
    '@implementation',
    '@interface',
    '@package',
    '@private',
    '@protected',
    '@property',
    '@protocol',
    '@public',
    '@selector',
    '@synthesize',
    '__declspec',
    'assign',
    'auto',
    'BOOL',
    'break',
    'bycopy',
    'byref',
    'case',
    'char',
    'Class',
    'const',
    'copy',
    'continue',
    'default',
    'do',
    'double',
    'else',
    'enum',
    'extern',
    'FALSE',
    'false',
    'float',
    'for',
    'goto',
    'if',
    'in',
    'int',
    'id',
    'inout',
    'IMP',
    'long',
    'nil',
    'nonatomic',
    'NULL',
    'oneway',
    'out',
    'private',
    'public',
    'protected',
    'readwrite',
    'readonly',
    'register',
    'return',
    'SEL',
    'self',
    'short',
    'signed',
    'sizeof',
    'static',
    'struct',
    'super',
    'switch',
    'typedef',
    'TRUE',
    'true',
    'union',
    'unsigned',
    'volatile',
    'void',
    'while',
    'YES',
    'NO',
  ];

  const appleClass = [/UI[A-Z][a-zA-Z0-9_]*/, 'support.class'];
  const appleConst = [/NS[A-Z][a-zA-Z0-9_]*/, 'support.constant'];
  const ivar = [/_[a-zA-Z]\w*/, 'variable.other.readwrite'];
  const projectCall = [/[A-Z][a-zA-Z0-9_]*(?=\s*\()/, 'entity.name.function.project'];

  const language = {
    defaultToken: '',
    tokenPostfix: '.objective-c',
    keywords,
    decpart,
    decimal,
    tokenizer: {
      root: [
        { include: '@comments' },
        { include: '@whitespace' },
        { include: '@numbers' },
        { include: '@strings' },
        [/[,:;]/, 'delimiter'],
        [/\[/, { token: '@brackets', next: '@objcMessage' }],
        [/\./, { token: 'delimiter', next: '@memberAccess' }],
        [/[{()}<>]/, '@brackets'],
        [/\]/, '@brackets'],
        [/[#@][a-zA-Z]\w*/, 'keyword.preprocessor'],
        ivar,
        projectCall,
        appleClass,
        appleConst,
        [
          /[A-Z][a-zA-Z0-9_]*/,
          {
            cases: {
              '@keywords': 'keyword',
              '@default': 'entity.name.type',
            },
          },
        ],
        [
          /[a-zA-Z@#]\w*/,
          {
            cases: {
              '@keywords': 'keyword',
              '@default': 'identifier',
            },
          },
        ],
        [/[<>=\\+\\-\\*\\/\\^\\|\\~,]|and\\b|or\\b|not\\b/, 'operator'],
      ],

      memberAccess: [
        [/[a-zA-Z_]\w*/, { token: 'support.variable.property', next: '@memberTail' }],
        ['', '', '@pop'],
      ],

      memberTail: [
        [/\./, { token: 'delimiter', next: '@memberAccess' }],
        ['', '', '@pop'],
      ],

      objcMessage: [
        [/\]/, { token: '@brackets', next: '@pop' }],
        { include: '@whitespace' },
        { include: '@numbers' },
        { include: '@strings' },
        [/\[/, { token: '@brackets', next: '@push' }],
        appleClass,
        appleConst,
        [
          /[A-Z][a-zA-Z0-9_]*/,
          {
            cases: {
              '@keywords': 'keyword',
              '@default': 'support.class',
            },
          },
        ],
        [/:[a-zA-Z_][a-zA-Z0-9_]*/, 'entity.name.function'],
        [/[a-z][a-zA-Z0-9_]*(?=:)/, 'entity.name.function'],
        [/[a-z][a-zA-Z0-9_]*(?=\])/, 'entity.name.function'],
        ivar,
        [
          /[a-zA-Z_]\w*/,
          {
            cases: {
              '@keywords': 'keyword',
              '@default': 'identifier',
            },
          },
        ],
      ],

      whitespace: [[/\s+/, 'white']],
      comments: [
        ['\\/\\*', 'comment', '@comment'],
        ['\\/\\/+.*', 'comment'],
      ],
      comment: [
        ['\\*\\/', 'comment', '@pop'],
        ['.', 'comment'],
      ],
      numbers: [
        [/0[xX][0-9a-fA-F]*(_?[0-9a-fA-F])*/, 'number.hex'],
        [
          /@decimal((\.@decpart)?([eE][\-+]?@decpart)?)[fF]*/,
          {
            cases: {
              '(\\d)*': 'number',
              $0: 'number.float',
            },
          },
        ],
      ],
      strings: [
        [/'$/, 'string.escape', '@popall'],
        [/'/, 'string.escape', '@stringBody'],
        [/"$/, 'string.escape', '@popall'],
        [/"/, 'string.escape', '@dblStringBody'],
      ],
      stringBody: [
        [/[^\\']+$/, 'string', '@popall'],
        [/[^\\']+/, 'string'],
        [/\\./, 'string'],
        [/'/, 'string.escape', '@popall'],
        [/\\$/, 'string'],
      ],
      dblStringBody: [
        [/[^\\"]+$/, 'string', '@popall'],
        [/[^\\"]+/, 'string'],
        [/\\./, 'string'],
        [/"/, 'string.escape', '@popall'],
        [/\\$/, 'string'],
      ],
    },
  };

  function register(monaco) {
    if (!monaco?.languages?.setMonarchTokensProvider) return;
    monaco.languages.setMonarchTokensProvider('objective-c', language);
    monaco.languages.setLanguageConfiguration('objective-c', conf);
  }

  window.CodXObjcMonarch = { register };
})();
