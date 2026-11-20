import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ArrowUp, ImageIcon, Square, X } from 'lucide-react'
import type { ChatUserContent } from '@shared/types'
import { PATHS_MIME } from '@/lib/drag'
import { isWindows } from '@/lib/platform'
import { useApp } from '@/features/workspace/workspace-store'
import { EntryIcon } from '@/features/files/FileIcon'
import { Highlighted } from '@/features/files/FileSearch'
import { searchFiles, type FileMatch } from '@/features/files/file-search'
import { cachedProjectFiles, loadProjectFiles } from '@/features/files/project-files'
import { interrupt, sendMessage, type ChatCommandInfo, type ChatSession } from './chat-store'
import { shortPath } from './tool-display'

interface Attachment {
  id: string
  name: string
  mediaType: string
  data: string
  url: string
}

const MAX_IMAGE_BYTES = 5 * 1024 * 1024
const IMAGE_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp'])
const MAX_SUGGESTIONS = 50

/** Text typed into a chat from outside (drops on the pane, "paste into terminal" actions). */
const inserters = new Map<string, (text: string) => void>()

export function insertIntoChat(chatId: string, text: string): boolean {
  const insert = inserters.get(chatId)
  insert?.(text)
  return !!insert
}

interface Props {
  chat: ChatSession
  focused: boolean
  /** The composer sits under pending prompts: Enter there answers them. */
  blocked: boolean
  toolbar: React.ReactNode
}

