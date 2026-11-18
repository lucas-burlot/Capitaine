import { memo, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Brain, ChevronRight, CircleCheck, CircleX, Info, LoaderCircle, OctagonX, Slash, TriangleAlert } from 'lucide-react'
import type { ChatItem, ChatItemOf } from './chat-fold'
import { decorateCodeBlocks, renderMarkdown } from './chat-markdown'
import { shortPath, toolDisplay } from './tool-display'

interface Props {
  items: ChatItem[]
  cwd: string
  /** Turn in progress: the last tool without a result is running. */
  working: boolean
}

/** The conversation, top-level rows; subagent rows nest under their Task call. */
export function ChatTranscript({ items, cwd, working }: Props) {
  const children = useMemo(() => {
    const map = new Map<string, ChatItem[]>()
    for (const item of items) {
      if (!item.parentId) continue
      const list = map.get(item.parentId) ?? []
      list.push(item)
      map.set(item.parentId, list)
    }
    return map
  }, [items])
  const roots = useMemo(() => items.filter((item) => !item.parentId), [items])
  return (
    <div className="flex flex-col gap-3">
      {roots.map((item) => (
        <Row key={item.id} item={item} cwd={cwd} working={working} childrenOf={children} />
      ))}
    </div>
  )
}

interface RowProps {
  item: ChatItem
  cwd: string
  working: boolean
  childrenOf: Map<string, ChatItem[]>
}

function Row({ item, cwd, working, childrenOf }: RowProps) {
  switch (item.kind) {
    case 'user':
      return <UserRow item={item} />
    case 'text':
      return <TextRow text={item.text} streaming={item.streaming} />
    case 'thinking':
      return <ThinkingRow item={item} />
    case 'tool':
      return <ToolRow item={item} cwd={cwd} working={working} childrenOf={childrenOf} />
    case 'command':
      return <CommandRow item={item} />
    case 'notice':
      return <NoticeRow item={item} />
    case 'turn':
      return <TurnRow item={item} />
  }
}

function UserRow({ item }: { item: ChatItemOf<'user'> }) {
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="chat-selectable max-w-[85%] rounded-lg border border-line bg-panel-2 px-3 py-2 text-[13.5px] leading-relaxed whitespace-pre-wrap text-fg">
        {item.images > 0 && (
          <div className="mb-1 text-[11px] text-muted">
            {item.images} image{item.images > 1 ? 's' : ''} jointe{item.images > 1 ? 's' : ''}
          </div>
        )}
        {item.text}
      </div>
      {item.state === 'queued' && <span className="text-[11px] text-faint">En attente — Claude le lira après l’étape en cours</span>}
      {item.state === 'cancelled' && <span className="text-[11px] text-faint">Annulé par l’interruption</span>}
    </div>
  )
}

