import { useEffect, useState } from 'react'
import {
  ChevronRight,
  ChevronsDownUp,
  Copy,
  CopyPlus,
  ExternalLink,
  FilePen,
  FilePlus,
  FolderPlus,
  FolderSearch,
  Pencil,
  RefreshCw,
  TextCursorInput,
  Trash2,
  TriangleAlert
} from 'lucide-react'
import type { DirEntry, GitFileStatus, Project } from '@shared/types'
import { fileStatus, folderHasChanges, useExplorer } from './explorer-store'
import { RenameInput } from '@/ui/RenameInput'
import { isMac } from '@/lib/platform'
import { pathsForTerminal } from '@/lib/shell-quote'
import { useApp } from '@/features/workspace/workspace-store'
import { focusedTerminalId, pasteIntoTerminal } from '@/features/terminals/terminal-registry'
import { PATHS_MIME } from '@/lib/drag'
import { IconButton } from '@/ui/IconButton'
import { ContextMenu, MenuItem, MenuSeparator } from '@/ui/ContextMenu'
import { EntryIcon } from './FileIcon'
import { FileSearch } from './FileSearch'

const GIT_POLL_MS = 4000

/** Header buttons of the files view (rendered by the right panel). */
export function FileExplorerActions({ project }: { project: Project }) {
  const { refreshAll, collapseAll } = useExplorer.getState()
  const create = (kind: 'file' | 'directory') => () => useExplorer.getState().startCreate(project.id, project.path, targetFolder(project), kind)
  return (
    <>
      <IconButton title="Nouveau fichier" onClick={create('file')}>
        <FilePlus size={13} />
      </IconButton>
      <IconButton title="Nouveau dossier" onClick={create('directory')}>
        <FolderPlus size={13} />
      </IconButton>
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
  const [menu, setMenu] = useState<EntryMenuState | null>(null)
  const [trashing, setTrashing] = useState<DirEntry | null>(null)
  const [query, setQuery] = useState('')
  const notice = useExplorer((s) => s.notice[project.id])

  useEffect(() => setQuery(''), [project.id])

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
      <FileSearch project={project} query={query} onQueryChange={setQuery} onContextMenu={(m) => setMenu({ ...m, fromSearch: true })} />
      {notice && (
        <div className="flex shrink-0 items-start gap-1.5 border-b border-red-500/30 bg-red-500/10 px-3 py-1.5 text-small text-red-300" role="alert">
          <TriangleAlert size={12} className="mt-0.5 shrink-0" />
          <span className="min-w-0 flex-1">{notice}</span>
        </div>
      )}
      <div
        hidden={query.trim() !== ''}
        tabIndex={-1}
        className="min-h-0 flex-1 overflow-auto py-1 outline-none"
        role="tree"
        aria-label={`Fichiers de ${project.name}`}
        onContextMenu={(e) => {
          // Empty space below the files: create at the project's root.
          e.preventDefault()
          setMenu({ x: e.clientX, y: e.clientY, entry: null })
        }}
        onKeyDown={(e) => {
          const selected = useExplorer.getState().selected[project.id]
          const entry = selected ? findEntry(selected) : null
          if (!entry || useExplorer.getState().editing[project.id]) return
          if (e.key === 'F2') {
            e.preventDefault()
            useExplorer.getState().startRename(project.id, entry.path)
          } else if (e.key === 'Delete' || (isMac && e.key === 'Backspace' && e.metaKey)) {
            e.preventDefault()
            setTrashing(entry)
          }
        }}
      >
        <div className="truncate px-3 pb-1 text-caption font-medium text-faint" title={project.path}>
          {project.name}
        </div>
        {rootError && <p className="px-3 py-1 text-small text-red-400">{rootError}</p>}
        <CreateRow projectId={project.id} dir={project.path} depth={0} />
        {rootEntries?.map((entry) => (
          <TreeNode key={entry.path} entry={entry} projectId={project.id} depth={0} onContextMenu={setMenu} />
        ))}
        {rootEntries?.length === 0 && <p className="px-3 py-1 text-small text-faint">Dossier vide</p>}
      </div>

      {menu && <EntryMenu project={project} {...menu} onTrash={setTrashing} onClose={() => setMenu(null)} />}
      {trashing && <TrashDialog projectId={project.id} entry={trashing} onClose={() => setTrashing(null)} />}
    </>
  )
}

interface EntryMenuState {
  x: number
  y: number
  /** Null: the empty space of the tree (the project's root). */
  entry: DirEntry | null
  /** Opened on a search result: the tree, where names are typed, is hidden. */
  fromSearch?: boolean
}

interface NodeProps {
  entry: DirEntry
  projectId: string
  depth: number
  onContextMenu(menu: EntryMenuState): void
}

/** The folder new files go to: the selected folder, the selected file's folder, or the root. */
function targetFolder(project: Project): string {
  const selected = useExplorer.getState().selected[project.id]
  const entry = selected ? findEntry(selected) : null
  if (!entry) return project.path
  return entry.isDirectory ? entry.path : parentPath(entry.path)
}

