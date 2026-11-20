import { memo, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Brain, ChevronRight, CircleCheck, CircleX, Info, LoaderCircle, OctagonX, Slash, SquareTerminal, TriangleAlert } from 'lucide-react'
import { shortcutLabel } from '@/lib/platform'
import { togglePaneView } from './agent-launch'
import { looksLikeMarkdown, type ChatItem, type ChatItemOf } from './chat-fold'
import { decorateCodeBlocks, renderMarkdown } from './chat-markdown'
import { lineDiff } from './line-diff'
import { shortPath, STANDALONE_TOOLS, summarizeTools, toolDisplay } from './tool-display'

interface Props {
  chatId: string
  items: ChatItem[]
  cwd: string
  /** Turn in progress: the last tool without a result is running. */
  working: boolean
}

/**
 * The conversation, top-level rows; subagent rows nest under their Task call. While Claude streams,
 * only the rows that changed redraw: rows are memoized, and each Task call's list of nested rows
 * keeps its identity until something in it (or deeper) changes.
 */
export function ChatTranscript({ chatId, items, cwd, working }: Props) {
  const previous = useRef(new Map<string, ChatItem[]>())
  const children = useMemo(() => {
    const grouped = new Map<string, ChatItem[]>()
    const parentOf = new Map<string, string>()
    for (const item of items) {
      if (!item.parentId) continue
      parentOf.set(item.id, item.parentId)
      const list = grouped.get(item.parentId)
      if (list) list.push(item)
      else grouped.set(item.parentId, [item])
    }
    const changed = new Set<string>()
    for (const [id, list] of grouped) {
      const old = previous.current.get(id)
      if (!old || old.length !== list.length || old.some((item, i) => item !== list[i])) changed.add(id)
    }
    // A change in a nested subagent redraws every Task call above it.
    for (const id of [...changed]) {
      for (let up = parentOf.get(id); up && !changed.has(up); up = parentOf.get(up)) changed.add(up)
    }
    const map = new Map<string, ChatItem[]>()
    for (const [id, list] of grouped) map.set(id, changed.has(id) ? list : previous.current.get(id)!)
    previous.current = map
    return map
  }, [items])
  const blocks = useMemo(() => blocksOf(items.filter((item) => !item.parentId)), [items])
  return (
    <div className="flex flex-col gap-3">
      {blocks.map((block, i) =>
        block.kind === 'row' ? (
          <Row key={block.item.id} chatId={chatId} item={block.item} cwd={cwd} working={working} childrenOf={children} />
        ) : (
          <ToolGroup key={block.id} chatId={chatId} items={block.items} cwd={cwd} working={working} live={working && i === blocks.length - 1} childrenOf={children} />
        )
      )}
    </div>
  )
}

type Block = { kind: 'row'; item: ChatItem } | { kind: 'group'; id: string; items: ChatItem[] }

/**
 * Tool calls in a row (and Claude's thinking between them) fold into one group once there are two
 * of them, so the answers stay what the eye follows. Tasks, questions and plans keep their row.
 */
function blocksOf(roots: ChatItem[]): Block[] {
  const blocks: Block[] = []
  let run: ChatItem[] = []
  const flush = () => {
    if (run.filter((item) => item.kind === 'tool').length >= 2) blocks.push({ kind: 'group', id: `group:${run[0].id}`, items: run })
    else for (const item of run) blocks.push({ kind: 'row', item })
    run = []
  }
  for (const item of roots) {
    if (item.kind === 'thinking' || (item.kind === 'tool' && !STANDALONE_TOOLS.has(item.name))) {
      run.push(item)
      continue
    }
    flush()
    blocks.push({ kind: 'row', item })
  }
  flush()
  return blocks
}

interface ToolGroupProps {
  chatId: string
  items: ChatItem[]
  cwd: string
  working: boolean
  /** The turn's last block while Claude works: the header follows the step in progress. */
  live: boolean
  childrenOf: Map<string, ChatItem[]>
}

const ToolGroup = memo(ToolGroupContent, (a, b) => {
  if (a.chatId !== b.chatId || a.cwd !== b.cwd || a.working !== b.working || a.live !== b.live || a.items.length !== b.items.length) return false
  return a.items.every((item, i) => item === b.items[i] && a.childrenOf.get(item.id) === b.childrenOf.get(item.id))
})