const TextRow = memo(function TextRow({ text, streaming }: { text: string; streaming: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  const html = useMemo(() => renderMarkdown(text), [text])
  useLayoutEffect(() => {
    if (ref.current && !streaming) decorateCodeBlocks(ref.current)
  }, [html, streaming])
  return (
    <div
      ref={ref}
      className={`markdown-body chat-markdown chat-selectable ${streaming ? 'chat-streaming' : ''}`}
      dangerouslySetInnerHTML={{ __html: html }}
    />
  )
})

function ThinkingRow({ item }: { item: ChatItemOf<'thinking'> }) {
  const [open, setOpen] = useState(false)
  // Withheld thinking (empty once done) has nothing to show.
  if (!item.text.trim() && !item.streaming) return null
  return (
    <div className="text-[12.5px]">
      <button className="flex items-center gap-1.5 text-faint hover:text-muted" onClick={() => setOpen(!open)}>
        <ChevronRight size={12} className={`transition-transform ${open ? 'rotate-90' : ''}`} />
        <Brain size={12} className={item.streaming ? 'animate-pulse' : ''} />
        {item.streaming ? 'Réflexion…' : 'Réflexion'}
      </button>
      {open && <div className="chat-selectable mt-1.5 ml-[18px] border-l border-line pl-3 whitespace-pre-wrap text-muted italic">{item.text}</div>}
    </div>
  )
}

function ToolRow({ item, cwd, working, childrenOf }: { item: ChatItemOf<'tool'>; cwd: string; working: boolean; childrenOf: Map<string, ChatItem[]> }) {
  const [open, setOpen] = useState(false)
  const display = toolDisplay(item.name, item.input, cwd)
  const Icon = display.icon
  const nested = childrenOf.get(item.id) ?? []
  const running = !item.result && working
  const failed = item.result?.isError === true

  if (item.name === 'TodoWrite') return <TodoRow input={item.input} />

  return (
    <div className="text-[12.5px]">
      <button
        className="group flex w-full min-w-0 items-center gap-2 rounded-md px-1 py-0.5 text-left hover:bg-panel-2/60"
        onClick={() => setOpen(!open)}
        title={display.detail}
      >
        <ChevronRight size={12} className={`shrink-0 text-faint transition-transform ${open ? 'rotate-90' : ''}`} />
        <Icon size={13} className={`shrink-0 ${failed ? 'text-red-400' : 'text-accent/80'}`} />
        <span className="shrink-0 font-medium text-fg">{display.title}</span>
        {display.detail && <span className="min-w-0 truncate font-mono text-[11.5px] text-muted">{display.detail}</span>}
        <span className="ml-auto flex shrink-0 items-center gap-1.5 pl-2">
          {nested.length > 0 && <span className="text-[11px] text-faint">{nested.filter((n) => n.kind === 'tool').length} étapes</span>}
          {running ? (
            <LoaderCircle size={12} className="animate-spin text-sky-400" />
          ) : failed ? (
            <CircleX size={12} className="text-red-400" />
          ) : item.result ? (
            <CircleCheck size={12} className="text-emerald-400/80" />
          ) : null}
        </span>
      </button>
      {open && <ToolDetails item={item} cwd={cwd} />}
      {nested.length > 0 && (open || running) && (
        <div className="mt-1.5 ml-[9px] flex flex-col gap-2 border-l border-line pl-4">
          {nested.map((child) => (
            <Row key={child.id} item={child} cwd={cwd} working={working} childrenOf={childrenOf} />
          ))}
        </div>
      )}
    </div>
  )
}

const MAX_OUTPUT_CHARS = 20_000

function ToolDetails({ item, cwd }: { item: ChatItemOf<'tool'>; cwd: string }) {
  const { input, result } = item
  const output = result?.text ? (result.text.length > MAX_OUTPUT_CHARS ? `${result.text.slice(0, MAX_OUTPUT_CHARS)}\n… (tronqué)` : result.text) : ''
  let body: React.ReactNode
  switch (item.name) {
    case 'Bash':
      body = (
        <>
          <Pre>{`$ ${String(input.command ?? '')}`}</Pre>
          {output && <Pre tone={result?.isError ? 'error' : undefined}>{output}</Pre>}
        </>
      )
      break
    case 'Edit':
      body = (
        <>
          <Diff path={shortPath(String(input.file_path ?? ''), cwd)} before={String(input.old_string ?? '')} after={String(input.new_string ?? '')} />
          {result?.isError && <Pre tone="error">{output}</Pre>}
        </>
      )
      break
    case 'MultiEdit': {
      const edits = Array.isArray(input.edits) ? (input.edits as { old_string?: string; new_string?: string }[]) : []
      body = (
        <>
          {edits.map((edit, i) => (
            <Diff key={i} path={i === 0 ? shortPath(String(input.file_path ?? ''), cwd) : null} before={edit.old_string ?? ''} after={edit.new_string ?? ''} />
          ))}
          {result?.isError && <Pre tone="error">{output}</Pre>}
        </>
      )
      break
    }
    case 'Write':
      body = (
        <>
          <Diff path={shortPath(String(input.file_path ?? ''), cwd)} before="" after={String(input.content ?? '')} />
          {result?.isError && <Pre tone="error">{output}</Pre>}
        </>
      )
      break
    case 'Task':
    case 'Agent':
      body = (
        <>
          {typeof input.prompt === 'string' && <Pre>{input.prompt}</Pre>}
          {output && <TextRow text={output} streaming={false} />}
        </>
      )
      break
    default:
      body = (
        <>
          {Object.keys(input).length > 0 && <Pre>{JSON.stringify(input, null, 2)}</Pre>}
          {output && <Pre tone={result?.isError ? 'error' : undefined}>{output}</Pre>}
          {result && result.images > 0 && <div className="text-[11px] text-faint">{result.images} image(s) renvoyée(s)</div>}
        </>
      )
  }
  return <div className="mt-1.5 ml-[18px] flex flex-col gap-1.5">{body}</div>
}

function Pre({ children, tone }: { children: React.ReactNode; tone?: 'error' }) {
  return (
    <pre
      className={`chat-selectable scrollbar-sleek max-h-80 overflow-auto rounded-md border px-3 py-2 font-mono text-[11.5px] leading-relaxed whitespace-pre-wrap break-words ${
        tone === 'error' ? 'border-red-500/30 bg-red-500/5 text-red-300' : 'border-line bg-panel text-muted'
      }`}
    >
      {children}
    </pre>
  )
}

const MAX_DIFF_LINES = 400

export function Diff({ path, before, after }: { path: string | null; before: string; after: string }) {
  // A final newline isn't an extra line.
  const removed = before ? before.replace(/\n$/, '').split('\n') : []
  const added = after ? after.replace(/\n$/, '').split('\n') : []
  const total = removed.length + added.length
  const clip = (lines: string[], budget: number) => lines.slice(0, Math.max(0, budget))
  const shownRemoved = clip(removed, MAX_DIFF_LINES)
  const shownAdded = clip(added, MAX_DIFF_LINES - shownRemoved.length)
  return (
    <div className="overflow-hidden rounded-md border border-line bg-panel">
      {path && <div className="border-b border-line px-3 py-1 font-mono text-[11px] text-faint">{path}</div>}
      <div className="chat-selectable scrollbar-sleek max-h-96 overflow-auto py-1 font-mono text-[11.5px] leading-relaxed">
        {shownRemoved.map((line, i) => (
          <div key={`r${i}`} className="bg-red-500/10 px-3 whitespace-pre-wrap text-red-300">
            <span className="mr-2 select-none text-red-400/60">-</span>
            {line}
          </div>
        ))}
        {shownAdded.map((line, i) => (
          <div key={`a${i}`} className="bg-emerald-500/10 px-3 whitespace-pre-wrap text-emerald-300">
            <span className="mr-2 select-none text-emerald-400/60">+</span>
            {line}
          </div>
        ))}
        {total > MAX_DIFF_LINES && <div className="px-3 text-faint">… {total - MAX_DIFF_LINES} lignes de plus</div>}
      </div>
    </div>
  )
}

function TodoRow({ input }: { input: Record<string, unknown> }) {
  const todos = Array.isArray(input.todos) ? (input.todos as { content?: string; status?: string; activeForm?: string }[]) : []
  if (todos.length === 0) return null
  return (
    <div className="rounded-md border border-line bg-panel px-3 py-2 text-[12.5px]">
      <div className="mb-1 text-[11px] font-medium tracking-wide text-faint uppercase">Tâches</div>
      <ul className="flex flex-col gap-0.5">
        {todos.map((todo, i) => (
          <li key={i} className="flex items-start gap-2">
            {todo.status === 'completed' ? (
              <CircleCheck size={13} className="mt-0.5 shrink-0 text-emerald-400/80" />
            ) : todo.status === 'in_progress' ? (
              <LoaderCircle size={13} className="mt-0.5 shrink-0 text-sky-400" />
            ) : (
              <span className="mt-[3px] h-[11px] w-[11px] shrink-0 rounded-full border border-faint" />
            )}
            <span className={todo.status === 'completed' ? 'text-faint line-through' : todo.status === 'in_progress' ? 'text-fg' : 'text-muted'}>
              {todo.status === 'in_progress' ? (todo.activeForm ?? todo.content) : todo.content}
            </span>
          </li>
        ))}
      </ul>
    </div>
  )
}

function CommandRow({ item }: { item: ChatItemOf<'command'> }) {
  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex items-center gap-1 rounded-md border border-line bg-panel-2 px-2 py-1 font-mono text-[12px] text-fg">
        <Slash size={11} className="text-accent" />
        {item.name}
        {item.args && <span className="text-muted">{item.args}</span>}
      </div>
      {item.output && <div className="w-full"><Pre>{item.output}</Pre></div>}
    </div>
  )
}

