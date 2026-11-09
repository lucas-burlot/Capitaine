import { forwardRef, useEffect, useImperativeHandle, useRef } from 'react'
import { Marked, type Tokens } from 'marked'
import DOMPurify from 'dompurify'
import { useApp } from '@/features/workspace/workspace-store'
import { monaco } from './monaco-setup'

export function isMarkdownPath(path: string): boolean {
  return /\.(md|markdown|mdx|mdown|mkd)$/i.test(path)
}

/** GitHub-style anchor: lowercase, punctuation dropped, spaces to dashes. */
function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/<[^>]+>/g, '')
    .replace(/[^\p{L}\p{N}\s_-]/gu, '')
    .replace(/\s+/g, '-')
}

function render(source: string): string {
  const seen = new Map<string, number>()
  const marked = new Marked({ gfm: true, breaks: false })
  marked.use({
    renderer: {
      // Headings get ids so `[voir](#section)` links work, deduplicated like GitHub does.
      heading(this: { parser: { parseInline(tokens: Tokens.Generic[]): string } }, token: Tokens.Heading) {
        const html = this.parser.parseInline(token.tokens)
        const base = slugify(token.text) || 'section'
        const count = seen.get(base) ?? 0
        seen.set(base, count + 1)
        const id = count === 0 ? base : `${base}-${count}`
        return `<h${token.depth} id="${id}">${html}</h${token.depth}>\n`
      }
    }
  })
  const html = marked.parse(stripFrontMatter(source), { async: false })
  return DOMPurify.sanitize(html)
}

/** YAML front matter (skills, agents) shown as a code block rather than a stray `<hr>` and paragraph. */
function stripFrontMatter(source: string): string {
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(source)
  if (!match) return source
  return '```yaml\n' + match[1] + '\n```\n\n' + source.slice(match[0].length)
}

/** Monaco language id for a fenced block's info string (`ts`, `bash`, `py`…). */
function languageFor(info: string): string | null {
  const name = info.toLowerCase()
  for (const lang of monaco.languages.getLanguages()) {
    if (lang.id === name || lang.aliases?.some((a) => a.toLowerCase() === name) || lang.extensions?.includes(`.${name}`)) return lang.id
  }
  return null
}

function colorizeBlocks(root: HTMLElement) {
  for (const code of root.querySelectorAll<HTMLElement>('pre > code[class*="language-"]')) {
    const info = /language-(\S+)/.exec(code.className)?.[1]
    const lang = info ? languageFor(info) : null
    if (!lang) continue
    const text = code.textContent ?? ''
    monaco.editor
      .colorize(text.replace(/\n$/, ''), lang, { tabSize: 2 })
      .then((html) => {
        // Monaco emits non-breaking spaces; plain ones keep copied code clean (the block is `white-space: pre`).
        if (code.isConnected && code.textContent === text) code.innerHTML = html.replace(/&#160;|&nbsp;|\u00a0/g, ' ')
      })
      .catch(() => {})
  }
}

/** Resolves a relative link against the file's folder, keeping the platform's separator. */
function resolveRelative(fromFile: string, href: string): string {
  const sep = fromFile.includes('\\') && !fromFile.includes('/') ? '\\' : '/'
  const parts = fromFile.split(/[\\/]/)
  parts.pop()
  for (const segment of decodeURIComponent(href).split('/')) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') parts.pop()
    else parts.push(segment)
  }
  return parts.join(sep)
}

export interface MarkdownPreviewHandle {
  /** Scrolls to the same relative position as the editor (0 to 1). */
  scrollToRatio(ratio: number): void
}

interface Props {
  model: monaco.editor.ITextModel
  projectId: string
  path: string
  onToggle(): void
}

/** Rendered view of a Markdown buffer, following unsaved edits as you type. */
export const MarkdownPreview = forwardRef<MarkdownPreviewHandle, Props>(function MarkdownPreview({ model, projectId, path, onToggle }, ref) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const bodyRef = useRef<HTMLDivElement>(null)

  useImperativeHandle(ref, () => ({
    scrollToRatio(ratio) {
      const el = scrollRef.current
      if (el) el.scrollTop = ratio * (el.scrollHeight - el.clientHeight)
    }
  }))

  useEffect(() => {
    const paint = () => {
      const body = bodyRef.current
      if (!body) return
      body.innerHTML = render(model.getValue())
      colorizeBlocks(body)
    }
    paint()
    let timer: ReturnType<typeof setTimeout> | undefined
    const sub = model.onDidChangeContent(() => {
      clearTimeout(timer)
      timer = setTimeout(paint, 120)
    })
    return () => {
      clearTimeout(timer)
      sub.dispose()
    }
  }, [model])

  const onClick = (event: React.MouseEvent) => {
    const anchor = (event.target as HTMLElement).closest('a')
    const href = anchor?.getAttribute('href')
    if (!href) return
    event.preventDefault()
    if (href.startsWith('#')) {
      const target = bodyRef.current?.querySelector(`[id="${CSS.escape(decodeURIComponent(href.slice(1)))}"]`)
      target?.scrollIntoView({ behavior: 'smooth', block: 'start' })
      return
    }
    // The main process sends http(s) links to the default browser.
    if (/^https?:\/\//i.test(href)) {
      window.open(href)
      return
    }
    if (/^[a-z][a-z0-9+.-]*:/i.test(href)) return
    const file = href.split('#')[0]
    if (file) useApp.getState().openFile(projectId, resolveRelative(path, file))
  }

  return (
    <div
      ref={scrollRef}
      tabIndex={-1}
      onClick={onClick}
      onKeyDown={(event) => {
        if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 'v') {
          event.preventDefault()
          onToggle()
        }
      }}
      className="scrollbar-sleek h-full overflow-y-auto outline-none"
    >
      <div ref={bodyRef} className="markdown-body mx-auto max-w-[860px] px-8 py-6" />
    </div>
  )
})