export function ChatComposer({ chat, focused, blocked, toolbar }: Props) {
  const [text, setText] = useState('')
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [menuIndex, setMenuIndex] = useState(0)
  const [menuClosed, setMenuClosed] = useState(false)
  const [dropping, setDropping] = useState(false)
  const [caret, setCaret] = useState(0)
  const ref = useRef<HTMLTextAreaElement>(null)
  const sent = useRef<string[]>([])
  const recall = useRef(-1)
  const working = chat.status === 'working'

  useEffect(() => {
    inserters.set(chat.id, (inserted) => {
      const area = ref.current
      if (!area) return
      const start = area.selectionStart ?? text.length
      const end = area.selectionEnd ?? text.length
      const before = area.value.slice(0, start)
      const spacer = before && !/\s$/.test(before) ? ' ' : ''
      const next = `${before}${spacer}${inserted}${area.value.slice(end)}`
      setText(next)
      requestAnimationFrame(() => {
        area.focus()
        const caret = before.length + spacer.length + inserted.length
        area.setSelectionRange(caret, caret)
      })
    })
    return () => {
      inserters.delete(chat.id)
    }
  })

  useEffect(() => {
    if (!focused) return
    const frame = requestAnimationFrame(() => ref.current?.focus())
    return () => cancelAnimationFrame(frame)
  }, [focused])

  // Grows with its content, up to a third of the pane.
  useLayoutEffect(() => {
    const area = ref.current
    if (!area) return
    area.style.height = 'auto'
    area.style.height = `${Math.min(area.scrollHeight, Math.max(120, window.innerHeight / 3))}px`
  }, [text])

  const suggestions = useMemo(() => slashSuggestions(text, chat.commands), [text, chat.commands])

  // `@` before the caret opens the project's files; the chosen one is cited relative to the chat's folder.
  const projectId = useApp((s) => s.terminals[chat.id]?.projectId ?? null)
  const projectRoot = useApp((s) => s.projects.find((p) => p.id === projectId)?.path ?? null)
  const [files, setFiles] = useState<string[] | null>(() => (projectId ? cachedProjectFiles(projectId) : null))
  const mention = useMemo(() => (suggestions.length === 0 ? mentionAt(text, caret) : null), [suggestions.length, text, caret])
  const mentioning = mention !== null
  useEffect(() => {
    if (!mentioning || !projectId) return
    let live = true
    loadProjectFiles(projectId).then(
      (list) => live && setFiles(list),
      () => live && setFiles((current) => current ?? [])
    )
    return () => {
      live = false
    }
  }, [mentioning, projectId])
  const fileSuggestions = useMemo(() => (mention && files ? fileMatches(mention.query, files) : []), [mention, files])

  const menuLength = suggestions.length || fileSuggestions.length
  const menuOpen = menuLength > 0 && !menuClosed
  useEffect(() => {
    setMenuClosed(false)
  }, [text.split(/\s/)[0], mention?.start])
  useEffect(() => {
    setMenuIndex(0)
  }, [text.split(/\s/)[0], mention?.start, mention?.query])

  const submit = () => {
    if (!text.trim() && attachments.length === 0) return
    const images: ChatUserContent = attachments.map((a) => ({ type: 'image', source: { type: 'base64', media_type: a.mediaType, data: a.data } }))
    void sendMessage(chat.id, text, images)
    if (text.trim()) sent.current = [text, ...sent.current.filter((t) => t !== text)].slice(0, 50)
    recall.current = -1
    attachments.forEach((a) => URL.revokeObjectURL(a.url))
    setAttachments([])
    setText('')
  }

  const complete = (command: ChatCommandInfo) => {
    setText(`/${command.name} `)
    setMenuClosed(true)
    ref.current?.focus()
  }

  const completeFile = (match: FileMatch) => {
    if (!mention || !projectRoot) return
    const sep = isWindows ? '\\' : '/'
    const absolute = projectRoot.replace(/[\\/]+$/, '') + sep + (isWindows ? match.path.replace(/\//g, '\\') : match.path)
    const cited = `@${quoteMention(shortPath(absolute, chat.cwd))} `
    const next = text.slice(0, mention.start) + cited + text.slice(caret)
    const position = mention.start + cited.length
    setText(next)
    setCaret(position)
    requestAnimationFrame(() => {
      ref.current?.focus()
      ref.current?.setSelectionRange(position, position)
    })
  }

  const pick = (index: number) => {
    if (suggestions.length) complete(suggestions[index])
    else if (fileSuggestions[index]) completeFile(fileSuggestions[index])
  }

  const onKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.nativeEvent.isComposing) return
    if (menuOpen) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        const step = event.key === 'ArrowDown' ? 1 : -1
        setMenuIndex((i) => (i + step + menuLength) % menuLength)
        return
      }
      const typedWhole = suggestions.length > 0 && text.trim() === `/${suggestions[menuIndex]?.name}`
      if (event.key === 'Tab' || (event.key === 'Enter' && !event.shiftKey && !typedWhole)) {
        event.preventDefault()
        pick(menuIndex)
        return
      }
      if (event.key === 'Escape') {
        event.preventDefault()
        setMenuClosed(true)
        return
      }
    }
    if (event.key === 'Enter' && !event.shiftKey && !event.altKey) {
      event.preventDefault()
      submit()
      return
    }
    if (event.key === 'Escape' && working) {
      event.preventDefault()
      void interrupt(chat.id)
      return
    }
    // Up / Down on an empty or recalled box walk through what was sent.
    if ((event.key === 'ArrowUp' || event.key === 'ArrowDown') && (text === '' || recall.current !== -1) && !text.includes('\n')) {
      const next = recall.current + (event.key === 'ArrowUp' ? 1 : -1)
      if (next < -1 || next >= sent.current.length) return
      event.preventDefault()
      recall.current = next
      setText(next === -1 ? '' : sent.current[next])
    }
  }

  const addImages = async (files: File[]) => {
    const added: Attachment[] = []
    for (const file of files) {
      if (!IMAGE_TYPES.has(file.type) || file.size > MAX_IMAGE_BYTES) continue
      const data = await toBase64(file)
      added.push({ id: crypto.randomUUID(), name: file.name || 'image', mediaType: file.type, data, url: URL.createObjectURL(file) })
    }
    if (added.length) setAttachments((current) => [...current, ...added])
    return added.length
  }

  const onPaste = (event: React.ClipboardEvent) => {
    const images = [...event.clipboardData.files].filter((f) => IMAGE_TYPES.has(f.type))
    if (images.length === 0) return
    event.preventDefault()
    void addImages(images)
  }

  const onDrop = (event: React.DragEvent) => {
    setDropping(false)
    const internal = event.dataTransfer.getData(PATHS_MIME)
    const files = [...event.dataTransfer.files]
    if (!internal && files.length === 0) return
    event.preventDefault()
    event.stopPropagation()
    let paths: string[] = []
    if (internal) {
      try {
        const parsed: unknown = JSON.parse(internal)
        if (Array.isArray(parsed)) paths = parsed.filter((p): p is string => typeof p === 'string')
      } catch {
        return
      }
    } else {
      const images = files.filter((f) => IMAGE_TYPES.has(f.type))
      if (images.length) void addImages(images)
      paths = files.filter((f) => !IMAGE_TYPES.has(f.type)).map((f) => window.capitaine.files.pathForFile(f)).filter(Boolean)
    }
    // `@path` is how Claude Code references a file in a prompt.
    if (paths.length) insertIntoChat(chat.id, paths.map((p) => `@${quoteMention(shortPath(p, chat.cwd))}`).join(' ') + ' ')
  }

  return (
    <div className="relative">
      {menuOpen && fileSuggestions.length > 0 && (
        <div
          role="listbox"
          aria-label="Fichiers à citer"
          className="scrollbar-sleek absolute right-0 bottom-full left-0 z-20 mb-1.5 max-h-72 overflow-y-auto rounded-lg border border-line bg-panel py-1 shadow-xl shadow-black/40"
        >
          {fileSuggestions.map((match, i) => {
            const nameStart = match.path.lastIndexOf('/') + 1
            const name = match.path.slice(nameStart)
            const folder = match.path.slice(0, Math.max(0, nameStart - 1))
            return (
              <button
                key={match.path}
                role="option"
                aria-selected={i === menuIndex}
                ref={(el) => {
                  if (i === menuIndex) el?.scrollIntoView({ block: 'nearest' })
                }}
                onMouseDown={(e) => {
                  e.preventDefault()
                  completeFile(match)
                }}
                onMouseEnter={() => setMenuIndex(i)}
                title={match.path}
                className={`flex w-full items-center gap-1.5 px-3 py-1 text-left text-ui ${i === menuIndex ? 'bg-panel-2 text-fg' : 'text-muted'}`}
              >
                <EntryIcon entry={{ name, isDirectory: false }} />
                <span className="shrink-0 truncate">
                  <Highlighted text={name} offset={nameStart} positions={match.positions} />
                </span>
                {folder && (
                  <span className="min-w-0 flex-1 truncate text-caption text-faint" dir="rtl">
                    <bdi>
                      <Highlighted text={folder} offset={0} positions={match.positions} />
                    </bdi>
                  </span>
                )}
              </button>
            )
          })}
        </div>
      )}
      {menuOpen && suggestions.length > 0 && (
        <div className="scrollbar-sleek absolute right-0 bottom-full left-0 z-20 mb-1.5 max-h-72 overflow-y-auto rounded-lg border border-line bg-panel py-1 shadow-xl shadow-black/40">
          {suggestions.map((command, i) => (
            <button
              key={command.name}
              ref={(el) => {
                if (i === menuIndex) el?.scrollIntoView({ block: 'nearest' })
              }}
              onMouseDown={(e) => {
                e.preventDefault()
                complete(command)
              }}
              onMouseEnter={() => setMenuIndex(i)}
              className={`flex w-full items-baseline gap-2 px-3 py-1 text-left ${i === menuIndex ? 'bg-panel-2' : ''}`}
            >
              <span className="shrink-0 font-mono text-small text-fg">/{command.name}</span>
              {command.argumentHint && <span className="max-w-[35%] shrink-0 truncate font-mono text-caption text-faint">{command.argumentHint}</span>}
              <span className="min-w-0 truncate text-small text-muted">{command.description}</span>
            </button>
          ))}
        </div>
      )}
      <div
        className={`rounded-xl border bg-panel transition-colors ${dropping ? 'border-accent/70' : 'border-line focus-within:border-accent/50'}`}
        onDragOver={(e) => {
          if (!e.dataTransfer.types.includes(PATHS_MIME) && !e.dataTransfer.types.includes('Files')) return
          e.preventDefault()
          e.dataTransfer.dropEffect = 'copy'
          if (!dropping) setDropping(true)
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropping(false)
        }}
        onDrop={onDrop}
      >
        {attachments.length > 0 && (
          <div className="flex flex-wrap gap-2 px-3 pt-3">
            {attachments.map((a) => (
              <div key={a.id} className="group relative h-14 w-14 overflow-hidden rounded-md border border-line" title={a.name}>
                <img src={a.url} alt={a.name} className="h-full w-full object-cover" />
                <button
                  className="absolute top-0.5 right-0.5 rounded bg-bg/80 p-0.5 text-fg opacity-0 group-hover:opacity-100"
                  onClick={() => {
                    URL.revokeObjectURL(a.url)
                    setAttachments((current) => current.filter((x) => x.id !== a.id))
                  }}
                  title="Retirer"
                >
                  <X size={11} />
                </button>
              </div>
            ))}
          </div>
        )}
        <textarea
          ref={ref}
          value={text}
          rows={1}
          onChange={(e) => {
            setText(e.target.value)
            setCaret(e.target.selectionStart ?? e.target.value.length)
            recall.current = -1
          }}
          onSelect={(e) => setCaret(e.currentTarget.selectionStart ?? 0)}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
          placeholder={blocked ? 'Réponds à Claude ci-dessus, ou écris un message…' : working ? 'Claude travaille — ton message sera lu ensuite (Échap pour interrompre)' : 'Écris à Claude…  ( / pour les commandes, @ pour un fichier )'}
          className="scrollbar-sleek block w-full resize-none bg-transparent px-3.5 pt-3 pb-1 text-reading leading-relaxed text-fg outline-none placeholder:text-faint"
        />
        <div className="flex items-center gap-1 px-2 pb-2">
          {toolbar}
          <div className="flex-1" />
          <label className="cursor-pointer rounded p-1.5 text-faint hover:bg-panel-2 hover:text-fg" title="Joindre une image (ou colle-la directement)">
            <ImageIcon size={14} />
            <input
              type="file"
              accept="image/png,image/jpeg,image/gif,image/webp"
              multiple
              className="hidden"
              onChange={(e) => {
                void addImages([...(e.target.files ?? [])])
                e.target.value = ''
              }}
            />
          </label>
          {working && (
            <button onClick={() => void interrupt(chat.id)} className="rounded-md border border-line p-1.5 text-fg hover:bg-panel-2" title="Interrompre (Échap)">
              <Square size={12} fill="currentColor" />
            </button>
          )}
          <button
            onClick={submit}
            disabled={!text.trim() && attachments.length === 0}
            className="rounded-md bg-accent p-1.5 text-bg hover:brightness-110 disabled:opacity-30"
            title="Envoyer (Entrée)"
          >
            <ArrowUp size={14} />
          </button>
        </div>
      </div>
    </div>
  )
}

