import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, Check, ChevronDown, Cloud, CloudUpload, GitBranch, GitBranchPlus, GitMerge, LoaderCircle, RefreshCw, Search, TriangleAlert } from 'lucide-react'
import type { GitBranch as Branch, Project, RepoStatus } from '@shared/types'
import { errorText, useGit } from './git-store'
import { relativeTime } from '@/lib/relative-time'
import { IconButton } from '@/ui/IconButton'

/** Current branch (opens the picker) and the pull / push buttons, at the top of the git panel. */
export function GitBranchBar({ project, status }: { project: Project; status: RepoStatus }) {
  const [pickerOpen, setPickerOpen] = useState(false)
  const pending = useGit((s) => s.pending[project.id])
  const { pull, push, sync } = useGit.getState()
  const busy = !!pending
  const label = status.branch ?? 'HEAD détachée'

  return (
    <div className="relative px-2 pt-2 pb-1.5">
      <div className="flex items-center gap-1">
        <button
          onClick={() => setPickerOpen(!pickerOpen)}
          disabled={pending === 'switch' || pending === 'branch'}
          title={`${status.upstream ? `Suit ${status.upstream}` : 'Pas de branche distante'}\nClic : changer de branche ou en créer une`}
          className={`group flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded-md border px-2 text-small transition-colors ${
            pickerOpen ? 'border-accent/50 bg-panel-2 text-fg' : 'border-line bg-bg/40 text-fg hover:border-accent/40 hover:bg-panel-2'
          }`}
        >
          {pending === 'switch' || pending === 'branch' ? (
            <LoaderCircle size={13} className="shrink-0 animate-spin text-accent" />
          ) : (
            <GitBranch size={13} className="shrink-0 text-accent" />
          )}
          <span className="min-w-0 flex-1 truncate text-left font-medium">{label}</span>
          {!status.upstream && status.branch && <span className="shrink-0 text-caption text-faint">locale</span>}
          <ChevronDown size={12} className={`shrink-0 text-faint transition-transform group-hover:text-muted ${pickerOpen ? 'rotate-180' : ''}`} />
        </button>
        <SyncButtons
          status={status}
          pending={pending}
          busy={busy}
          onPull={() => void pull(project.id)}
          onPush={() => void push(project.id)}
          onSync={() => void sync(project.id)}
        />
        <GitRefreshButton projectId={project.id} />
      </div>
      {pickerOpen && <BranchPicker project={project} status={status} onClose={() => setPickerOpen(false)} />}
    </div>
  )
}

/** Re-reads the repo, and fetches the remotes too (the panel also does it every few minutes). */
function GitRefreshButton({ projectId }: { projectId: string }) {
  const fetching = useGit((s) => !!s.fetching[projectId])
  const hasRemote = useGit((s) => !!s.status[projectId]?.hasRemote)
  return (
    <IconButton
      className="p-1.5"
      title={hasRemote ? 'Rafraîchir et récupérer les branches distantes (fetch)' : 'Rafraîchir'}
      onClick={() => {
        const git = useGit.getState()
        if (hasRemote) void git.fetch(projectId, false)
        else void git.refresh(projectId)
      }}
    >
      <RefreshCw size={13} className={fetching ? 'animate-spin' : ''} />
    </IconButton>
  )
}

