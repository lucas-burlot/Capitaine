import { useEffect, useRef, useState } from 'react'
import { Archive, ArchiveArrowDown, ArchiveRestore, ChevronRight, FilePen, LoaderCircle, Minus, PackageOpen, Plus, Sparkles, Trash2, TriangleAlert } from 'lucide-react'
import type { GitChange, GitChangeKind, GitStash, Project, RepoStatus } from '@shared/types'
import { changeDiff, repoAbsolutePath, resolutionDiff, stashFileDiff } from './diff-targets'
import { resolutionKey, useGit } from './git-store'
import { relativeTime } from '@/lib/relative-time'
import { CommitBox } from './CommitBox'
import { GitBranchBar } from './GitBranchBar'
import { aiResolvable, GitOperationBanner } from './GitOperationBanner'
import { fileName, useApp } from '@/features/workspace/workspace-store'
import { PATHS_MIME } from '@/features/files/FileExplorer'
import { EntryIcon } from '@/features/files/FileIcon'

/** Changes (unstaged), staged files and stashes of the project's repo. */
export function SourceControlPanel({ project }: { project: Project }) {
  const status = useGit((s) => s.status[project.id])
  const error = useGit((s) => s.errors[project.id])
  const [stashFormOpen, setStashFormOpen] = useState(false)

  if (status === undefined) return <p className="px-3 py-3 text-[12px] text-faint">Lecture de git…</p>
  if (status === null) {
    return <p className="px-3 py-3 text-[12px] leading-relaxed text-faint">Ce projet n’est pas un dépôt git.</p>
  }

  const clean = status.staged.length + status.unstaged.length + status.conflicts.length === 0
  return (
    <div className="min-h-0 flex-1 overflow-auto pb-2" aria-label="Changements git">
      <GitBranchBar project={project} status={status} />
      <CommitBox project={project} status={status} />
      <GitOperationBanner project={project} status={status} />
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
        <ChangeSection project={project} status={status} area="staged" title="Indexés" changes={status.staged} onStash={() => setStashFormOpen(true)} />
      )}
      {(status.unstaged.length > 0 || clean) && (
        <ChangeSection
          project={project}
          status={status}
          area="unstaged"
          title="Modifications"
          changes={status.unstaged}
          onStash={() => setStashFormOpen(true)}
        />
      )}
      {clean && <p className="px-4 pb-2 text-[12px] text-faint">Aucun changement : l’arbre de travail est propre.</p>}
      <StashSection project={project} status={status} formOpen={stashFormOpen} setFormOpen={setStashFormOpen} />
    </div>
  )
}

interface SectionProps {
  project: Project
  status: RepoStatus
  area: 'staged' | 'unstaged' | 'conflict'
  title: string
  changes: GitChange[]
  /** Opens the "stash my changes" form. */
  onStash?(): void
}

function ChangeSection({ project, status, area, title, changes, onStash }: SectionProps) {
  const [open, setOpen] = useState(true)
  const { stage, unstage } = useGit.getState()
  const paths = changes.map((c) => c.path)
  return (
    <section className="mb-1">
      <SectionHeader open={open} onToggle={() => setOpen(!open)} title={title} count={changes.length}>
        {onStash && changes.length > 0 && (
          <HoverAction title="Mettre les modifications de côté (stash)…" onClick={onStash}>
            <ArchiveArrowDown size={13} />
          </HoverAction>
        )}
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
  const resolution = useGit((s) => (area === 'conflict' ? s.resolutions[resolutionKey(project.id, change.path)] : undefined))
  const { stage, unstage, resolveWithAi } = useGit.getState()
  const absolute = repoAbsolutePath(status.repoRoot, change.path)
  const canAiResolve = area === 'conflict' && aiResolvable(change.conflictCode)
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
      {resolution && <ResolutionBadge projectId={project.id} repoRoot={status.repoRoot} path={change.path} state={resolution} />}
      <span className="flex shrink-0 items-center gap-0.5 group-hover:hidden">
        <LineCounts change={change} />
        <span className={`w-3 text-center text-[10px] font-semibold ${KIND_COLOR[change.kind]}`}>{KIND_LETTER[change.kind]}</span>
      </span>
      <span className="hidden shrink-0 items-center gap-0.5 group-hover:flex">
        {canAiResolve && resolution?.state !== 'pending' && resolution?.state !== 'ready' && (
          <HoverAction title="Résoudre avec l’IA (tu valides la proposition avant qu’elle soit appliquée)" onClick={() => void resolveWithAi(project.id, change.path)}>
            <Sparkles size={12} className="text-accent" />
          </HoverAction>
        )}
        {area !== 'conflict' && (
          <HoverAction
            title="Stasher ce fichier seul (le reste ne bouge pas)"
            disabled={busy}
            onClick={() =>
              void useGit.getState().stashPush(project.id, { message: change.path, includeUntracked: true, stagedOnly: false, paths: [change.path] })
            }
          >
            <ArchiveArrowDown size={12} />
          </HoverAction>
        )}
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
          <HoverAction
            title={area === 'conflict' ? 'Marquer comme résolu (indexer le fichier tel quel)' : 'Indexer'}
            disabled={busy}
            onClick={() => void stage(project.id, [change.path])}
          >
            <Plus size={13} />
          </HoverAction>
        )}
      </span>
    </div>
  )
}

