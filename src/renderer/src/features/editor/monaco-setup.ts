// Monaco bundled locally (no CDN: works offline and under the app's CSP), loaded only when an
// editor tab opens. Worker wiring follows Orca's setup.
import * as monaco from 'monaco-editor'
import { json as monacoJSON, typescript as monacoTS } from 'monaco-editor'
import 'monaco-editor/min/vs/editor/editor.main.css'
import editorWorker from 'monaco-editor/esm/vs/editor/editor.worker?worker'
import jsonWorker from 'monaco-editor/esm/vs/language/json/json.worker?worker'
import cssWorker from 'monaco-editor/esm/vs/language/css/css.worker?worker'
import htmlWorker from 'monaco-editor/esm/vs/language/html/html.worker?worker'
import tsWorker from 'monaco-editor/esm/vs/language/typescript/ts.worker?worker'
import { registerLanguages } from './languages'

globalThis.MonacoEnvironment = {
  getWorker(_workerId, label) {
    switch (label) {
      case 'json':
        return new jsonWorker()
      case 'css':
      case 'scss':
      case 'less':
        return new cssWorker()
      case 'html':
      case 'handlebars':
      case 'razor':
        return new htmlWorker()
      case 'typescript':
      case 'javascript':
        return new tsWorker()
      default:
        return new editorWorker()
    }
  }
}

// Monaco rejects in-flight work with a "Canceled" error when a model or editor is disposed (closing a
// tab mid-tokenize). It is expected; keep it out of the error log so real failures stay visible.
window.addEventListener('unhandledrejection', (event) => {
  const reason = event.reason as { name?: string; message?: string } | undefined
  if (reason?.name === 'Canceled' && reason.message === 'Canceled') event.preventDefault()
})

// The worker can't resolve the project's imports, so its diagnostics would be all false positives.
const diagnostics = { noSemanticValidation: true, noSyntaxValidation: true, noSuggestionDiagnostics: true }
monacoTS.typescriptDefaults.setDiagnosticsOptions(diagnostics)
monacoTS.javascriptDefaults.setDiagnosticsOptions(diagnostics)
for (const defaults of [monacoTS.typescriptDefaults, monacoTS.javascriptDefaults]) {
  defaults.setCompilerOptions({ ...defaults.getCompilerOptions(), jsx: monacoTS.JsxEmit.Preserve, allowJs: true })
}

// tsconfig.json, .jsonc, VS Code settings…: comments and trailing commas are everywhere, don't flag them.
monacoJSON.jsonDefaults.setDiagnosticsOptions({ validate: true, allowComments: true, trailingCommas: 'ignore' })

registerLanguages()

// Same palette as the app shell and the terminal theme.
monaco.editor.defineTheme('capitaine', {
  base: 'vs-dark',
  inherit: true,
  rules: [],
  colors: {
    'editor.background': '#0e0f13',
    'editor.foreground': '#d6d8df',
    'editorCursor.foreground': '#e2c08d',
    'editor.lineHighlightBackground': '#15171c',
    'editor.lineHighlightBorder': '#00000000',
    'editor.selectionBackground': '#3a3f4f',
    'editor.inactiveSelectionBackground': '#2a2e38',
    'editorLineNumber.foreground': '#3d4250',
    'editorLineNumber.activeForeground': '#8a8f9c',
    'editorIndentGuide.background1': '#1f2229',
    'editorIndentGuide.activeBackground1': '#353a45',
    'editorWhitespace.foreground': '#2a2e37',
    'editorWidget.background': '#1b1e24',
    'editorWidget.border': '#262a32',
    'editorSuggestWidget.background': '#1b1e24',
    'editorSuggestWidget.border': '#262a32',
    'editorSuggestWidget.selectedBackground': '#262a32',
    'editorHoverWidget.background': '#1b1e24',
    'editorHoverWidget.border': '#262a32',
    'input.background': '#15171c',
    'input.border': '#262a32',
    'focusBorder': '#e2c08d80',
    'scrollbarSlider.background': '#2a2e3780',
    'scrollbarSlider.hoverBackground': '#3a3f4fa0',
    'scrollbarSlider.activeBackground': '#4a5060c0',
    'minimap.background': '#0e0f13',
    // Diffs: soft line tint, stronger on the exact characters that changed.
    'diffEditor.insertedLineBackground': '#3fb95018',
    'diffEditor.removedLineBackground': '#f8514918',
    'diffEditor.insertedTextBackground': '#3fb95040',
    'diffEditor.removedTextBackground': '#f8514940',
    'diffEditorGutter.insertedLineBackground': '#3fb95028',
    'diffEditorGutter.removedLineBackground': '#f8514928',
    'diffEditor.diagonalFill': '#262a3280'
  }
})

export { monaco }
