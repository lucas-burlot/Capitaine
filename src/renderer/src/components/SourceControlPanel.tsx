import { useState } from 'react'
import { ArrowDown, ArrowUp, Archive, ChevronRight, FilePen, GitBranch, Minus, Plus, TriangleAlert } from 'lucide-react'
import type { GitChange, GitChangeKind, GitStash, Project, RepoStatus } from '@shared/types'
import { changeDiff, repoAbsolutePath, stashFileDiff } from '../diff-targets'
import { useGit } from '../git-store'
import { fileName, useApp } from '../store'
import { PATHS_MIME } from './FileExplorer'
import { EntryIcon } from './FileIcon'

/** Changes (unstaged), staged files and stashes of the project's repo. */
export function SourceControlPanel({ project }: { project: Project }) {
  const status = useGit((s) => s.status[project.id])
  const error = useGit((s) => s.errors[project.id])

  if (status === undefined) return <p className="px-3 py-3 text-[12px] text-faint">Lecture de git…</p>
  if (status === null) {
    return <p className="px-3 py-3 text-[12px] leading-relaxed text-faint">Ce projet n’est pas un dépôt git.</p>
  }

  const clean = status.staged.length + status.unstaged.length + status.conflicts.length === 0
  return (
    <div className="min-h-0 flex-1 overflow-auto pb-2" aria-label="Changements git">
      <BranchLine status={status} />
      {error && (
        <div className="mx-2 mb-1 flex gap-1.5 rounded border border-red-500/30 bg-red-500/10 px-2 py-1.5 text-[11.5px] text-red-300">
          <TriangleAlert size={12} className="mt-0.5 shrink-0" />
          <span className="min-w-0 break-words">{error}</span>
        </div>
      )}
      {status.truncated && (
        <p className="mx-3 mb-1 text-[11px] text-amber-300">Trop de fichiers modifiés : seuls les 2000 premiers sont listés.</p>
      )}
      {status.conflicts.length > 0 && (
        <ChangeSection project={project} status={status} area="conflict" title="Conflits" changes={status.conflicts} />
      )}
      {status.staged.length > 0 && (
        <ChangeSection project={project} status={status} area="staged" title="Indexés" changes={status.staged} />
      )}
      {(status.unstaged.length > 0 || clean) && (
        <ChangeSection project={project} status={status} area="unstaged" title="Modifications" changes={status.unstaged} />
      )}
      {clean && <p className="px-4 pb-2 text-[12px] text-faint">Aucun changement : l’arbre de travail est propre.</p>}
      <StashSection project={project} status={status} />
    </div>
  )
}

function BranchLine({ status }: { status: RepoStatus }) {
  return (
    <div className="flex items-center gap-1.5 px-3 py-2 text-[12px] text-fg" title={status.upstream ? `Suit ${status.upstream}` : 'Pas de branche distante'}>
      <GitBranch size={13} className="shrink-0 text-accent" />
      <span className="min-w-0 truncate font-medium">{status.branch ?? 'HEAD détachée'}</span>
      {status.upstream && (status.ahead > 0 || status.behind > 0) && (
        <span className="flex shrink-0 items-center gap-1 text-[11px] text-muted">
          {status.ahead > 0 && (
            <span className="flex items-center" title={`${status.ahead} commit(s) à pousser`}>
              <ArrowUp size={11} />
              {status.ahead}
            </span>
          )}
          {status.behind > 0 && (
            <span className="flex items-center" title={`${status.behind} commit(s) à récupérer`}>
              <ArrowDown size={11} />
              {status.behind}
            </span>
          )}
        </span>
      )}
      {!status.upstream && <span className="shrink-0 text-[10.5px] text-faint">locale</span>}
    </div>
  )
}

interface SectionProps {
  project: Project
  status: RepoStatus
  area: 'staged' | 'unstaged' | 'conflict'
  title: string
  changes: GitChange[]
}

function ChangeSection({ project, status, area, title, changes }: SectionProps) {
  const [open, setOpen] = useState(true)
  const { stage, unstage } = useGit.getState()
  const paths = changes.map((c) => c.path)
  return (
    <section className="mb-1">
      <SectionHeader open={open} onToggle={() => setOpen(!open)} title={title} count={changes.length}>
        {area === 'staged' && changes.length > 0 && (
          <HoverAction title="Tout désindexer" onClick={() => void unstage(project.id, paths)}>
            <Minus size={13} />
          </HoverAction>
        )}
        {area !== 'staged' && changes.length > 0 && (
          <HoverAction title="Tout indexer" onClick={() => void stage(project.id, paths)}>
            <Plus size={13} />
          </HoverAction>
        )}
      </SectionHeader>
      {open && changes.map((change) => <ChangeRow key={`${area}:${change.path}`} project={project} status={status} area={area} change={change} />)}
    </section>
  )
}

