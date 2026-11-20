import { monaco } from './monaco-setup'

/** Monaco language id for a fenced block's info string (`ts`, `bash`, `py`…). */
export function languageFor(info: string): string | null {
  const name = info.toLowerCase()
  for (const lang of monaco.languages.getLanguages()) {
    if (lang.id === name || lang.aliases?.some((a) => a.toLowerCase() === name) || lang.extensions?.includes(`.${name}`)) return lang.id
  }
  return null
}

/** Colours the fenced code blocks (`<pre><code class="language-…">`) under `root` with Monaco's tokenizers. */
export function colorizeCodeBlocks(root: HTMLElement): void {
  for (const code of root.querySelectorAll<HTMLElement>('pre > code[class*="language-"]')) {
    if (code.dataset.colorized !== undefined) continue
    const info = /language-(\S+)/.exec(code.className)?.[1]
    const lang = info ? languageFor(info) : null
    if (!lang) continue
    code.dataset.colorized = ''
    const text = code.textContent ?? ''
    monaco.editor
      .colorize(text.replace(/\n$/, ''), lang, { tabSize: 2 })
      .then((html) => {
        // Monaco emits non-breaking spaces; plain ones keep copied code clean (the block is `white-space: pre`).
        if (code.isConnected && code.textContent === text) code.innerHTML = html.replace(/&#160;|&nbsp;| /g, ' ')
      })
      .catch(() => {})
  }
}
