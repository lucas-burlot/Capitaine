import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  ChevronRight,
  ChevronsDownUp,
  Copy,
  ExternalLink,
  FilePen,
  FolderSearch,
  RefreshCw,
  TextCursorInput
} from 'lucide-react'
import type { DirEntry, GitFileStatus, Project } from '@shared/types'
import { fileStatus, folderHasChanges, useExplorer } from '../explorer-store'
import { isMac } from '../platform'
import { pathsForTerminal } from '../shell-quote'
import { useApp } from '../store'
import { focusedTerminalId, pasteIntoTerminal } from '../terminal-registry'
import { EntryIcon } from './FileIcon'

/** Drag payload understood by terminals: a JSON array of absolute paths. */
export const PATHS_MIME = 'application/x-capitaine-paths'

const GIT_POLL_MS = 4000

/** Header buttons of the files view (rendered by the right panel). */
export function FileExplorerActions({ project }: { project: Project }) {
  const { refreshAll, collapseAll } = useExplorer.getState()
  return (
    <>
      <IconButton title="Rafraîchir" onClick={() => refreshAll(project.id, project.path)}>
        <RefreshCw size={13} />
      </IconButton>
      <IconButton title="Tout replier" onClick={() => collapseAll(project.id, project.path)}>
        <ChevronsDownUp size={13} />
      </IconButton>
    </>
  )
}

export function FileExplorer({ project }: { project: Project }) {
  const rootEntries = useExplorer((s) => s.children[project.path])
  const rootError = useExplorer((s) => s.errors[project.path])
  const { loadDir, refreshGit } = useExplorer.getState()
  const [menu, setMenu] = useState<{ x: number; y: number; entry: DirEntry } | null>(null)

  useEffect(() => {
    if (!useExplorer.getState().children[project.path]) void loadDir(project.id, project.path)
    void refreshGit(project.id)
    // Agents edit files in folders you never expanded, so git status is polled too.
    const timer = setInterval(() => {
      if (document.hasFocus()) void refreshGit(project.id)
    }, GIT_POLL_MS)
    return () => clearInterval(timer)
  }, [project.id, project.path, loadDir, refreshGit])

  return (
    <>
      <div className="min-h-0 flex-1 overflow-auto py-1" role="tree" aria-label={`Fichiers de ${project.name}`}>
        <div className="truncate px-3 pb-1 text-[11px] font-medium text-faint" title={project.path}>
          {project.name}
        </div>
        {rootError && <p className="px-3 py-1 text-[12px] text-red-400">{rootError}</p>}
        {rootEntries?.map((entry) => (
          <TreeNode key={entry.path} entry={entry} projectId={project.id} depth={0} onContextMenu={setMenu} />
        ))}
        {rootEntries?.length === 0 && <p className="px-3 py-1 text-[12px] text-faint">Dossier vide</p>}
      </div>

      {menu && <EntryMenu project={project} {...menu} onClose={() => setMenu(null)} />}
    </>
  )
}

interface NodeProps {
  entry: DirEntry
  projectId: string
  depth: number
  onContextMenu(menu: { x: number; y: number; entry: DirEntry }): void
}

