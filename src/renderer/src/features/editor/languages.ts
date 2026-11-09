// Syntax colors for files Monaco doesn't know out of the box (Vue, Svelte, .env, TOML, Makefile,
// ignore files), and more file names mapped to the languages it does ship.
import * as monaco from 'monaco-editor'

type Monarch = monaco.languages.IMonarchLanguage
type Rule = monaco.languages.IMonarchLanguageRule

// --- More names for built-in languages --------------------------------------------------------
// Registering an existing id merges these into what Monaco already detects.
const extraNames: monaco.languages.ILanguageExtensionPoint[] = [
  { id: 'json', extensions: ['.jsonc', '.json5', '.code-workspace', '.webmanifest'], filenames: ['.prettierrc', '.swcrc', '.watchmanconfig', 'composer.lock'] },
  { id: 'shell', extensions: ['.zsh'], filenames: ['.bashrc', '.bash_profile', '.bash_aliases', '.zshrc', '.zshenv', '.zprofile', '.profile', '.envrc'] },
  { id: 'ini', extensions: ['.cfg', '.conf'], filenames: ['.editorconfig', '.npmrc', '.gitmodules', '.gitconfig'] },
  { id: 'dockerfile', filenames: ['Containerfile'], filenamePatterns: ['Dockerfile.*', '*.Dockerfile', 'Containerfile.*'] },
  { id: 'xml', extensions: ['.plist', '.rss', '.atom', '.wsdl', '.nuspec', '.resx', '.xliff', '.xlf', '.kml', '.gpx', '.storyboard', '.xib', '.iml', '.xcscheme'] },
  { id: 'yaml', filenames: ['.clang-format', '.clangd', 'pnpm-lock.yaml'] }
]

// --- Vue and Svelte: HTML around <script>/<style> blocks in the language their `lang` names ------