function ChangeRow({ project, status, area, change }: { project: Project; status: RepoStatus; area: SectionProps['area']; change: GitChange }) {
  const busy = useGit((s) => !!s.busy[`${project.id}:${change.path}`])
  const active = useApp((s) => {
    const tab = s.tabs[s.activeTabByProject[project.id] ?? '']
    return tab?.kind === 'diff' && tab.diff?.key === `${area}::${change.path}`
  })
  const { stage, unstage } = useGit.getState()
  const absolute = repoAbsolutePath(status.repoRoot, change.path)
  const dir = change.path.includes('/') ? change.path.slice(0, change.path.lastIndexOf('/')) : ''

  return (
    <div
      role="button"
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(PATHS_MIME, JSON.stringify([absolute]))
        e.dataTransfer.setData('text/plain', absolute)
        e.dataTransfer.effectAllowed = 'copy'
      }}
      onClick={() => useApp.getState().openDiff(project.id, changeDiff(status.repoRoot, change, area))}
      onDoubleClick={() => change.kind !== 'deleted' && useApp.getState().openFile(project.id, absolute)}
      title={`${change.origPath ? `${change.origPath} → ` : ''}${change.path}\nClic : voir le diff · double-clic : ouvrir le fichier`}
      className={`group flex h-[22px] cursor-pointer items-center gap-1.5 pr-2 pl-6 text-[12.5px] ${
        active ? 'bg-panel-2 text-fg' : 'text-muted hover:bg-panel-2/60 hover:text-fg'
      } ${busy ? 'opacity-50' : ''}`}
    >
      <EntryIcon entry={{ name: fileName(change.path), isDirectory: false }} />
      <span className={`min-w-0 shrink truncate ${KIND_COLOR[change.kind]} ${change.kind === 'deleted' ? 'line-through' : ''}`}>
        {fileName(change.path)}
      </span>
      <span className="min-w-0 flex-1 truncate text-[11px] text-faint">{dir}</span>
      <span className="flex shrink-0 items-center gap-0.5 group-hover:hidden">
        <LineCounts change={change} />
        <span className={`w-3 text-center text-[10px] font-semibold ${KIND_COLOR[change.kind]}`}>{KIND_LETTER[change.kind]}</span>
      </span>
      <span className="hidden shrink-0 items-center gap-0.5 group-hover:flex">
        {change.kind !== 'deleted' && (
          <HoverAction title="Ouvrir le fichier" onClick={() => useApp.getState().openFile(project.id, absolute)}>
            <FilePen size={12} />
          </HoverAction>
        )}
        {area === 'staged' ? (
          <HoverAction title="Désindexer" disabled={busy} onClick={() => void unstage(project.id, [change.path])}>
            <Minus size={13} />
          </HoverAction>
        ) : (
          <HoverAction title="Indexer" disabled={busy} onClick={() => void stage(project.id, [change.path])}>
            <Plus size={13} />
          </HoverAction>
        )}
      </span>
    </div>
  )
}

function LineCounts({ change }: { change: GitChange }) {
  if (change.added === null && change.removed === null) return null
  return (
    <span className="mr-1 text-[10.5px] tabular-nums">
      {!!change.added && <span className="text-emerald-400">+{change.added}</span>}
      {!!change.added && !!change.removed && ' '}
      {!!change.removed && <span className="text-red-400">−{change.removed}</span>}
    </span>
  )
}

function StashSection({ project, status }: { project: Project; status: RepoStatus }) {
  const stashes = useGit((s) => s.stashes[project.id]) ?? []
  const [open, setOpen] = useState(true)
  return (
    <section className="mt-1 border-t border-line pt-1">
      <SectionHeader open={open} onToggle={() => setOpen(!open)} title="Stash" count={stashes.length} />
      {open && stashes.length === 0 && <p className="px-6 py-1 text-[11.5px] text-faint">Aucun stash.</p>}
      {open && stashes.map((stash) => <StashRow key={stash.hash} project={project} status={status} stash={stash} />)}
    </section>
  )
}

