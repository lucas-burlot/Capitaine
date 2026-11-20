import { Marked } from 'marked'
import DOMPurify from 'dompurify'

const marked = new Marked({ gfm: true, breaks: false })

// Claude's answers repeat across renders while streaming: the last ones are cached.
const cache = new Map<string, string>()
const CACHE_SIZE = 200

/** Claude's Markdown as sanitized HTML. */
export function renderMarkdown(source: string): string {
  const hit = cache.get(source)
  if (hit !== undefined) return hit
  const html = DOMPurify.sanitize(marked.parse(source, { async: false }), { ADD_ATTR: ['target'] })
  cache.set(source, html)
  if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value!)
  return html
}

/** Links open in the browser; code blocks get a copy button (event delegation on the transcript). */
export function onMarkdownClick(event: React.MouseEvent): void {
  const target = event.target as HTMLElement
  const copy = target.closest<HTMLElement>('[data-copy-code]')
  if (copy) {
    const code = copy.parentElement?.querySelector('code')?.textContent ?? ''
    window.capitaine.files.copyText(code)
    copy.textContent = 'Copié'
    setTimeout(() => (copy.textContent = 'Copier'), 1200)
    return
  }
  const anchor = target.closest('a')
  const href = anchor?.getAttribute('href')
  if (!href) return
  event.preventDefault()
  if (/^https?:\/\//i.test(href)) window.open(href)
}

// Monaco is heavy: it loads with the first code block, not with the chat.
const colorize = () => import('@/features/editor/colorize')

/** Adds the copy buttons to a rendered block's `<pre>`s and colours their code. */
export function decorateCodeBlocks(root: HTMLElement): void {
  if (root.querySelector('pre > code[class*="language-"]')) void colorize().then((m) => m.colorizeCodeBlocks(root), () => {})
  for (const pre of root.querySelectorAll('pre')) {
    if (pre.querySelector('[data-copy-code]')) continue
    const button = document.createElement('button')
    button.type = 'button'
    button.dataset.copyCode = ''
    button.className = 'chat-copy-code'
    button.textContent = 'Copier'
    pre.appendChild(button)
  }
}