function componentLanguage(open: RegExp, close: RegExp, blocks: Rule[]): Monarch {
  const embeddedEnd = (tag: string): Rule => [new RegExp(`</${tag}`), { token: '@rematch', next: '@pop', nextEmbedded: '@pop' }]
  const blockClose = (tag: string): Rule => [new RegExp(`(</)(${tag}\\s*)(>)`), ['delimiter', 'tag', { token: 'delimiter', next: '@pop' }]]
  const langAttr = (names: string, lang: string, tag: string): Rule => [
    new RegExp(`(lang)(\\s*)(=)(\\s*)(["'])(${names})(["'])`),
    ['attribute.name', '', 'delimiter', '', 'attribute.value', 'attribute.value', { token: 'attribute.value', switchTo: `@${tag}Lang.${lang}` }]
  ]
  const attributes: Rule[] = [
    [/"[^"]*"|'[^']*'/, 'attribute.value'],
    [/[\w\-:@#.]+/, 'attribute.name'],
    [/=/, 'delimiter'],
    [/\s+/, '']
  ]
  /** Attribute list of <script>/<style>; `lang="…"` picks the embedded language. */
  const blockTag = (tag: 'script' | 'style', fallback: string): Rule[] => [
    langAttr('ts|typescript|tsx', 'typescript', tag),
    langAttr('scss|sass', 'scss', tag),
    langAttr('less', 'less', tag),
    ...attributes,
    [/>/, { token: 'delimiter', next: `@${tag}Body`, nextEmbedded: fallback }],
    blockClose(tag)
  ]
  /** Same, once `lang` chose the language (kept in $S2). */
  const blockTagWithLang = (tag: 'script' | 'style'): Rule[] => [
    ...attributes,
    [/>/, { token: 'delimiter', next: `@${tag}Body`, nextEmbedded: '$S2' }],
    blockClose(tag)
  ]
  return {
    defaultToken: '',
    // Same token names as HTML, so the theme colors them the same way.
    tokenPostfix: '.html',
    ignoreCase: true,
    tokenizer: {
      root: [
        [/<!--/, 'comment', '@comment'],
        [/(<)(script)/, ['delimiter', { token: 'tag', next: '@scriptTag' }]],
        [/(<)(style)/, ['delimiter', { token: 'tag', next: '@styleTag' }]],
        [/(<\/?)([\w\-:.]+)/, ['delimiter', { token: 'tag', next: '@tag' }]],
        ...blocks,
        [open, { token: 'delimiter.bracket', next: '@expression', nextEmbedded: 'javascript' }],
        [close, 'delimiter.bracket'],
        [/</, 'delimiter'],
        [/[^<{]+/, ''],
        [/\{/, '']
      ],
      comment: [
        [/-->/, 'comment', '@pop'],
        [/[^-]+/, 'comment.content'],
        [/./, 'comment.content']
      ],
      tag: [
        [/\/?>/, 'delimiter', '@pop'],
        [/"[^"]*"|'[^']*'/, 'attribute.value'],
        // Vue directives (v-if, :prop, @event, #slot) and Svelte ones (on:click, bind:value).
        [/(?:v-[\w\-]+|[:@#][\w\-.[\]]*|(?:on|bind|use|class|style|transition|in|out|animate|let):[\w\-|]+)/, 'keyword'],
        [/[\w\-.]+/, 'attribute.name'],
        [/=/, 'delimiter'],
        [open, { token: 'delimiter.bracket', next: '@expression', nextEmbedded: 'javascript' }],
        [close, 'delimiter.bracket'],
        [/\s+/, '']
      ],
      // Ends just before the closing brace, which the state below it colors.
      expression: [[close, { token: '@rematch', next: '@pop', nextEmbedded: '@pop' }]],
      scriptTag: blockTag('script', 'javascript'),
      scriptLang: blockTagWithLang('script'),
      scriptBody: [embeddedEnd('script'), [/[^<]+/, '']],
      styleTag: blockTag('style', 'css'),
      styleLang: blockTagWithLang('style'),
      styleBody: [embeddedEnd('style'), [/[^<]+/, '']]
    }
  }
}

const componentConfig: monaco.languages.LanguageConfiguration = {
  comments: { blockComment: ['<!--', '-->'] },
  brackets: [
    ['<!--', '-->'],
    ['<', '>'],
    ['{', '}'],
    ['(', ')'],
    ['[', ']']
  ],
  autoClosingPairs: [
    { open: '{', close: '}' },
    { open: '[', close: ']' },
    { open: '(', close: ')' },
    { open: '"', close: '"' },
    { open: "'", close: "'" },
    { open: '<!--', close: '-->', notIn: ['comment', 'string'] }
  ],
  surroundingPairs: [
    { open: '"', close: '"' },
    { open: "'", close: "'" },
    { open: '{', close: '}' },
    { open: '[', close: ']' },
    { open: '(', close: ')' },
    { open: '<', close: '>' }
  ]
}

// Vue: {{ expression }}.
const vue = componentLanguage(/\{\{/, /\}\}/, [])
// Svelte: {expression}, with {#if …} / {:else} / {/if} / {@html …} blocks.
const svelte = componentLanguage(/\{/, /\}/, [
  [/(\{)([#:/@])(\w+)/, ['delimiter.bracket', 'keyword', { token: 'keyword', next: '@expression', nextEmbedded: 'javascript' }]]
])

// --- .env ---------------------------------------------------------------------------------------

const interpolation: Rule = [/\$\{[^}]*\}|\$[A-Za-z_]\w*/, 'variable.predefined']

const dotenv: Monarch = {
  defaultToken: '',
  tokenPostfix: '.dotenv',
  tokenizer: {
    root: [
      [/^\s*#.*$/, 'comment'],
      [/^(\s*)(export)(\s+)([A-Za-z_][\w.\-]*)(\s*)(=)/, ['', 'keyword', '', 'attribute.name', '', 'delimiter']],
      [/^(\s*)([A-Za-z_][\w.\-]*)(\s*)(=)/, ['', 'attribute.name', '', 'delimiter']],
      [/"/, 'string', '@doubleQuoted'],
      [/'/, 'string', '@singleQuoted'],
      [/`/, 'string', '@backQuoted'],
      interpolation,
      [/\s+#.*$/, 'comment'],
      [/\b(?:true|false|null)\b/, 'keyword'],
      [/-?\b\d+(?:\.\d+)?\b(?![^\s#])/, 'number'],
      [/[^\s"'`$#]+/, 'string'],
      [/[$#]/, 'string'],
      [/\s+/, '']
    ],
    doubleQuoted: [interpolation, [/\\./, 'string.escape'], [/[^"\\$]+/, 'string'], [/\$/, 'string'], [/"/, 'string', '@pop']],
    singleQuoted: [[/[^']+/, 'string'], [/'/, 'string', '@pop']],
    backQuoted: [[/[^`]+/, 'string'], [/`/, 'string', '@pop']]
  }
}

// --- TOML ---------------------------------------------------------------------------------------

const toml: Monarch = {
  defaultToken: '',
  tokenPostfix: '.toml',
  tokenizer: {
    root: [
      [/#.*$/, 'comment'],
      [/^\s*\[\[[^\]]*\]\]/, 'type'],
      [/^\s*\[[^\]]*\]/, 'type'],
      [/(?:[A-Za-z0-9_\-]+|"[^"]*"|'[^']*')(?:\s*\.\s*(?:[A-Za-z0-9_\-]+|"[^"]*"|'[^']*'))*(?=\s*=)/, 'attribute.name'],
      [/"""/, 'string', '@multiBasic'],
      [/'''/, 'string', '@multiLiteral'],
      [/"/, 'string', '@basic'],
      [/'[^']*'/, 'string'],
      [/\d{4}-\d{2}-\d{2}(?:[Tt ]\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:[Zz]|[+-]\d{2}:\d{2})?)?|\d{2}:\d{2}:\d{2}(?:\.\d+)?/, 'number'],
      [/\b(?:true|false)\b/, 'keyword'],
      [/[+-]?(?:0x[\da-fA-F_]+|0o[0-7_]+|0b[01_]+|(?:\d[\d_]*)(?:\.[\d_]+)?(?:[eE][+-]?\d+)?|inf|nan)\b/, 'number'],
      [/[{}[\]]/, '@brackets'],
      [/[=,.]/, 'delimiter'],
      [/\s+/, '']
    ],
    basic: [[/\\./, 'string.escape'], [/[^"\\]+/, 'string'], [/"/, 'string', '@pop']],
    multiBasic: [[/\\./, 'string.escape'], [/"""/, 'string', '@pop'], [/[^"\\]+/, 'string'], [/"/, 'string']],
    multiLiteral: [[/'''/, 'string', '@pop'], [/[^']+/, 'string'], [/'/, 'string']]
  }
}

// --- Makefile -----------------------------------------------------------------------------------

const makeVariable: Rule = [/\$\([^)]*\)|\$\{[^}]*\}|\$[@<^+?*%|]/, 'variable.predefined']

const makefile: Monarch = {
  defaultToken: '',
  tokenPostfix: '.makefile',
  tokenizer: {
    root: [
      [/^\t[@\-+]*/, { token: 'keyword', next: '@recipe' }],
      [/#.*$/, 'comment'],
      [/^\s*-?(?:include|sinclude|ifeq|ifneq|ifdef|ifndef|else|endif|define|endef|export|unexport|override|vpath)\b/, 'keyword'],
      [/^(\s*)([\w.\-/$()]+)(\s*)(\?=|:=|::=|\+=|!=|=)/, ['', 'variable', '', 'operator']],
      [/^(\.PHONY|\.DEFAULT|\.SUFFIXES|\.PRECIOUS|\.SILENT|\.ONESHELL)(\s*)(:)/, ['keyword', '', 'delimiter']],
      [/^([^:#=\t\s][^:#=]*?)(\s*)(::?)(?!=)/, ['type', '', 'delimiter']],
      makeVariable,
      [/"[^"]*"|'[^']*'/, 'string'],
      [/[^\s$#"']+/, ''],
      [/\s+/, '']
    ],
    // Recipe lines (tab-indented), until a line that doesn't start with a tab.
    recipe: [
      [/^(?!\t)/, '', '@pop'],
      [/^\t[@\-+]*/, 'keyword'],
      makeVariable,
      [/#.*$/, 'comment'],
      [/"[^"]*"|'[^']*'/, 'string'],
      [/[^$#"']+/, ''],
      [/./, '']
    ]
  }
}

// --- .gitignore and friends ---------------------------------------------------------------------

const ignore: Monarch = {
  defaultToken: '',
  tokenPostfix: '.ignore',
  tokenizer: {
    root: [
      [/^\s*#.*$/, 'comment'],
      [/^!/, 'keyword'],
      [/\*\*?|\?|\[[^\]]*\]/, 'operator'],
      [/\//, 'delimiter'],
      [/[^*?[/\s]+/, 'string'],
      [/\s+/, '']
    ]
  }
}

const hashComments: monaco.languages.LanguageConfiguration = {
  comments: { lineComment: '#' },
  brackets: [
    ['{', '}'],
    ['[', ']'],
    ['(', ')']
  ],
  autoClosingPairs: [
    { open: '{', close: '}' },
    { open: '[', close: ']' },
    { open: '(', close: ')' },
    { open: '"', close: '"', notIn: ['string'] },
    { open: "'", close: "'", notIn: ['string'] }
  ]
}

const custom: { lang: monaco.languages.ILanguageExtensionPoint; tokens: Monarch; config: monaco.languages.LanguageConfiguration }[] = [
  { lang: { id: 'vue', extensions: ['.vue'], aliases: ['Vue', 'vue'] }, tokens: vue, config: componentConfig },
  { lang: { id: 'svelte', extensions: ['.svelte'], aliases: ['Svelte', 'svelte'] }, tokens: svelte, config: componentConfig },
  { lang: { id: 'dotenv', extensions: ['.env'], filenames: ['.env'], filenamePatterns: ['.env.*', '*.env.*'], aliases: ['Env', 'dotenv', 'env'] }, tokens: dotenv, config: hashComments },
  { lang: { id: 'toml', extensions: ['.toml'], filenames: ['Pipfile', 'Cargo.lock', 'poetry.lock', 'uv.lock'], aliases: ['TOML', 'toml'] }, tokens: toml, config: hashComments },
  { lang: { id: 'makefile', extensions: ['.mk', '.mak'], filenames: ['Makefile', 'makefile', 'GNUmakefile'], aliases: ['Makefile', 'make'] }, tokens: makefile, config: hashComments },
  {
    lang: { id: 'ignore', filenames: ['.gitignore', '.dockerignore', '.npmignore', '.prettierignore', '.eslintignore', '.stylelintignore', '.vscodeignore', '.helmignore', '.gcloudignore'], aliases: ['Ignore', 'ignore'] },
    tokens: ignore,
    config: hashComments
  }
]

export function registerLanguages() {
  for (const names of extraNames) monaco.languages.register(names)
  for (const { lang, tokens, config } of custom) {
    monaco.languages.register(lang)
    monaco.languages.setMonarchTokensProvider(lang.id, tokens)
    monaco.languages.setLanguageConfiguration(lang.id, config)
  }
}