function TreeNode({ entry, projectId, depth, onContextMenu }: NodeProps) {
  const expanded = useExplorer((s) => entry.isDirectory && (s.expanded[projectId] ?? []).includes(entry.path))
  const children = useExplorer((s) => (expanded ? s.children[entry.path] : undefined))
  const error = useExplorer((s) => (expanded ? s.errors[entry.path] : undefined))
  const selected = useExplorer((s) => s.selected[projectId] === entry.path)
  const status = useExplorer((s) => fileStatus(s.git[projectId], entry.relPath))
  const nested = useExplorer((s) => (entry.isDirectory && status !== 'ignored' ? folderHasChanges(s.git[projectId], entry.relPath) : null))
  const { toggleDir, select, loadDir } = useExplorer.getState()

  // An expanded folder whose listing was dropped (parent collapsed meanwhile) reloads itself.
  useEffect(() => {
    if (expanded && !children && !error) void loadDir(projectId, entry.path)
  }, [expanded, children, error, loadDir, projectId, entry.path])


  return (
    <>
      <div
        role="treeitem"
        aria-expanded={entry.isDirectory ? expanded : undefined}
        aria-selected={selected}
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData(PATHS_MIME, JSON.stringify([entry.path]))
          e.dataTransfer.setData('text/plain', entry.path)
          e.dataTransfer.effectAllowed = 'copy'
        }}
        onClick={() => {
          select(projectId, entry.path)
          if (entry.isDirectory) toggleDir(projectId, entry.path)
        }}
        onDoubleClick={() => !entry.isDirectory && useApp.getState().openFile(projectId, entry.path)}
        onContextMenu={(e) => {
          e.preventDefault()
          select(projectId, entry.path)
          onContextMenu({ x: e.clientX, y: e.clientY, entry })
        }}
        title={entry.relPath}
        className={`group flex h-[22px] cursor-pointer items-center gap-1 pr-2 text-[12.5px] ${
          selected ? 'bg-panel-2 text-fg' : 'text-muted hover:bg-panel-2/60 hover:text-fg'
        } ${status === 'ignored' ? 'opacity-45' : ''}`}
        style={{ paddingLeft: 8 + depth * 12 }}
      >
        {entry.isDirectory ? (
          <ChevronRight size={12} className={`shrink-0 text-faint transition-transform ${expanded ? 'rotate-90' : ''}`} />
        ) : (
          <span className="w-3 shrink-0" />
        )}
        <EntryIcon entry={entry} expanded={expanded} />
        <span className={`min-w-0 flex-1 truncate ${statusColor(status)} ${entry.isSymlink ? 'italic' : ''}`}>{entry.name}</span>
        {!entry.isDirectory && status && status !== 'ignored' && (
          <span className={`shrink-0 text-[10px] font-semibold ${statusColor(status)}`}>{STATUS_LETTER[status]}</span>
        )}
        {entry.isDirectory && nested && <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${statusDot(nested)}`} />}
      </div>

      {expanded && (
        <div role="group">
          {error && (
            <p className="py-0.5 text-[11px] text-red-400" style={{ paddingLeft: 24 + (depth + 1) * 12 }}>
              {error}
            </p>
          )}
          {children?.map((child) => (
            <TreeNode key={child.path} entry={child} projectId={projectId} depth={depth + 1} onContextMenu={onContextMenu} />
          ))}
          {children?.length === 0 && (
            <p className="py-0.5 text-[11px] text-faint italic" style={{ paddingLeft: 24 + (depth + 1) * 12 }}>
              vide
            </p>
          )}
        </div>
      )}
    </>
  )
}

const STATUS_LETTER: Record<GitFileStatus, string> = {
  modified: 'M',
  added: 'A',
  untracked: 'U',
  deleted: 'D',
  renamed: 'R',
  conflict: '!',
  ignored: ''
}

function statusColor(status: GitFileStatus | null): string {
  switch (status) {
    case 'modified':
      return 'text-amber-300'
    case 'added':
    case 'untracked':
      return 'text-emerald-300'
    case 'renamed':
      return 'text-sky-300'
    case 'deleted':
    case 'conflict':
      return 'text-red-400'
    default:
      return ''
  }
}

function statusDot(status: GitFileStatus): string {
  if (status === 'conflict' || status === 'deleted') return 'bg-red-400'
  if (status === 'added' || status === 'untracked') return 'bg-emerald-400'
  return 'bg-amber-400'
}

function EntryMenu({ project, x, y, entry, onClose }: { project: Project; x: number; y: number; entry: DirEntry; onClose(): void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x, y })
  const terminalId = focusedTerminalId()
  const hasTerminal = useApp((s) => (s.terminalOrder[project.id] ?? []).length > 0)

  useLayoutEffect(() => {
    // Keep the menu inside the window.
    const rect = ref.current?.getBoundingClientRect()
    if (rect) setPos({ x: Math.min(x, window.innerWidth - rect.width - 4), y: Math.min(y, window.innerHeight - rect.height - 4) })
  }, [x, y])

  useEffect(() => {
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && onClose()
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', esc)
    window.addEventListener('blur', onClose)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', esc)
      window.removeEventListener('blur', onClose)
    }
  }, [onClose])

  const act = (fn: () => void) => () => {
    fn()
    onClose()
  }

  return (
    <div
      ref={ref}
      className="fixed z-50 w-max min-w-60 rounded-md border border-line bg-panel-2 py-1 whitespace-nowrap shadow-xl shadow-black/40"
      style={{ left: pos.x, top: pos.y }}
    >
      {!entry.isDirectory && (
        <>
          <Item icon={<FilePen size={13} />} label="Ouvrir dans l’éditeur" onClick={act(() => useApp.getState().openFile(project.id, entry.path))} />
          <Item
            icon={<ExternalLink size={13} />}
            label="Ouvrir avec l’application par défaut"
            onClick={act(() => void window.capitaine.files.open(project.id, entry.path).catch(() => {}))}
          />
        </>
      )}
      <Item
        icon={<TextCursorInput size={13} />}
        label="Insérer le chemin dans le terminal"
        disabled={!terminalId}
        hint={!terminalId ? (hasTerminal ? 'aucun terminal actif' : 'aucun terminal') : undefined}
        onClick={act(() => terminalId && pasteIntoTerminal(terminalId, pathsForTerminal([entry.path])))}
      />
      <div className="my-1 border-t border-line" />
      <Item icon={<Copy size={13} />} label="Copier le chemin" onClick={act(() => window.capitaine.files.copyText(entry.path))} />
      <Item icon={<Copy size={13} />} label="Copier le chemin relatif" onClick={act(() => window.capitaine.files.copyText(entry.relPath))} />
      <div className="my-1 border-t border-line" />
      <Item
        icon={<FolderSearch size={13} />}
        label={isMac ? 'Afficher dans le Finder' : 'Afficher dans le gestionnaire de fichiers'}
        onClick={act(() => window.capitaine.files.reveal(project.id, entry.path))}
      />
    </div>
  )
}

function Item(props: { icon: React.ReactNode; label: string; hint?: string; disabled?: boolean; onClick(): void }) {
  return (
    <button
      disabled={props.disabled}
      onClick={props.onClick}
      className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] text-fg enabled:hover:bg-line disabled:text-faint"
    >
      {props.icon}
      <span className="flex-1">{props.label}</span>
      {props.hint && <span className="text-[10px] text-faint">{props.hint}</span>}
    </button>
  )
}

export function IconButton({ title, onClick, children }: { title: string; onClick(): void; children: React.ReactNode }) {
  return (
    <button title={title} onClick={onClick} className="no-drag rounded p-1 text-muted hover:bg-panel-2 hover:text-fg">
      {children}
    </button>
  )
}