/** A listed entry, by absolute path. */
function findEntry(path: string): DirEntry | null {
  const children = useExplorer.getState().children[parentPath(path)]
  return children?.find((entry) => entry.path === path) ?? null
}

function parentPath(path: string): string {
  const cut = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return cut > 0 ? path.slice(0, cut) : path
}

/** The name field of a file or folder being created, at the top of its folder. */
function CreateRow({ projectId, dir, depth }: { projectId: string; dir: string; depth: number }) {
  const edit = useExplorer((s) => {
    const editing = s.editing[projectId]
    return editing?.mode === 'create' && editing.dir === dir ? editing : null
  })
  if (!edit) return null
  return (
    <div className="flex h-[22px] items-center gap-1 pr-2" style={{ paddingLeft: 8 + depth * 12 }}>
      <span className="w-3 shrink-0" />
      {edit.kind === 'directory' ? <FolderPlus size={14} className="shrink-0 text-faint" /> : <FilePlus size={14} className="shrink-0 text-faint" />}
      <RenameInput
        initial=""
        className="text-ui"
        onDone={(name) => {
          if (name === null) useExplorer.getState().cancelEdit(projectId)
          else void useExplorer.getState().create(projectId, dir, name, edit.kind)
        }}
      />
    </div>
  )
}

