import { useEffect, useRef, useState } from 'react'
import { ArrowUp, Check, ChevronDown, CircleCheck, LoaderCircle, RefreshCw, Sparkles, TriangleAlert } from 'lucide-react'
import type { CommitFollowUp, Project, RepoStatus } from '@shared/types'
import { useGit } from '../git-store'
import { isMac } from '../platform'

const FOLLOW_UP_KEY = 'capitaine.commitFollowUp'
const MOD = isMac ? '⌘' : 'Ctrl'

const FOLLOW_UPS: { value: CommitFollowUp; label: string; hint: string; icon: React.ReactNode }[] = [
  { value: 'none', label: 'Commiter', hint: `${MOD}+↵`, icon: <Check size={13} /> },
  { value: 'push', label: 'Commiter et pousser', hint: `${MOD}+⇧+↵`, icon: <ArrowUp size={13} /> },
  { value: 'sync', label: 'Commiter et synchroniser', hint: 'pull puis push', icon: <RefreshCw size={12} /> }
]

function storedFollowUp(): CommitFollowUp {
  try {
    const value = localStorage.getItem(FOLLOW_UP_KEY)
    return value === 'push' || value === 'sync' ? value : 'none'
  } catch {
    return 'none'
  }
}

/**
 * Message field with Claude's ✨ generator, and a split commit button whose main action is the
 * last one used (commit, commit & push, commit & sync).
 */
export function CommitBox({ project, status }: { project: Project; status: RepoStatus }) {
  const draft = useGit((s) => s.drafts[project.id] ?? '')
  const generating = useGit((s) => !!s.generatingMessage[project.id])
  const pending = useGit((s) => s.pending[project.id])
  const notice = useGit((s) => s.notices[project.id])
  const [followUp, setFollowUp] = useState<CommitFollowUp>(storedFollowUp)
  const [menuOpen, setMenuOpen] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const git = useGit.getState()

  const changeCount = status.staged.length + status.unstaged.length
  const all = status.staged.length === 0
  const blockedByConflicts = status.conflicts.length > 0
  const midRebase = status.operation === 'rebase'
  const canCommit = !!draft.trim() && changeCount > 0 && !blockedByConflicts && !midRebase && !pending && !generating
  const canPush = status.hasRemote && !!status.branch
  const effectiveFollowUp = canPush ? followUp : 'none'
  const primary = FOLLOW_UPS.find((f) => f.value === effectiveFollowUp) ?? FOLLOW_UPS[0]

  useEffect(() => {
    if (!menuOpen) return
    const onPointer = (e: PointerEvent) => !menuRef.current?.contains(e.target as Node) && setMenuOpen(false)
    window.addEventListener('pointerdown', onPointer)
    return () => window.removeEventListener('pointerdown', onPointer)
  }, [menuOpen])

  // Grow with the message, up to ~10 lines.
  useEffect(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${Math.min(el.scrollHeight, 180)}px`
  }, [draft])

  const commit = (value: CommitFollowUp) => {
    if (!canCommit) return
    if (value !== followUp) {
      setFollowUp(value)
      try {
        localStorage.setItem(FOLLOW_UP_KEY, value)
      } catch {
        // best effort: the choice just won't be remembered
      }
    }
    setMenuOpen(false)
    void git.commit(project.id, value)
  }

  const countLabel = changeCount === 0 ? '' : all ? `tout (${changeCount})` : `(${status.staged.length})`
  const disabledReason = blockedByConflicts
    ? 'Résous les conflits avant de commiter'
    : midRebase
      ? 'Rebase en cours : utilise « Continuer » dans le bandeau'
      : changeCount === 0
        ? 'Aucun changement à commiter'
        : !draft.trim()
          ? 'Écris un message, ou génère-le avec ✨'
          : null
  const busyLabel = pending === 'commit' ? 'Commit en cours…' : null

  return (
    <div className="px-2 pb-2">
      <div
        className={`relative rounded-md border bg-bg/60 transition-colors focus-within:border-accent/50 ${
          generating ? 'border-accent/40 commit-shimmer' : 'border-line'
        }`}
      >
        <textarea
          ref={textareaRef}
          value={draft}
          rows={2}
          spellCheck={false}
          disabled={generating}
          onChange={(e) => git.setDraft(project.id, e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              commit(e.shiftKey && canPush ? 'push' : 'none')
            }
          }}
          placeholder={
            generating ? 'Claude rédige le message…' : `Message de commit${status.branch ? ` sur « ${status.branch} »` : ''} (${MOD}+↵)`
          }
          className="block max-h-[180px] min-h-[46px] w-full resize-none bg-transparent py-1.5 pr-8 pl-2 text-[12.5px] leading-[18px] text-fg outline-none placeholder:text-faint disabled:opacity-70"
        />
        <button
          title={generating ? 'Génération en cours…' : `Générer le message avec Claude (${all ? 'tous les changements' : 'fichiers indexés'})`}
          disabled={generating || changeCount === 0}
          onClick={() => void git.generateMessage(project.id)}
          className="absolute top-1 right-1 rounded p-1 text-accent/80 hover:bg-accent/15 hover:text-accent disabled:cursor-default disabled:opacity-40 disabled:hover:bg-transparent"
        >
          {generating ? <LoaderCircle size={14} className="animate-spin" /> : <Sparkles size={14} />}
        </button>
      </div>

      <div ref={menuRef} className="relative mt-1.5 flex">
        <button
          disabled={!canCommit}
          title={disabledReason ?? `${primary.label} ${countLabel} · ${primary.hint}`.replace('  ', ' ')}
          onClick={() => commit(effectiveFollowUp)}
          className="flex h-7 min-w-0 flex-1 items-center justify-center gap-1.5 rounded-l-md bg-accent px-2 text-[12px] font-medium text-bg transition hover:brightness-110 disabled:cursor-default disabled:bg-line disabled:text-faint disabled:hover:brightness-100"
        >
          {busyLabel ? <LoaderCircle size={13} className="animate-spin" /> : primary.icon}
          <span className="truncate">{busyLabel ?? `${primary.label} ${countLabel}`.trim()}</span>
        </button>
        <button
          disabled={!canCommit || !canPush}
          title="Autres actions de commit"
          onClick={() => setMenuOpen(!menuOpen)}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-r-md border-l border-bg/30 bg-accent text-bg hover:brightness-110 disabled:cursor-default disabled:border-bg disabled:bg-line disabled:text-faint disabled:hover:brightness-100"
        >
          <ChevronDown size={13} />
        </button>
        {menuOpen && (
          <div className="absolute top-full right-0 z-40 mt-1 w-56 overflow-hidden rounded-lg border border-line bg-panel-2 py-1 shadow-2xl shadow-black/60">
            {FOLLOW_UPS.map((option) => (
              <button
                key={option.value}
                onClick={() => commit(option.value)}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12.5px] text-muted hover:bg-line/70 hover:text-fg"
              >
                <span className="flex w-4 justify-center text-accent">{option.icon}</span>
                <span className="flex-1">{option.label}</span>
                <span className="text-[10.5px] text-faint">{option.hint}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {notice && (
        <p
          className={`mt-1.5 flex items-start gap-1.5 text-[11.5px] leading-snug ${notice.tone === 'ok' ? 'text-emerald-300/90' : 'text-amber-300'}`}
          role="status"
        >
          {notice.tone === 'ok' ? <CircleCheck size={12} className="mt-px shrink-0" /> : <TriangleAlert size={12} className="mt-px shrink-0" />}
          <span className="min-w-0 break-words">{notice.text}</span>
        </p>
      )}
    </div>
  )
}