function StashRow({ project, status, stash }: { project: Project; status: RepoStatus; stash: GitStash }) {
  const [open, setOpen] = useState(false)
  const files = useGit((s) => s.stashFiles[stash.hash])
  const [error, setError] = useState<string | null>(null)
  const toggle = () => {
    setOpen(!open)
    if (!open && !files) useGit.getState().loadStashFiles(project.id, stash).catch((e: unknown) => setError(String(e)))
  }
  return (
    <div>
      <div
        role="button"
        onClick={toggle}
        title={`${stash.ref}${stash.branch ? ` · sur ${stash.branch}` : ''}\n${stash.message}`}
        className="flex cursor-pointer items-start gap-1 py-1 pr-2 pl-3 text-[12px] text-muted hover:bg-panel-2/60 hover:text-fg"
      >
        <ChevronRight size={12} className={`mt-0.5 shrink-0 text-faint transition-transform ${open ? 'rotate-90' : ''}`} />
        <Archive size={13} className="mt-0.5 shrink-0 text-violet-300/80" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-fg">{stash.message || '(sans message)'}</span>
          <span className="block truncate text-[10.5px] text-faint">
            {stash.ref}
            {stash.branch && ` · ${stash.branch}`} · {relativeTime(stash.createdAt)}
          </span>
        </span>
      </div>
      {open && error && <p className="py-0.5 pl-9 text-[11px] text-red-400">{error}</p>}
      {open && !files && !error && <p className="py-0.5 pl-9 text-[11px] text-faint">Chargement…</p>}
      {open &&
        files?.map((file) => (
          <div
            key={file.path}
            role="button"
            onClick={() => useApp.getState().openDiff(project.id, stashFileDiff(status.repoRoot, stash, file))}
            title={`${file.path}\nClic : voir le diff du stash`}
            className="flex h-[22px] cursor-pointer items-center gap-1.5 pr-2 pl-9 text-[12px] text-muted hover:bg-panel-2/60 hover:text-fg"
          >
            <EntryIcon entry={{ name: fileName(file.path), isDirectory: false }} />
            <span className={`min-w-0 shrink truncate ${KIND_COLOR[file.kind]}`}>{fileName(file.path)}</span>
            <span className="min-w-0 flex-1 truncate text-[11px] text-faint">
              {file.path.includes('/') ? file.path.slice(0, file.path.lastIndexOf('/')) : ''}
            </span>
            <span className={`w-3 shrink-0 text-center text-[10px] font-semibold ${KIND_COLOR[file.kind]}`}>{KIND_LETTER[file.kind]}</span>
          </div>
        ))}
      {open && files?.length === 0 && <p className="py-0.5 pl-9 text-[11px] text-faint">Stash vide.</p>}
    </div>
  )
}

function SectionHeader(props: { open: boolean; onToggle(): void; title: string; count: number; children?: React.ReactNode }) {
  return (
    <div
      role="button"
      onClick={props.onToggle}
      className="group flex h-6 cursor-pointer items-center gap-1 pr-2 pl-2 text-[11px] font-semibold tracking-wider text-muted uppercase hover:text-fg"
    >
      <ChevronRight size={12} className={`shrink-0 transition-transform ${props.open ? 'rotate-90' : ''}`} />
      <span className="flex-1 truncate">{props.title}</span>
      <span className="hidden items-center group-hover:flex" onClick={(e) => e.stopPropagation()}>
        {props.children}
      </span>
      <span className="ml-1 rounded-full bg-line px-1.5 text-[10px] font-medium tracking-normal text-muted tabular-nums">{props.count}</span>
    </div>
  )
}

function HoverAction(props: { title: string; disabled?: boolean; onClick(): void; children: React.ReactNode }) {
  return (
    <button
      title={props.title}
      disabled={props.disabled}
      onClick={(e) => {
        e.stopPropagation()
        props.onClick()
      }}
      className="rounded p-0.5 text-muted hover:bg-line hover:text-fg disabled:opacity-40"
    >
      {props.children}
    </button>
  )
}

const KIND_LETTER: Record<GitChangeKind, string> = {
  modified: 'M',
  added: 'A',
  deleted: 'D',
  renamed: 'R',
  copied: 'C',
  'type-changed': 'T',
  untracked: 'U',
  conflict: '!'
}

const KIND_COLOR: Record<GitChangeKind, string> = {
  modified: 'text-amber-300',
  added: 'text-emerald-300',
  deleted: 'text-red-400',
  renamed: 'text-sky-300',
  copied: 'text-sky-300',
  'type-changed': 'text-amber-300',
  untracked: 'text-emerald-300',
  conflict: 'text-red-400'
}

function relativeTime(timestamp: number): string {
  const minutes = Math.round((Date.now() - timestamp) / 60000)
  if (minutes < 1) return 'à l’instant'
  if (minutes < 60) return `il y a ${minutes} min`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `il y a ${hours} h`
  const days = Math.round(hours / 24)
  if (days < 30) return `il y a ${days} j`
  return new Date(timestamp).toLocaleDateString()
}
