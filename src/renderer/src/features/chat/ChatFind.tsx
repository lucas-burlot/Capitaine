import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ChevronDown, ChevronUp, X } from 'lucide-react'

const MAX_MATCHES = 1000
const ALL = 'chat-find'
const CURRENT = 'chat-find-current'

// Written here rather than in styles.css: the CSS build drops `::highlight()` rules it doesn't know.
function ensureHighlightStyles() {
  if (document.getElementById('chat-find-styles')) return
  const style = document.createElement('style')
  style.id = 'chat-find-styles'
  style.textContent = `::highlight(${ALL}) { background-color: color-mix(in srgb, var(--color-accent) 30%, transparent); }
::highlight(${CURRENT}) { background-color: var(--color-accent); color: var(--color-bg); }`
  document.head.appendChild(style)
}

interface Props {
  /** The scrolling transcript the search runs over. */
  scrollRef: React.RefObject<HTMLDivElement | null>
  /** Changes when the transcript does, so the matches follow new messages. */
  content: unknown
  onClose(): void
}

/**
 * Find bar over the chat (Ctrl/⌘+F): every match is highlighted with the CSS Custom Highlight API,
 * so the transcript's DOM is left alone, and matches may span the spans of coloured code.
 * Only what is drawn is searched: folded tool groups keep their steps to themselves.
 */
export function ChatFind({ scrollRef, content, onClose }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [query, setQuery] = useState('')
  const [ranges, setRanges] = useState<Range[]>([])
  const [current, setCurrent] = useState(0)

  useEffect(() => {
    ensureHighlightStyles()
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [])

  // Matches again as the query or the transcript changes, a moment after the last change.
  useEffect(() => {
    const root = scrollRef.current
    if (!root) return
    const timer = setTimeout(() => {
      const found = findRanges(root, query)
      setRanges(found)
      setCurrent((index) => (found.length === 0 ? 0 : Math.min(index, found.length - 1)))
    }, 120)
    return () => clearTimeout(timer)
  }, [query, content, scrollRef])

  useEffect(() => setCurrent(0), [query])

  useLayoutEffect(() => {
    CSS.highlights.set(ALL, new Highlight(...ranges))
    const active = ranges[current]
    if (active) {
      CSS.highlights.set(CURRENT, new Highlight(active))
      reveal(scrollRef.current, active)
    } else CSS.highlights.delete(CURRENT)
  }, [ranges, current, scrollRef])

  useEffect(
    () => () => {
      CSS.highlights.delete(ALL)
      CSS.highlights.delete(CURRENT)
    },
    []
  )

  const step = (by: number) => {
    if (ranges.length) setCurrent((index) => (index + by + ranges.length) % ranges.length)
  }

  return (
    <div className="absolute top-2 right-4 z-30 flex items-center gap-1 rounded-lg border border-line bg-panel py-1 pr-1 pl-2.5 shadow-xl shadow-black/40">
      <input
        ref={inputRef}
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault()
            step(e.shiftKey ? -1 : 1)
          } else if (e.key === 'Escape') {
            e.preventDefault()
            e.stopPropagation()
            onClose()
          }
        }}
        placeholder="Rechercher dans le chat"
        aria-label="Rechercher dans le chat"
        spellCheck={false}
        className="w-48 bg-transparent text-[12.5px] text-fg outline-none placeholder:text-faint"
      />
      <span className="min-w-12 text-right text-[11px] text-faint tabular-nums" aria-live="polite">
        {query.trim() ? (ranges.length ? `${current + 1}/${ranges.length}${ranges.length === MAX_MATCHES ? '+' : ''}` : 'Aucun') : ''}
      </span>
      <FindButton title="Précédent (Maj+Entrée)" onClick={() => step(-1)} disabled={ranges.length === 0}>
        <ChevronUp size={13} />
      </FindButton>
      <FindButton title="Suivant (Entrée)" onClick={() => step(1)} disabled={ranges.length === 0}>
        <ChevronDown size={13} />
      </FindButton>
      <FindButton title="Fermer (Échap)" onClick={onClose}>
        <X size={13} />
      </FindButton>
    </div>
  )
}

function FindButton({ title, onClick, disabled, children }: { title: string; onClick(): void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button title={title} aria-label={title} onClick={onClick} disabled={disabled} className="rounded p-1 text-muted hover:bg-panel-2 hover:text-fg disabled:opacity-30">
      {children}
    </button>
  )
}

/** Case-insensitive matches of `query` in the text drawn under `root`, across element boundaries. */
function findRanges(root: HTMLElement, query: string): Range[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return []
  const nodes: Text[] = []
  const starts: number[] = []
  let text = ''
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode: (node) => (node.parentElement?.closest('button[data-copy-code], .chat-copy-code') ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT)
  })
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    nodes.push(node as Text)
    starts.push(text.length)
    text += (node as Text).data
  }
  const haystack = text.toLowerCase()
  const ranges: Range[] = []
  let n = 0
  for (let at = haystack.indexOf(needle); at !== -1 && ranges.length < MAX_MATCHES; at = haystack.indexOf(needle, at + needle.length)) {
    while (n + 1 < nodes.length && starts[n + 1] <= at) n++
    let m = n
    const end = at + needle.length
    while (m + 1 < nodes.length && starts[m + 1] < end) m++
    const range = document.createRange()
    range.setStart(nodes[n], at - starts[n])
    range.setEnd(nodes[m], end - starts[m])
    ranges.push(range)
  }
  return ranges
}

/** Scrolls the transcript so the match sits in its middle third, when it's out of view. */
function reveal(scroller: HTMLElement | null, range: Range) {
  if (!scroller) return
  const box = range.getBoundingClientRect()
  const view = scroller.getBoundingClientRect()
  if (box.top >= view.top + 40 && box.bottom <= view.bottom - 40) return
  scroller.scrollTop += box.top - view.top - view.height / 3
}