function ToolGroupContent({ chatId, items, cwd, working, live, childrenOf }: ToolGroupProps) {
  const [open, setOpen] = useState(false)
  const tools = items.filter((item): item is ChatItemOf<'tool'> => item.kind === 'tool')
  const failed = tools.filter((tool) => tool.result?.isError).length
  const last = items[items.length - 1]
  const pending = live ? [...tools].reverse().find((tool) => !tool.result) : undefined
  const thinking = live && last.kind === 'thinking' && last.streaming
  const current = pending ? toolDisplay(pending.name, pending.input, cwd) : null
  const CurrentIcon = current?.icon
  const bodyId = `${items[0].id}:steps`

  return (
    <div className="text-[12.5px]">
      <button
        className="group flex w-full min-w-0 items-center gap-2 rounded-md px-1 py-0.5 text-left text-muted hover:bg-panel-2/60 hover:text-fg"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-controls={bodyId}
      >
        <ChevronRight size={12} className={`shrink-0 text-faint transition-transform ${open ? 'rotate-90' : ''}`} />
        {current && CurrentIcon ? (
          <>
            <LoaderCircle size={13} className="shrink-0 animate-spin text-sky-400" />
            <span className="shrink-0 text-fg">{current.title}</span>
            {current.detail && <span className="min-w-0 truncate font-mono text-[11.5px] text-faint">{current.detail}</span>}
            <span className="ml-auto shrink-0 pl-2 text-[11px] text-faint">{tools.length} actions</span>
          </>
        ) : thinking ? (
          <>
            <Brain size={13} className="shrink-0 animate-pulse text-faint" />
            <span className="shrink-0">Réflexion…</span>
            <span className="ml-auto shrink-0 pl-2 text-[11px] text-faint">{tools.length} actions</span>
          </>
        ) : (
          <span className="min-w-0 truncate">
            <span className="text-fg/80">{tools.length} actions</span>
            <span className="text-faint"> · </span>
            {summarizeTools(tools.map((tool) => tool.name))}
            {failed > 0 && (
              <span className="text-red-400">
                {' '}
                · {failed} erreur{failed > 1 ? 's' : ''}
              </span>
            )}
          </span>
        )}
      </button>
      {open && (
        <div id={bodyId} className="mt-1 ml-[9px] flex flex-col gap-1 border-l border-line pl-3">
          {items.map((item) => (
            <Row key={item.id} chatId={chatId} item={item} cwd={cwd} working={working} childrenOf={childrenOf} />
          ))}
        </div>
      )}
    </div>
  )
}

interface RowProps {
  chatId: string
  item: ChatItem
  cwd: string
  working: boolean
  childrenOf: Map<string, ChatItem[]>
}

const Row = memo(RowContent, (a, b) => a.item === b.item && a.chatId === b.chatId && a.cwd === b.cwd && a.working === b.working && a.childrenOf.get(a.item.id) === b.childrenOf.get(b.item.id))