function SyncButtons(props: {
  status: RepoStatus
  pending: string | undefined
  busy: boolean
  onPull(): void
  onPush(): void
  onSync(): void
}) {
  const { status, pending, busy } = props
  if (!status.hasRemote || status.detached) return null
  if (!status.upstream) {
    return (
      <PillButton title="Publier la branche sur le dépôt distant (push -u)" disabled={busy} onClick={props.onPush} accent>
        {pending === 'push' ? <LoaderCircle size={12} className="animate-spin" /> : <CloudUpload size={12} />}
        Publier
      </PillButton>
    )
  }
  const diverged = status.ahead > 0 && status.behind > 0
  if (diverged) {
    return (
      <PillButton title={`Synchroniser : récupérer ${status.behind} commit(s) puis pousser ${status.ahead}`} disabled={busy} onClick={props.onSync} accent>
        {pending === 'sync' ? <LoaderCircle size={12} className="animate-spin" /> : <RefreshCw size={11} />}
        <ArrowDown size={11} />
        {status.behind}
        <ArrowUp size={11} />
        {status.ahead}
      </PillButton>
    )
  }
  return (
    <>
      <PillButton
        title={status.behind ? `Récupérer ${status.behind} commit(s) de ${status.upstream} (pull)` : `Récupérer depuis ${status.upstream} (pull)`}
        disabled={busy}
        onClick={props.onPull}
        accent={status.behind > 0}
      >
        {pending === 'pull' ? <LoaderCircle size={12} className="animate-spin" /> : <ArrowDown size={12} />}
        {status.behind > 0 && status.behind}
      </PillButton>
      <PillButton
        title={status.ahead ? `Pousser ${status.ahead} commit(s) vers ${status.upstream} (push)` : `Pousser vers ${status.upstream} (push)`}
        disabled={busy}
        onClick={props.onPush}
        accent={status.ahead > 0}
      >
        {pending === 'push' ? <LoaderCircle size={12} className="animate-spin" /> : <ArrowUp size={12} />}
        {status.ahead > 0 && status.ahead}
      </PillButton>
    </>
  )
}

function PillButton(props: { title: string; disabled?: boolean; accent?: boolean; onClick(): void; children: React.ReactNode }) {
  return (
    <button
      title={props.title}
      disabled={props.disabled}
      onClick={props.onClick}
      className={`flex h-7 shrink-0 items-center gap-0.5 rounded-md px-1.5 text-small font-medium tabular-nums transition-colors disabled:opacity-50 ${
        props.accent ? 'bg-accent/15 text-accent hover:bg-accent/25' : 'text-muted hover:bg-panel-2 hover:text-fg'
      }`}
    >
      {props.children}
    </button>
  )
}

type PickerRow =
  | { kind: 'create'; name: string; from: string | null }
  | { kind: 'branch'; branch: Branch }
  | { kind: 'header'; label: string }