function TreeNode({ entry, projectId, depth, onContextMenu }: NodeProps) {
  const expanded = useExplorer((s) => entry.isDirectory && (s.expanded[projectId] ?? []).includes(entry.path))
  const children = useExplorer((s) => (expanded ? s.children[entry.path] : undefined))
  const error = useExplorer((s) => (expanded ? s.errors[entry.path] : undefined))
  const selected = useExplorer((s) => s.selected[projectId] === entry.path)
  const status = useExplorer((s) => fileStatus(s.git[projectId], entry.relPath))
  const nested = useExplorer((s) => (entry.isDirectory && status !== 'ignored' ? folderHasChanges(s.git[projectId], entry.relPath) : null))
  const renaming = useExplorer((s) => {
    const editing = s.editing[projectId]
    return editing?.mode === 'rename' && editing.path === entry.path
  })
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
        draggable={!renaming}
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
          e.stopPropagation()
          select(projectId, entry.path)
          onContextMenu({ x: e.clientX, y: e.clientY, entry })
        }}
        title={entry.relPath}
        className={`group flex h-[22px] cursor-pointer items-center gap-1 pr-2 text-ui ${
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
        {renaming ? (
          <RenameInput
            initial={entry.name}
            selectUntil={entry.isDirectory || entry.name.lastIndexOf('.') <= 0 ? undefined : entry.name.lastIndexOf('.')}
            onDone={(name) => {
              if (name === null) useExplorer.getState().cancelEdit(projectId)
              else void useExplorer.getState().rename(projectId, entry.path, name)
            }}
          />
        ) : (
          <span className={`min-w-0 flex-1 truncate ${statusColor(status)} ${entry.isSymlink ? 'italic' : ''}`}>{entry.name}</span>
        )}
        {!entry.isDirectory && status && status !== 'ignored' && (
          <span className={`shrink-0 text-caption font-semibold ${statusColor(status)}`}>{STATUS_LETTER[status]}</span>
        )}
        {entry.isDirectory && nested && <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${statusDot(nested)}`} />}
      </div>

      {expanded && (
        <div role="group">
          {error && (
            <p className="py-0.5 text-caption text-red-400" style={{ paddingLeft: 24 + (depth + 1) * 12 }}>
              {error}
            </p>
          )}
          <CreateRow projectId={projectId} dir={entry.path} depth={depth + 1} />
          {children?.map((child) => (
            <TreeNode key={child.path} entry={child} projectId={projectId} depth={depth + 1} onContextMenu={onContextMenu} />
          ))}
          {children?.length === 0 && (
            <p className="py-0.5 text-caption text-faint italic" style={{ paddingLeft: 24 + (depth + 1) * 12 }}>
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

function EntryMenu(props: EntryMenuState & { project: Project; onTrash(entry: DirEntry): void; onClose(): void }) {
  const { project, x, y, entry, fromSearch, onTrash, onClose } = props
  const terminalId = focusedTerminalId()
  const hasTerminal = useApp((s) => (s.terminalOrder[project.id] ?? []).length > 0)
  const explorer = useExplorer.getState()

  const act = (fn: () => void) => () => {
    fn()
    onClose()
  }
  const folder = !entry ? project.path : entry.isDirectory ? entry.path : parentPath(entry.path)
  const creates = !fromSearch && (
    <>
      <MenuItem icon={<FilePlus size={13} />} label="Nouveau fichier" onClick={act(() => explorer.startCreate(project.id, project.path, folder, 'file'))} />
      <MenuItem icon={<FolderPlus size={13} />} label="Nouveau dossier" onClick={act(() => explorer.startCreate(project.id, project.path, folder, 'directory'))} />
    </>
  )

  if (!entry) {
    return (
      <ContextMenu x={x} y={y} onClose={onClose}>
        {creates}
        <MenuSeparator />
        <MenuItem
          icon={<FolderSearch size={13} />}
          label={isMac ? 'Afficher dans le Finder' : 'Afficher dans le gestionnaire de fichiers'}
          onClick={act(() => void window.capitaine.projects.reveal(project.id))}
        />
      </ContextMenu>
    )
  }

  return (
    <ContextMenu x={x} y={y} onClose={onClose}>
      {!entry.isDirectory && (
        <>
          <MenuItem icon={<FilePen size={13} />} label="Ouvrir dans l’éditeur" onClick={act(() => useApp.getState().openFile(project.id, entry.path))} />
          <MenuItem
            icon={<ExternalLink size={13} />}
            label="Ouvrir avec l’application par défaut"
            onClick={act(() => void window.capitaine.files.open(project.id, entry.path).catch(() => {}))}
          />
          {creates && <MenuSeparator />}
        </>
      )}
      {creates}
      <MenuSeparator />
      {!fromSearch && <MenuItem icon={<Pencil size={13} />} label="Renommer" hint="F2" onClick={act(() => explorer.startRename(project.id, entry.path))} />}
      <MenuItem icon={<CopyPlus size={13} />} label="Dupliquer" onClick={act(() => void explorer.duplicate(project.id, entry.path))} />
      <MenuItem icon={<Trash2 size={13} />} label="Mettre à la corbeille" hint={isMac ? '⌘⌫' : 'Suppr'} danger onClick={act(() => onTrash(entry))} />
      <MenuSeparator />
      <MenuItem
        icon={<TextCursorInput size={13} />}
        label="Insérer le chemin dans le terminal"
        disabled={!terminalId}
        hint={!terminalId ? (hasTerminal ? 'aucun terminal actif' : 'aucun terminal') : undefined}
        onClick={act(() => terminalId && pasteIntoTerminal(terminalId, pathsForTerminal([entry.path])))}
      />
      <MenuItem icon={<Copy size={13} />} label="Copier le chemin" onClick={act(() => window.capitaine.files.copyText(entry.path))} />
      <MenuItem icon={<Copy size={13} />} label="Copier le chemin relatif" onClick={act(() => window.capitaine.files.copyText(entry.relPath))} />
      <MenuSeparator />
      <MenuItem
        icon={<FolderSearch size={13} />}
        label={isMac ? 'Afficher dans le Finder' : 'Afficher dans le gestionnaire de fichiers'}
        onClick={act(() => window.capitaine.files.reveal(project.id, entry.path))}
      />
    </ContextMenu>
  )
}

/**
 * "Move to the trash?": the system trash, so it can be put back from there. When the trash refuses
 * it (a tmpfs, some network or removable disks), offers to delete it for good instead.
 */
function TrashDialog({ projectId, entry, onClose }: { projectId: string; entry: DirEntry; onClose(): void }) {
  const [working, setWorking] = useState(false)
  const [trashError, setTrashError] = useState<string | null>(null)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const run = async (permanently: boolean) => {
    setWorking(true)
    const error = await useExplorer.getState().remove(projectId, entry.path, permanently)
    setWorking(false)
    if (!error) onClose()
    else if (permanently) setDeleteError(error)
    else setTrashError(error)
  }
  const what = entry.isDirectory ? 'Le dossier et tout ce qu’il contient' : 'Le fichier'

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50" role="dialog" aria-modal="true" onMouseDown={onClose}>
      <div
        className="w-[440px] max-w-[calc(100vw-32px)] rounded-lg border border-line bg-panel-2 p-5 shadow-2xl shadow-black/60"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 className="text-title font-medium text-fg">
          {trashError ? `Supprimer « ${entry.name} » définitivement ?` : `Mettre « ${entry.name} » à la corbeille ?`}
        </h2>
        {trashError ? (
          <>
            <p className="mt-2 text-small text-red-300">La corbeille l’a refusé : {trashError}</p>
            <p className="mt-2 text-ui leading-relaxed text-muted">
              {what} {entry.isDirectory ? 'seront supprimés' : 'sera supprimé'} sans passer par la corbeille : impossible de {entry.isDirectory ? 'les' : 'le'} récupérer ensuite.
            </p>
          </>
        ) : (
          <p className="mt-2 text-ui leading-relaxed text-muted">
            {what} {entry.isDirectory ? 'iront' : 'ira'} dans la corbeille du système : tu pourras {entry.isDirectory ? 'les' : 'le'} récupérer depuis là.
          </p>
        )}
        {deleteError && <p className="mt-2 text-small text-red-300">Suppression impossible : {deleteError}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button onClick={onClose} className="rounded-md px-3 py-1.5 text-ui text-muted hover:bg-line hover:text-fg">
            Annuler
          </button>
          <button
            autoFocus
            disabled={working}
            onClick={() => void run(trashError !== null)}
            className="rounded-md bg-red-500/90 px-3 py-1.5 text-ui font-medium text-white hover:bg-red-500 disabled:opacity-60"
          >
            {trashError ? 'Supprimer définitivement' : 'Mettre à la corbeille'}
          </button>
        </div>
      </div>
    </div>
  )
}
