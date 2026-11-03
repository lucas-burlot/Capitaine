import { Check, GitMerge, LoaderCircle, Sparkles, X } from 'lucide-react'
import type { Project, RepoStatus } from '@shared/types'
import { resolutionKey, useGit } from '../git-store'

const TITLE = { merge: 'Fusion en cours', rebase: 'Rebase en cours', 'cherry-pick': 'Cherry-pick en cours', revert: 'Revert en cours' } as const

/** Files whose conflict leaves markers in them, i.e. that Claude can merge (not modify/delete ones). */
export const aiResolvable = (code: string | undefined) => code === 'UU' || code === 'AA'

/** Merge / rebase left half-way: what's left to do, AI resolution of every conflict, continue or abort. */
export function GitOperationBanner({ project, status }: { project: Project; status: RepoStatus }) {
  const pending = useGit((s) => s.pending[project.id])
  const resolutions = useGit((s) => s.resolutions)
  if (!status.operation) return null

  const conflicts = status.conflicts
  const resolvable = conflicts.filter((c) => aiResolvable(c.conflictCode))
  const states = resolvable.map((c) => resolutions[resolutionKey(project.id, c.path)]?.state)
  const working = states.filter((s) => s === 'pending').length
  const toReview = states.filter((s) => s === 'ready').length
  const untouched = resolvable.filter((_, i) => !states[i] || states[i] === 'error')
  const git = useGit.getState()

  const resolveAll = async () => {
    // One at a time: each review tab opens as soon as its proposal is ready.
    for (const change of untouched) await git.resolveWithAi(project.id, change.path)
  }

  return (
    <div className="mx-2 mb-2 overflow-hidden rounded-md border border-amber-400/30 bg-amber-400/[0.06]">
      <div className="flex items-start gap-2 px-2.5 pt-2">
        <GitMerge size={14} className="mt-0.5 shrink-0 text-amber-300" />
        <div className="min-w-0 flex-1">
          <p className="text-[12px] font-medium text-amber-200">{TITLE[status.operation]}</p>
          {status.operationLabel && (
            <p className="truncate text-[11px] text-muted" title={status.operationLabel}>
              {status.operationLabel}
            </p>
          )}
          <p className="mt-0.5 text-[11px] text-faint">
            {conflicts.length === 0
              ? 'Tous les conflits sont résolus : tu peux continuer.'
              : `${conflicts.length} conflit${conflicts.length > 1 ? 's' : ''} à résoudre`}
            {working > 0 && ` · Claude en résout ${working}`}
            {toReview > 0 && ` · ${toReview} proposition${toReview > 1 ? 's' : ''} à valider`}
          </p>
        </div>
      </div>
      {untouched.length > 0 && (
        <div className="px-2.5 pt-2">
          <button
            onClick={() => void resolveAll()}
            title="Claude propose une résolution pour chaque fichier ; tu relis et valides chaque proposition dans un diff"
            className="flex h-7 w-full items-center justify-center gap-1.5 rounded-md border border-accent/30 bg-accent/15 px-2 text-[12px] font-medium text-accent hover:bg-accent/25"
          >
            <Sparkles size={13} />
            {untouched.length > 1 ? `Résoudre les ${untouched.length} conflits avec l’IA` : 'Résoudre le conflit avec l’IA'}
          </button>
        </div>
      )}
      <div className="flex items-center gap-1.5 px-2.5 pt-2 pb-2">
        {working > 0 && untouched.length === 0 && (
          <span className="flex h-6 items-center gap-1 text-[11.5px] text-accent">
            <LoaderCircle size={12} className="animate-spin" /> Claude travaille…
          </span>
        )}
        <span className="flex-1" />
        <button
          disabled={!!pending}
          onClick={() => void git.finishOperation(project.id, 'abort')}
          title={`Tout annuler et revenir à l’état d’avant (${status.operation} --abort)`}
          className="flex h-6 items-center gap-1 rounded-md px-2 text-[11.5px] text-muted hover:bg-line hover:text-fg disabled:opacity-50"
        >
          {pending === 'abort' ? <LoaderCircle size={12} className="animate-spin" /> : <X size={12} />}
          Annuler
        </button>
        <button
          disabled={!!pending || conflicts.length > 0}
          onClick={() => void git.finishOperation(project.id, 'continue')}
          title={conflicts.length ? 'Résous d’abord tous les conflits' : status.operation === 'merge' ? 'Créer le commit de fusion' : 'Passer à la suite'}
          className="flex h-6 items-center gap-1 rounded-md bg-accent px-2 text-[11.5px] font-medium text-bg hover:brightness-110 disabled:bg-line disabled:text-faint disabled:hover:brightness-100"
        >
          {pending === 'continue' ? <LoaderCircle size={12} className="animate-spin" /> : <Check size={12} />}
          {status.operation === 'merge' ? 'Terminer la fusion' : 'Continuer'}
        </button>
      </div>
    </div>
  )
}
