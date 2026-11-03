import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, Check, ChevronDown, Cloud, CloudUpload, GitBranch, GitBranchPlus, LoaderCircle, RefreshCw, Search } from 'lucide-react'
import type { GitBranch as Branch, Project, RepoStatus } from '@shared/types'
import { useGit } from '../git-store'
import { relativeTime } from '../relative-time'

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
          className={`group flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded-md border px-2 text-[12px] transition-colors ${
            pickerOpen ? 'border-accent/50 bg-panel-2 text-fg' : 'border-line bg-bg/40 text-fg hover:border-accent/40 hover:bg-panel-2'
          }`}
        >
          {pending === 'switch' || pending === 'branch' ? (
            <LoaderCircle size={13} className="shrink-0 animate-spin text-accent" />
          ) : (
            <GitBranch size={13} className="shrink-0 text-accent" />
          )}
          <span className="min-w-0 flex-1 truncate text-left font-medium">{label}</span>
          {!status.upstream && status.branch && <span className="shrink-0 text-[10px] text-faint">locale</span>}
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
      </div>
      {pickerOpen && <BranchPicker project={project} status={status} onClose={() => setPickerOpen(false)} />}
    </div>
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
      className={`flex h-7 shrink-0 items-center gap-0.5 rounded-md px-1.5 text-[11.5px] font-medium tabular-nums transition-colors disabled:opacity-50 ${
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
    const local = matches.filter((b) => !b.remote).sort((a, b) => Number(b.current) - Number(a.current))
    const remote = matches.filter((b) => b.remote)
    const out: PickerRow[] = []
    const taken = (branches ?? []).some((b) => !b.remote && b.name === name)
    if (name && !taken) out.push({ kind: 'create', name, from: null })
    if (local.length) out.push({ kind: 'header', label: 'Branches locales' }, ...local.map((branch) => ({ kind: 'branch' as const, branch })))
    if (remote.length) out.push({ kind: 'header', label: 'Branches distantes' }, ...remote.map((branch) => ({ kind: 'branch' as const, branch })))
    return out
  }, [branches, query, base])

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
      if (base) {
        setBase(null)
        setQuery('')
      } else onClose()
    }
  }

  const from = base ?? status.branch ?? 'HEAD'
  return (
    <div
      ref={rootRef}
      className="absolute top-full right-2 left-2 z-50 -mt-0.5 flex max-h-[min(440px,70vh)] flex-col overflow-hidden rounded-lg border border-line bg-panel-2 shadow-2xl shadow-black/60"
    >
      <div className="flex items-center gap-2 border-b border-line px-2.5">
        {base ? <GitBranchPlus size={13} className="shrink-0 text-accent" /> : <Search size={13} className="shrink-0 text-faint" />}
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
          placeholder={base ? `Nom de la nouvelle branche (depuis ${base})` : 'Changer de branche, ou nommer une nouvelle…'}
          className="h-9 min-w-0 flex-1 bg-transparent text-[12.5px] text-fg outline-none placeholder:text-faint"
        />
      </div>
      <div ref={listRef} className="min-h-0 flex-1 overflow-y-auto py-1">
        {!branches && <p className="px-3 py-2 text-[12px] text-faint">Chargement des branches…</p>}
        {branches && rows.length === 0 && (
          <p className="px-3 py-2 text-[12px] text-faint">{base ? 'Tape le nom de la branche à créer.' : 'Aucune branche ne correspond.'}</p>
        )}
        {rows.map((row, i) => {
          if (row.kind === 'header') {
            return (
              <div key={`h:${row.label}`} className="px-3 pt-2 pb-1 text-[10px] font-semibold tracking-wider text-faint uppercase">
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
                className={`mx-1 flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 text-[12.5px] ${highlighted ? 'bg-accent/15 text-fg' : 'text-muted'}`}
              >
                <GitBranchPlus size={14} className="shrink-0 text-accent" />
                <span className="min-w-0 flex-1">
                  <span className="block truncate">
                    Créer <span className="font-medium text-fg">{row.name}</span>
                  </span>
                  <span className="block truncate text-[10.5px] text-faint">depuis {row.from ?? from} · puis s’y placer</span>
                </span>
                <kbd className="shrink-0 rounded border border-line px-1 text-[10px] text-faint">↵</kbd>
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
              className={`group mx-1 flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-[12.5px] ${
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
                <span className="block truncate text-[10.5px] text-faint">{branch.subject}</span>
              </span>
              {(branch.ahead > 0 || branch.behind > 0) && (
                <span className="flex shrink-0 items-center text-[10.5px] text-faint tabular-nums">
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
              <span className="shrink-0 text-[10.5px] text-faint group-hover:hidden">{relativeTime(branch.updatedAt, true)}</span>
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
            </div>
          )
        })}
      </div>
      <div className="flex items-center justify-between gap-2 border-t border-line px-3 py-1.5 text-[10.5px] text-faint">
        <span className="truncate">↑↓ · ↵ basculer / créer · Échap</span>
        {!base && (
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