/** Commands matching what follows the `/` (name first, then description), while it's the only word. */
function slashSuggestions(text: string, commands: ChatCommandInfo[]): ChatCommandInfo[] {
  const match = /^\/(\S*)$/.exec(text)
  if (!match) return []
  const query = match[1].toLowerCase()
  const byName = commands.filter((c) => c.name.toLowerCase().startsWith(query))
  const inName = commands.filter((c) => !byName.includes(c) && c.name.toLowerCase().includes(query))
  const inDescription = query ? commands.filter((c) => !byName.includes(c) && !inName.includes(c) && c.description.toLowerCase().includes(query)) : []
  return [...byName, ...inName, ...inDescription].slice(0, MAX_SUGGESTIONS)
}

/** The `@word` the caret is in, when it starts the text or follows a space (not an email address). */
function mentionAt(text: string, caret: number): { start: number; query: string } | null {
  const match = /(^|\s)@([^\s@"]*)$/.exec(text.slice(0, caret))
  if (!match) return null
  return { start: match.index + match[1].length, query: match[2] }
}

/** Fuzzy matches for what follows the `@`; with nothing typed yet, the files nearest the root. */
function fileMatches(query: string, files: string[]): FileMatch[] {
  if (query) return searchFiles(query, files, MAX_SUGGESTIONS)
  return [...files]
    .sort((a, b) => a.split('/').length - b.split('/').length || a.localeCompare(b))
    .slice(0, MAX_SUGGESTIONS)
    .map((path) => ({ path, score: 0, positions: [] }))
}

function quoteMention(path: string): string {
  return /\s/.test(path) ? `"${path}"` : path
}

function toBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^;]+;base64,/, ''))
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}