function NoticeRow({ item }: { item: ChatItemOf<'notice'> }) {
  const Icon = item.tone === 'error' ? OctagonX : item.tone === 'warning' ? TriangleAlert : Info
  const color = item.tone === 'error' ? 'text-red-300' : item.tone === 'warning' ? 'text-amber-300' : 'text-muted'
  return (
    <div className={`chat-selectable flex items-start gap-2 text-[12.5px] ${color}`}>
      <Icon size={13} className="mt-0.5 shrink-0" />
      <span className="whitespace-pre-wrap">{item.text}</span>
    </div>
  )
}

function TurnRow({ item }: { item: ChatItemOf<'turn'> }) {
  if (item.outcome === 'error') {
    return (
      <div className="chat-selectable flex items-start gap-2 rounded-md border border-red-500/30 bg-red-500/5 px-3 py-2 text-[12.5px] text-red-300">
        <OctagonX size={13} className="mt-0.5 shrink-0" />
        <span className="whitespace-pre-wrap">{item.error}</span>
      </div>
    )
  }
  // An interruption already shows as its own notice.
  const parts = [item.durationMs !== null ? formatDuration(item.durationMs) : null].filter(Boolean)
  if (parts.length === 0) return null
  return <div className="text-[11px] text-faint">{parts.join(' · ')}</div>
}

export function formatDuration(ms: number): string {
  const seconds = Math.round(ms / 1000)
  if (seconds < 60) return `${seconds} s`
  const minutes = Math.floor(seconds / 60)
  return `${minutes} min ${String(seconds % 60).padStart(2, '0')}`
}