/** Branch switcher: type to filter, or to name a new branch. */
function BranchPicker({ project, status, onClose }: { project: Project; status: RepoStatus; onClose(): void }) {
  const branches = useGit((s) => s.branchList[project.id])
  const [query, setQuery] = useState('')
  /** Set when creating a branch from another one than HEAD. */
  const [base, setBase] = useState<string | null>(null)
  /** Picking the branch the current one is merged into. */
  const [mergeInto, setMergeInto] = useState(false)
  /** The merge being confirmed. */
  const [merge, setMerge] = useState<{ source: string; target: string } | null>(null)
  const current = status.branch
  const [cursor, setCursor] = useState(0)
  const rootRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLInputElement>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    void useGit.getState().loadBranchList(project.id)
    inputRef.current?.focus()
  }, [project.id])

  useEffect(() => {
    const onPointer = (e: PointerEvent) => {
      if (rootRef.current && !rootRef.current.parentElement?.contains(e.target as Node)) onClose()
    }
    window.addEventListener('pointerdown', onPointer)
    return () => window.removeEventListener('pointerdown', onPointer)
  }, [onClose])

  const rows = useMemo<PickerRow[]>(() => {
    const name = query.trim()
    if (base) return name ? [{ kind: 'create', name, from: base }] : []
    const needle = name.toLowerCase()
    const matches = (branches ?? []).filter((b) => !needle || b.name.toLowerCase().includes(needle))
    if (mergeInto) {
      const targets = matches.filter((b) => !b.remote && !b.current)
      return targets.length ? [{ kind: 'header', label: `Merger ${current} dans…` }, ...targets.map((branch) => ({ kind: 'branch' as const, branch }))] : []
    }
    const local = matches.filter((b) => !b.remote).sort((a, b) => Number(b.current) - Number(a.current))
    const remote = matches.filter((b) => b.remote)
    const out: PickerRow[] = []
    const taken = (branches ?? []).some((b) => !b.remote && b.name === name)
    if (name && !taken) out.push({ kind: 'create', name, from: null })
    if (local.length) out.push({ kind: 'header', label: 'Branches locales' }, ...local.map((branch) => ({ kind: 'branch' as const, branch })))
    if (remote.length) out.push({ kind: 'header', label: 'Branches distantes' }, ...remote.map((branch) => ({ kind: 'branch' as const, branch })))
    return out
  }, [branches, query, base, mergeInto, current])

  const selectable = rows.map((row, i) => (row.kind === 'header' ? -1 : i)).filter((i) => i >= 0)
  const active = selectable.includes(cursor) ? cursor : (selectable[0] ?? -1)

  useEffect(() => {
    listRef.current?.querySelector(`[data-row="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [active])

  const choose = async (row: PickerRow | undefined) => {
    if (!row || row.kind === 'header') return
    const git = useGit.getState()
    if (row.kind === 'create') {
      if (await git.createBranch(project.id, row.name, row.from ?? undefined)) onClose()
      return
    }
    if (mergeInto && current) return setMerge({ source: current, target: row.branch.name })
    if (row.branch.current) return onClose()
    onClose()
    await git.switchBranch(project.id, row.branch.name)
  }

  const onKey = (e: React.KeyboardEvent) => {
    const at = selectable.indexOf(active)
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const next = selectable[(at + (e.key === 'ArrowDown' ? 1 : -1) + selectable.length) % selectable.length]
      if (next !== undefined) setCursor(next)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      void choose(rows[active])
    } else if (e.key === 'Escape') {
      e.preventDefault()
      if (base || mergeInto) {
        setBase(null)
        setMergeInto(false)
        setQuery('')
      } else onClose()
    }
  }

  const from = base ?? status.branch ?? 'HEAD'
  const shell =
    'absolute top-full right-2 left-2 z-50 -mt-0.5 flex max-h-[min(440px,70vh)] flex-col overflow-hidden rounded-lg border border-line bg-panel-2 shadow-2xl shadow-black/60'
  if (merge) {
    return (
      <div ref={rootRef} className={shell}>
        <MergeConfirm
          project={project}
          status={status}
          source={merge.source}
          target={merge.target}
          onBack={() => {
            setMerge(null)
            requestAnimationFrame(() => inputRef.current?.focus())
          }}
          onDone={onClose}
        />
      </div>
    )
  }
  return (
    <div ref={rootRef} className={shell}>
      <div className="flex items-center gap-2 border-b border-line px-2.5">
        {base ? (
          <GitBranchPlus size={13} className="shrink-0 text-accent" />
        ) : mergeInto ? (
          <GitMerge size={13} className="shrink-0 text-accent" />
        ) : (
          <Search size={13} className="shrink-0 text-faint" />
        )}
        <input
          ref={inputRef}
          value={query}
          spellCheck={false}
          onChange={(e) => {
            // Branch names can't hold spaces: type naturally, get a valid name.
            setQuery(e.target.value.replace(/\s/g, '-'))
            setCursor(0)
          }}
          onKeyDown={onKey}
          placeholder={
            base ? `Nom de la nouvelle branche (depuis ${base})` : mergeInto ? `Merger ${current} dans quelle branche ?` : 'Changer de branche, ou nommer une nouvelle…'
          }
          className="h-9 min-w-0 flex-1 bg-transparent text-ui text-fg outline-none placeholder:text-faint"
        />
      </div>
      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto py-1">
        {!branches && <p className="px-3 py-2 text-small text-faint">Chargement des branches…</p>}
        {branches && rows.length === 0 && (
          <p className="px-3 py-2 text-small text-faint">
            {base ? 'Tape le nom de la branche à créer.' : mergeInto ? 'Aucune autre branche locale ne correspond.' : 'Aucune branche ne correspond.'}
          </p>
        )}
        {rows.map((row, i) => {
          if (row.kind === 'header') {
            return (
              <div key={`h:${row.label}`} className="px-3 pt-2 pb-1 text-caption font-semibold tracking-wider text-faint uppercase">
                {row.label}
              </div>
            )
          }
          const highlighted = i === active
          if (row.kind === 'create') {
            return (
              <div
                key="create"
                data-row={i}
                role="option"
                aria-selected={highlighted}
                onMouseMove={() => setCursor(i)}
                onClick={() => void choose(row)}
                className={`mx-1 flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-ui ${highlighted ? 'bg-accent/15 text-fg' : 'text-muted'}`}
              >
                <GitBranchPlus size={14} className="shrink-0 text-accent" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate">
                    Créer <span className="font-medium text-fg">{row.name}</span>
                  </span>
                  <span className="block truncate text-caption text-faint">depuis {row.from ?? from} · puis s’y placer</span>
                </span>
                <kbd className="shrink-0 rounded border border-line px-1 text-caption text-faint">↵</kbd>
              </div>
            )
          }
          const { branch } = row
          return (
            <div
              key={`${branch.remote ? 'r' : 'l'}:${branch.name}`}
              data-row={i}
              role="option"
              aria-selected={highlighted}
              onMouseMove={() => setCursor(i)}
              onClick={() => void choose(row)}
              title={`${branch.name}\n${branch.subject}${branch.upstream ? `\nSuit ${branch.upstream}` : ''}`}
              className={`group mx-1 flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-ui ${
                highlighted ? 'bg-line/70 text-fg' : 'text-muted'
              }`}
            >
              <span className="flex w-3.5 shrink-0 justify-center">
                {branch.current ? (
                  <Check size={13} className="text-accent" />
                ) : branch.remote ? (
                  <Cloud size={12} className="text-faint" />
                ) : (
                  <GitBranch size={12} className="text-faint" />
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className={`block truncate ${branch.current ? 'font-medium text-fg' : ''}`}>{branch.name}</span>
                <span className="block truncate text-caption text-faint">{branch.subject}</span>
              </span>
              {(branch.ahead > 0 || branch.behind > 0) && (
                <span className="flex shrink-0 items-center text-caption text-faint tabular-nums">
                  {branch.behind > 0 && (
                    <>
                      <ArrowDown size={10} />
                      {branch.behind}
                    </>
                  )}
                  {branch.ahead > 0 && (
                    <>
                      <ArrowUp size={10} />
                      {branch.ahead}
                    </>
                  )}
                </span>
              )}
              <span className={`shrink-0 text-caption text-faint ${mergeInto ? '' : 'group-hover:hidden'}`}>{relativeTime(branch.updatedAt, true)}</span>
              {!mergeInto && current && !branch.current && (
                <button
                  title={`Merger ${branch.name} dans ${current}`}
                  aria-label={`Merger ${branch.name} dans ${current}`}
                  onClick={(e) => {
                    e.stopPropagation()
                    setMerge({ source: branch.name, target: current })
                  }}
                  className="hidden shrink-0 rounded p-0.5 text-muted group-hover:block hover:bg-line hover:text-accent"
                >
                  <GitMerge size={13} />
                </button>
              )}
              {!mergeInto && (
              <button
                title={`Nouvelle branche depuis ${branch.name}`}
                onClick={(e) => {
                  e.stopPropagation()
                  setBase(branch.name)
                  setQuery('')
                  inputRef.current?.focus()
                }}
                className="hidden shrink-0 rounded p-0.5 text-muted group-hover:block hover:bg-line hover:text-accent"
              >
                <GitBranchPlus size={13} />
              </button>
              )}
            </div>
          )
        })}
      </div>
      <div className="flex items-center justify-between gap-2 border-t border-line px-3 py-1.5 text-caption text-faint">
        <span className="truncate">{mergeInto ? '↑↓ · ↵ choisir · Échap retour' : '↑↓ · ↵ basculer / créer · Échap'}</span>
        {!base && !mergeInto && current && (
          <button
            title={`Merger ${current} dans une autre branche`}
            onClick={() => {
              setMergeInto(true)
              setQuery('')
              setCursor(0)
              inputRef.current?.focus()
            }}
            className="ml-auto flex shrink-0 items-center gap-1 text-muted hover:text-accent"
          >
            <GitMerge size={11} /> Merger dans…
          </button>
        )}
        {!base && !mergeInto && (
          <button
            onClick={() => {
              setBase(status.branch ?? 'HEAD')
              setQuery('')
              inputRef.current?.focus()
            }}
            className="flex shrink-0 items-center gap-1 text-muted hover:text-accent"
          >
            <GitBranchPlus size={11} /> Nouvelle branche
          </button>
        )}
      </div>
    </div>
  )
}

const FAST_FORWARD_KEY = 'capitaine.mergeFastForward'

/**
 * "Merge source into target?": what it brings, whether the panel must switch branch first (and
 * can: nothing uncommitted), and the fast-forward choice, kept for next time.
 */
function MergeConfirm(props: { project: Project; status: RepoStatus; source: string; target: string; onBack(): void; onDone(): void }) {
  const { project, status, source, target } = props
  const [preview, setPreview] = useState<{ commits: number; canFastForward: boolean } | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [fastForward, setFastForward] = useState(() => localStorage.getItem(FAST_FORWARD_KEY) === 'on')
  const confirmRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    let live = true
    window.capitaine.git.mergePreview(project.id, source, target).then(
      (result) => live && setPreview(result),
      (err: unknown) => live && setError(errorText(err))
    )
    return () => {
      live = false
    }
  }, [project.id, source, target])

  useEffect(() => confirmRef.current?.focus(), [preview])

  const switching = status.branch !== target
  const uncommitted = status.staged.length + status.conflicts.length + status.unstaged.filter((c) => c.kind !== 'untracked').length
  const blocked = (switching && uncommitted > 0) || !!status.operation
  const upToDate = preview?.commits === 0
  const canMerge = !!preview && !upToDate && !blocked

  const confirm = () => {
    if (!canMerge) return
    localStorage.setItem(FAST_FORWARD_KEY, fastForward ? 'on' : 'off')
    props.onDone()
    void useGit.getState().merge(project.id, { source, target, fastForward: fastForward && preview.canFastForward })
  }

  return (
    <div
      className="flex flex-col gap-2.5 p-3 text-ui"
      role="dialog"
      aria-label="Merger une branche"
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault()
          props.onBack()
        }
      }}
    >
      <div className="flex items-start gap-2">
        <GitMerge size={15} className="mt-0.5 shrink-0 text-accent" />
        <div className="min-w-0 text-fg">
          Merger <span className="font-medium break-all">{source}</span> dans <span className="font-medium break-all">{target}</span>
        </div>
      </div>
      <div className="text-small text-muted">
        {error ? (
          <span className="text-red-300">{error}</span>
        ) : !preview ? (
          'Lecture des commits…'
        ) : upToDate ? (
          `Rien à merger : ${target} contient déjà tout ${source}.`
        ) : (
          `${preview.commits} commit${preview.commits > 1 ? 's' : ''} de ${source} à intégrer.`
        )}
      </div>
      {switching && !blocked && <div className="text-small text-muted">Capitaine passera d’abord sur {target}.</div>}
      {status.operation && (
        <Warning>Termine ou annule d’abord l’opération en cours.</Warning>
      )}
      {!status.operation && switching && uncommitted > 0 && (
        <Warning>
          Il faut passer sur {target} : commite ou stashe d’abord tes {uncommitted} modification{uncommitted > 1 ? 's' : ''} en cours.
        </Warning>
      )}
      {preview?.canFastForward && !upToDate && (
        <label className="flex cursor-pointer items-start gap-2 text-small text-muted">
          <input type="checkbox" checked={fastForward} onChange={(e) => setFastForward(e.target.checked)} className="mt-0.5 accent-[var(--color-accent)]" />
          <span>
            Avance rapide, sans commit de merge
            <span className="block text-caption text-faint">{target} n’a pas bougé depuis : ses commits suivront simplement ceux de {source}.</span>
          </span>
        </label>
      )}
      <div className="flex justify-end gap-2 pt-1">
        <button onClick={props.onBack} className="rounded-md px-3 py-1.5 text-small text-muted hover:bg-line hover:text-fg">
          Retour
        </button>
        <button
          ref={confirmRef}
          disabled={!canMerge}
          onClick={confirm}
          className="flex items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-small font-medium text-bg hover:brightness-110 disabled:opacity-50"
        >
          <GitMerge size={12} /> Merger
        </button>
      </div>
    </div>
  )
}

function Warning({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex gap-1.5 rounded border border-amber-500/30 bg-amber-500/10 px-2 py-1.5 text-small text-amber-200">
      <TriangleAlert size={12} className="mt-0.5 shrink-0" />
      <span className="min-w-0">{children}</span>
    </div>
  )
}
