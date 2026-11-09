import { useEffect, useMemo, useRef, useState } from 'react'
import { Search, X } from 'lucide-react'
import type { DirEntry, Project } from '@shared/types'
import { useExplorer } from './explorer-store'
import { searchFiles, type FileMatch } from './file-search'
import { isWindows, shortcutLabel } from '@/lib/platform'
import { useApp } from '@/features/workspace/workspace-store'
import { PATHS_MIME } from './FileExplorer'
import { EntryIcon } from './FileIcon'

const MAX_RESULTS = 200
// Agents add and remove files all the time: the list is fetched again when older than this.
const FILE_LIST_MAX_AGE_MS = 5000

// Project files by project id, kept between searches.
const fileLists = new Map<string, { files: string[]; at: number }>()
const loading = new Set<string>()
// Focus requests already honoured, so a remount doesn't steal the focus again.
let handledFocusRequest = 0

interface Props {
  project: Project
  query: string
  onQueryChange(query: string): void
  onContextMenu(menu: { x: number; y: number; entry: DirEntry }): void
}

/** Search field at the top of the files view; while it holds a query, its results replace the tree. */
export function FileSearch({ project, query, onQueryChange, onContextMenu }: Props) {
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const [files, setFiles] = useState<string[] | null>(() => fileLists.get(project.id)?.files ?? null)
  const [active, setActive] = useState(0)
  const focusRequest = useExplorer((s) => s.searchFocusRequest)

  const projectIdRef = useRef(project.id)

  const refreshFiles = () => {
    const projectId = project.id
    const cached = fileLists.get(projectId)
    if (loading.has(projectId) || (cached && Date.now() - cached.at < FILE_LIST_MAX_AGE_MS)) return
    loading.add(projectId)
    void window.capitaine.files
      .all(projectId)
      .then(
        (list) => {
          fileLists.set(projectId, { files: list, at: Date.now() })
          if (projectIdRef.current === projectId) setFiles(list)
        },
        () => projectIdRef.current === projectId && setFiles((current) => current ?? [])
      )
      .finally(() => loading.delete(projectId))
  }

  useEffect(() => {
    projectIdRef.current = project.id
    setFiles(fileLists.get(project.id)?.files ?? null)
  }, [project.id])

  useEffect(() => {
    if (focusRequest === handledFocusRequest) return
    handledFocusRequest = focusRequest
    inputRef.current?.focus()
    inputRef.current?.select()
  }, [focusRequest])

  const matches = useMemo(() => (files && query.trim() ? searchFiles(query, files, MAX_RESULTS) : []), [files, query])
  useEffect(() => setActive(0), [query])
  useEffect(() => {
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const absolutePath = (relPath: string) => {
    const sep = isWindows ? '\\' : '/'
    return project.path.replace(/[\\/]+$/, '') + sep + (isWindows ? relPath.replace(/\//g, '\\') : relPath)
  }
  const open = (match: FileMatch) => useApp.getState().openFile(project.id, absolutePath(match.path))

  const onKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault()
      if (matches.length === 0) return
      const step = event.key === 'ArrowDown' ? 1 : -1
      setActive((i) => (i + step + matches.length) % matches.length)
    } else if (event.key === 'Enter') {
      event.preventDefault()
      if (matches[active]) open(matches[active])
    } else if (event.key === 'Escape') {
      event.preventDefault()
      if (query) onQueryChange('')
      else inputRef.current?.blur()
    }
  }

  const searching = query.trim() !== ''
  return (
    <>
      <div className="shrink-0 px-2 pt-2 pb-1">
        <div className="flex h-7 items-center gap-1.5 rounded border border-line bg-bg px-2 focus-within:border-accent/60">
          <Search size={13} className="shrink-0 text-faint" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              onQueryChange(e.target.value)
              refreshFiles()
            }}
            onFocus={refreshFiles}
            onKeyDown={onKeyDown}
            placeholder={`Rechercher un fichier (${shortcutLabel('findFile')})`}
            aria-label="Rechercher un fichier"
            aria-controls="file-search-results"
            spellCheck={false}
            className="min-w-0 flex-1 bg-transparent text-[12px] text-fg outline-none placeholder:text-faint"
          />
          {query && (
            <button
              title="Effacer (Échap)"
              onClick={() => {
                onQueryChange('')
                inputRef.current?.focus()
              }}
              className="rounded p-0.5 text-faint hover:bg-panel-2 hover:text-fg"
            >
              <X size={12} />
            </button>
          )}
        </div>
      </div>

      {searching && (
        <div ref={listRef} id="file-search-results" role="listbox" aria-label="Fichiers trouvés" className="min-h-0 flex-1 overflow-auto py-1">
          {files === null && <p className="px-3 py-1 text-[12px] text-faint">Recherche…</p>}
          {files !== null && matches.length === 0 && <p className="px-3 py-1 text-[12px] text-faint">Aucun fichier ne correspond</p>}
          {matches.map((match, index) => (
            <ResultRow
              key={match.path}
              match={match}
              index={index}
              active={index === active}
              absolutePath={absolutePath(match.path)}
              onHover={() => setActive(index)}
              onOpen={() => open(match)}
              onContextMenu={onContextMenu}
            />
          ))}
          {matches.length === MAX_RESULTS && (
            <p className="px-3 py-1 text-[11px] text-faint">Les {MAX_RESULTS} meilleurs résultats : précise ta recherche pour voir les autres.</p>
          )}
        </div>
      )}
    </>
  )
}