function ResolutionBadge(props: { projectId: string; repoRoot: string; path: string; state: NonNullable<ReturnType<typeof useGit.getState>['resolutions'][string]> }) {
  const { state } = props
  if (state.state === 'pending') {
    return (
      <span className="flex shrink-0 items-center gap-1 text-[10.5px] text-accent" title="Claude prépare une résolution…">
        <LoaderCircle size={11} className="animate-spin" /> IA
      </span>
    )
  }
  if (state.state === 'error') {
    return (
      <span className="shrink-0 text-red-400" title={`Résolution IA impossible : ${state.message}`}>
        <TriangleAlert size={11} />
      </span>
    )
  }
  return (
    <button
      title="Proposition de Claude prête : clic pour la relire et l’accepter"
      onClick={(e) => {
        e.stopPropagation()
        useApp.getState().openDiff(props.projectId, resolutionDiff(props.repoRoot, props.path))
      }}
      className="flex shrink-0 items-center gap-0.5 rounded bg-accent/15 px-1 text-[10px] font-medium text-accent hover:bg-accent/25"
    >
      <Sparkles size={9} /> à valider
    </button>
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

function StashSection(props: { project: Project; status: RepoStatus; formOpen: boolean; setFormOpen(open: boolean): void }) {
  const { project, status, formOpen, setFormOpen } = props
  const stashes = useGit((s) => s.stashes[project.id]) ?? []
  const [open, setOpen] = useState(true)
  const hasChanges = status.staged.length + status.unstaged.length > 0
  return (
    <section className="mt-1 border-t border-line pt-1">
      <SectionHeader open={open} onToggle={() => setOpen(!open)} title="Stash" count={stashes.length}>
        {hasChanges && (
          <HoverAction title="Mettre les modifications de côté (stash)…" onClick={() => setFormOpen(true)}>
            <ArchiveArrowDown size={13} />
          </HoverAction>
        )}
      </SectionHeader>
      {formOpen && <StashForm project={project} status={status} onClose={() => setFormOpen(false)} />}
      {open && stashes.length === 0 && !formOpen && (
        <p className="px-6 py-1 text-[11.5px] text-faint">
          Aucun stash.
          {hasChanges && (
            <>
              {' '}
              <button onClick={() => setFormOpen(true)} className="text-muted underline decoration-line underline-offset-2 hover:text-accent">
                Stasher les modifications
              </button>
            </>
          )}
        </p>
      )}
      {open && stashes.map((stash) => <StashRow key={stash.hash} project={project} status={status} stash={stash} />)}
    </section>
  )
}

/** "Put my changes aside": message, new files in or out, or only what is staged. */
function StashForm({ project, status, onClose }: { project: Project; status: RepoStatus; onClose(): void }) {
  const [message, setMessage] = useState('')
  const [includeUntracked, setIncludeUntracked] = useState(true)
  const [stagedOnly, setStagedOnly] = useState(false)
  const pending = useGit((s) => s.pending[project.id])
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => inputRef.current?.focus(), [])

  const untracked = status.unstaged.filter((c) => c.kind === 'untracked').length
  const canStageOnly = status.staged.length > 0 && status.unstaged.length > 0
  const onlyStaged = canStageOnly && stagedOnly
  const count = onlyStaged ? status.staged.length : status.staged.length + status.unstaged.length - (includeUntracked ? 0 : untracked)
  const busy = pending === 'stash'

  const submit = async () => {
    if (busy || count === 0) return
    const ok = await useGit.getState().stashPush(project.id, { message, includeUntracked: includeUntracked && !onlyStaged, stagedOnly: onlyStaged })
    if (ok) onClose()
  }

  return (
    <div className="mx-2 mt-1 mb-2 rounded-md border border-violet-300/25 bg-violet-300/[0.05] p-2">
      <input
        ref={inputRef}
        value={message}
        spellCheck={false}
        onChange={(e) => setMessage(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') void submit()
          if (e.key === 'Escape') onClose()
        }}
        placeholder="Message du stash (optionnel)"
        className="h-7 w-full rounded border border-line bg-bg/60 px-2 text-[12.5px] text-fg outline-none placeholder:text-faint focus:border-violet-300/50"
      />
      <div className="mt-1.5 flex flex-col gap-1 text-[11.5px] text-muted">
        {untracked > 0 && (
          <label className={`flex cursor-pointer items-center gap-1.5 ${onlyStaged ? 'opacity-40' : ''}`}>
            <input
              type="checkbox"
              checked={includeUntracked && !onlyStaged}
              disabled={onlyStaged}
              onChange={(e) => setIncludeUntracked(e.target.checked)}
              className="accent-[#c4b5fd]"
            />
            Inclure les nouveaux fichiers ({untracked})
          </label>
        )}
        {canStageOnly && (
          <label className="flex cursor-pointer items-center gap-1.5">
            <input type="checkbox" checked={stagedOnly} onChange={(e) => setStagedOnly(e.target.checked)} className="accent-[#c4b5fd]" />
            Uniquement les fichiers indexés ({status.staged.length})
          </label>
        )}
      </div>
      <div className="mt-2 flex items-center gap-1.5">
        <span className="min-w-0 flex-1 truncate text-[11px] text-faint">
          {count === 0 ? 'Rien à mettre de côté' : `${count} fichier${count > 1 ? 's' : ''} mis de côté`}
        </span>
        <button onClick={onClose} className="h-6 rounded-md px-2 text-[11.5px] text-muted hover:bg-line hover:text-fg">
          Annuler
        </button>
        <button
          disabled={busy || count === 0}
          onClick={() => void submit()}
          className="flex h-6 items-center gap-1 rounded-md bg-violet-300/90 px-2 text-[11.5px] font-medium text-bg hover:bg-violet-300 disabled:bg-line disabled:text-faint"
        >
          {busy ? <LoaderCircle size={12} className="animate-spin" /> : <Archive size={12} />}
          Stasher
        </button>
      </div>
    </div>
  )
}

function StashRow({ project, status, stash }: { project: Project; status: RepoStatus; stash: GitStash }) {
  const [open, setOpen] = useState(false)
  const files = useGit((s) => s.stashFiles[stash.hash])
  const [error, setError] = useState<string | null>(null)
  const [confirmDrop, setConfirmDrop] = useState(false)
  const busy = useGit((s) => s.pending[project.id] === 'stash')
  const { applyStash, dropStash } = useGit.getState()
  const toggle = () => {
    setOpen(!open)
    if (!open && !files) useGit.getState().loadStashFiles(project.id, stash).catch((e: unknown) => setError(String(e)))
  }
  // The confirmation lapses on its own if left alone.
  useEffect(() => {
    if (!confirmDrop) return
    const timer = setTimeout(() => setConfirmDrop(false), 5000)
    return () => clearTimeout(timer)
  }, [confirmDrop])

  return (
    <div>
      <div
        role="button"
        onClick={toggle}
        title={`${stash.ref}${stash.branch ? ` · sur ${stash.branch}` : ''}\n${stash.message}`}
        className="group flex cursor-pointer items-start gap-1 py-1 pr-2 pl-3 text-[12px] text-muted hover:bg-panel-2/60 hover:text-fg"
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
        {!confirmDrop && (
          <span className={`mt-0.5 shrink-0 items-center gap-0.5 ${busy ? 'flex opacity-40' : 'hidden group-hover:flex'}`}>
            <HoverAction title="Appliquer (le stash reste dans la liste)" disabled={busy} onClick={() => void applyStash(project.id, stash, false)}>
              <ArchiveRestore size={13} />
            </HoverAction>
            <HoverAction title="Appliquer et supprimer (pop)" disabled={busy} onClick={() => void applyStash(project.id, stash, true)}>
              <PackageOpen size={13} />
            </HoverAction>
            <HoverAction title="Supprimer ce stash…" disabled={busy} onClick={() => setConfirmDrop(true)}>
              <Trash2 size={12} />
            </HoverAction>
          </span>
        )}
      </div>
      {confirmDrop && (
        <div className="mx-2 mb-1 flex items-center gap-1.5 rounded-md border border-red-500/30 bg-red-500/10 py-1 pr-1 pl-2 text-[11.5px]">
          <span className="min-w-0 flex-1 text-red-200">Supprimer définitivement ce stash ?</span>
          <button onClick={() => setConfirmDrop(false)} className="h-6 rounded px-1.5 text-muted hover:bg-line hover:text-fg">
            Annuler
          </button>
          <button
            autoFocus
            onClick={() => {
              setConfirmDrop(false)
              void dropStash(project.id, stash)
            }}
            className="flex h-6 items-center gap-1 rounded bg-red-500/80 px-2 font-medium text-white hover:bg-red-500"
          >
            <Trash2 size={11} /> Supprimer
          </button>
        </div>
      )}
      {open && (
        <div className="flex flex-wrap items-center gap-1 py-1 pr-2 pl-8">
          <StashTextButton disabled={busy} onClick={() => void applyStash(project.id, stash, false)}>
            <ArchiveRestore size={12} /> Appliquer
          </StashTextButton>
          <StashTextButton disabled={busy} onClick={() => void applyStash(project.id, stash, true)}>
            <PackageOpen size={12} /> Appliquer et supprimer
          </StashTextButton>
          <StashTextButton disabled={busy} danger onClick={() => setConfirmDrop(true)}>
            <Trash2 size={11} /> Supprimer
          </StashTextButton>
        </div>
      )}
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

function StashTextButton(props: { disabled?: boolean; danger?: boolean; onClick(): void; children: React.ReactNode }) {
  return (
    <button
      disabled={props.disabled}
      onClick={props.onClick}
      className={`flex h-5 shrink-0 items-center gap-1 rounded px-1.5 text-[11px] disabled:opacity-40 ${
        props.danger ? 'text-muted hover:bg-red-500/15 hover:text-red-300' : 'text-muted hover:bg-line hover:text-fg'
      }`}
    >
      {props.children}
    </button>
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