function RowContent({ chatId, item, cwd, working, childrenOf }: RowProps) {
  switch (item.kind) {
    case 'user':
      return <UserRow item={item} />
    case 'text':
      return <TextRow text={item.text} streaming={item.streaming} />
    case 'thinking':
      return <ThinkingRow item={item} />
    case 'tool':
      return <ToolRow chatId={chatId} item={item} cwd={cwd} working={working} childrenOf={childrenOf} />
    case 'command':
      return <CommandRow item={item} />
    case 'notice':
      return <NoticeRow chatId={chatId} item={item} />
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

function ToolRow({ chatId, item, cwd, working, childrenOf }: { chatId: string; item: ChatItemOf<'tool'>; cwd: string; working: boolean; childrenOf: Map<string, ChatItem[]> }) {
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
            <Row key={child.id} chatId={chatId} item={child} cwd={cwd} working={working} childrenOf={childrenOf} />
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
  const lines = useMemo(() => lineDiff(before, after), [before, after])
  const shown = lines.slice(0, MAX_DIFF_LINES)
  return (
    <div className="overflow-hidden rounded-md border border-line bg-panel">
      {path && <div className="border-b border-line px-3 py-1 font-mono text-[11px] text-faint">{path}</div>}
      <div className="chat-selectable scrollbar-sleek max-h-96 overflow-auto py-1 font-mono text-[11.5px] leading-relaxed">
        {shown.map((line, i) =>
          line.kind === 'fold' ? (
            <div key={i} className="px-3 text-faint select-none">
              ⋯ {line.count} ligne{line.count > 1 ? 's' : ''} inchangée{line.count > 1 ? 's' : ''}
            </div>
          ) : (
            <div
              key={i}
              className={`px-3 whitespace-pre-wrap ${line.kind === 'del' ? 'bg-red-500/10 text-red-300' : line.kind === 'add' ? 'bg-emerald-500/10 text-emerald-300' : 'text-muted'}`}
            >
              <span className={`mr-2 select-none ${line.kind === 'del' ? 'text-red-400/60' : line.kind === 'add' ? 'text-emerald-400/60' : 'text-faint/50'}`}>
                {line.kind === 'del' ? '-' : line.kind === 'add' ? '+' : ' '}
              </span>
              {line.kind !== 'same' && line.changed ? (
                <>
                  {line.text.slice(0, line.changed[0])}
                  <span className={`rounded-sm ${line.kind === 'del' ? 'bg-red-500/30' : 'bg-emerald-500/30'}`}>{line.text.slice(line.changed[0], line.changed[1])}</span>
                  {line.text.slice(line.changed[1])}
                </>
              ) : (
                line.text
              )}
            </div>
          )
        )}
        {lines.length > MAX_DIFF_LINES && <div className="px-3 text-faint">… {lines.length - MAX_DIFF_LINES} lignes de plus</div>}
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
      <div className="chat-selectable max-w-[85%] rounded-md border border-line bg-panel-2 px-2 py-1 font-mono text-[12px] break-words whitespace-pre-wrap text-fg">
        <Slash size={11} className="mr-1 inline-block align-[-1px] text-accent" />
        {item.name}
        {item.args && <span className="text-muted"> {item.args}</span>}
      </div>
      {item.output && <CommandOutput text={item.output} />}
    </div>
  )
}

/** What a command printed: Markdown when it is (tables of /context…), else as laid out. */
function CommandOutput({ text }: { text: string }) {
  if (!looksLikeMarkdown(text)) return <div className="w-full"><Pre>{text}</Pre></div>
  return (
    <div className="scrollbar-sleek max-h-[480px] w-full overflow-auto rounded-md border border-line bg-panel px-3 py-2">
      <TextRow text={text} streaming={false} />
    </div>
  )
}

function NoticeRow({ chatId, item }: { chatId: string; item: ChatItemOf<'notice'> }) {
  const [blocker, setBlocker] = useState<string | null>(null)
  const Icon = item.tone === 'error' ? OctagonX : item.tone === 'warning' ? TriangleAlert : Info
  const color = item.tone === 'error' ? 'text-red-300' : item.tone === 'warning' ? 'text-amber-300' : 'text-muted'
  if (item.action === 'terminal') {
    return (
      <div className={`flex flex-wrap items-center gap-x-2 gap-y-1 text-[12.5px] ${color}`}>
        <Icon size={13} className="shrink-0" />
        <span className="chat-selectable">{item.text}</span>
        <button
          onClick={() => void togglePaneView(chatId).then(setBlocker)}
          className="flex items-center gap-1.5 rounded-md border border-line px-2 py-0.5 text-fg hover:bg-panel-2"
          title={`Reprend cette conversation dans un terminal (${shortcutLabel('toggleAgentView')})`}
        >
          <SquareTerminal size={12} /> Passer en terminal
        </button>
        {blocker && <span className="w-full pl-[21px] text-amber-300">{blocker}</span>}
      </div>
    )
  }
  return (
    <div className={`chat-selectable flex items-start gap-2 text-[12.5px] ${color}`}>
      <Icon size={13} className="mt-0.5 shrink-0" />
      {item.markdown ? (
        <div className="min-w-0 flex-1">
          <TextRow text={item.text} streaming={false} />
        </div>
      ) : (
        <span className="whitespace-pre-wrap">{item.text}</span>
      )}
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