interface RowProps {
  match: FileMatch
  index: number
  active: boolean
  absolutePath: string
  onHover(): void
  onOpen(): void
  onContextMenu(menu: { x: number; y: number; entry: DirEntry }): void
}

function ResultRow({ match, index, active, absolutePath, onHover, onOpen, onContextMenu }: RowProps) {
  const nameStart = match.path.lastIndexOf('/') + 1
  const name = match.path.slice(nameStart)
  const folder = match.path.slice(0, Math.max(0, nameStart - 1))
  const entry: DirEntry = { name, path: absolutePath, relPath: match.path, isDirectory: false, isSymlink: false }
  return (
    <div
      role="option"
      aria-selected={active}
      data-index={index}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(PATHS_MIME, JSON.stringify([absolutePath]))
        e.dataTransfer.setData('text/plain', absolutePath)
        e.dataTransfer.effectAllowed = 'copy'
      }}
      onMouseMove={onHover}
      onClick={onOpen}
      onContextMenu={(e) => {
        e.preventDefault()
        onContextMenu({ x: e.clientX, y: e.clientY, entry })
      }}
      title={match.path}
      className={`flex h-[22px] cursor-pointer items-center gap-1.5 px-3 text-[12.5px] ${active ? 'bg-panel-2 text-fg' : 'text-muted'}`}
    >
      <EntryIcon entry={entry} />
      <span className="shrink-0 truncate">
        <Highlighted text={name} offset={nameStart} positions={match.positions} />
      </span>
      {folder && (
        <span className="min-w-0 flex-1 truncate text-[11px] text-faint" dir="rtl">
          {/* rtl keeps the end of a long folder path visible; the bdi keeps the path itself in order. */}
          <bdi>
            <Highlighted text={folder} offset={0} positions={match.positions} />
          </bdi>
        </span>
      )}
    </div>
  )
}

/** `text` sits at `offset` in the matched path; the matched characters are emphasised. */
function Highlighted({ text, offset, positions }: { text: string; offset: number; positions: number[] }) {
  const marked = new Set(positions.map((p) => p - offset).filter((p) => p >= 0 && p < text.length))
  if (marked.size === 0) return <>{text}</>
  const parts: React.ReactNode[] = []
  let run = ''
  let runMarked = false
  const flush = (key: number) => {
    if (!run) return
    parts.push(runMarked ? <mark key={key} className="bg-transparent font-semibold text-accent">{run}</mark> : run)
    run = ''
  }
  for (let i = 0; i < text.length; i++) {
    const isMarked = marked.has(i)
    if (isMarked !== runMarked) {
      flush(i)
      runMarked = isMarked
    }
    run += text[i]
  }
  flush(text.length)
  return <>{parts}</>
}
