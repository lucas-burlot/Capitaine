import { ArrowUp, Check, GitMerge, LoaderCircle, Trash2, X } from 'lucide-react'
import type { Project, RepoStatus } from '@shared/types'
import { useGit } from './git-store'

/**
 * After a merge: push the branch that received it, delete the merged one (and its remote branch).
 * Goes once both are done, dismissed, or another branch is checked out.
 */
export function MergeFollowUp({ project, status }: { project: Project; status: RepoStatus }) {
  const merged = useGit((s) => s.merges[project.id])
  const pending = useGit((s) => s.pending[project.id])
  if (!merged || status.branch !== merged.target || status.operation) return null

  const canPush = status.hasRemote && (!status.upstream || status.ahead > 0)
  const canDelete = merged.sourceIsLocal && !merged.deleted
  if (!canPush && !canDelete) return null
  const { push, deleteMergedBranch, dismissMerge } = useGit.getState()

  return (
    <div className="mx-2 mb-1.5 flex flex-col gap-1.5 rounded-md border border-emerald-500/25 bg-emerald-500/10 px-2.5 py-2 text-small" role="status">
      <div className="flex items-start gap-1.5 text-emerald-200">
        <GitMerge size={13} className="mt-0.5 shrink-0" />
        <span className="min-w-0 flex-1 break-words">
          {merged.source} mergée dans {merged.target}
          {merged.deleted && <span className="text-emerald-300/80"> · branche supprimée</span>}
        </span>
        <button title="Fermer" onClick={() => dismissMerge(project.id)} className="shrink-0 rounded p-0.5 text-emerald-300/70 hover:bg-emerald-500/15 hover:text-emerald-100">
          <X size={12} />
        </button>
      </div>
      <div className="flex flex-wrap gap-1.5 pl-[19px]">
        {canPush && (
          <FollowUpButton
            disabled={!!pending}
            busy={pending === 'push'}
            icon={<ArrowUp size={12} />}
            title={status.upstream ? `Pousser vers ${status.upstream}` : 'Publier la branche sur le dépôt distant'}
            onClick={() => void push(project.id)}
          >
            Pousser {merged.target}
          </FollowUpButton>
        )}
        {canDelete && (
          <FollowUpButton
            disabled={!!pending}
            busy={pending === 'delete'}
            icon={<Trash2 size={12} />}
            title={merged.sourceUpstream ? `git branch -d ${merged.source} et suppression de ${merged.sourceUpstream}` : `git branch -d ${merged.source}`}
            onClick={() => void deleteMergedBranch(project.id)}
          >
            Supprimer {merged.source}
            {merged.sourceUpstream && <span className="text-faint"> (et {merged.sourceUpstream})</span>}
          </FollowUpButton>
        )}
        {!canPush && merged.deleted && (
          <span className="flex items-center gap-1 text-emerald-300/80">
            <Check size={12} /> Tout est fait
          </span>
        )}
      </div>
    </div>
  )
}

function FollowUpButton(props: { disabled: boolean; busy: boolean; icon: React.ReactNode; title: string; onClick(): void; children: React.ReactNode }) {
  return (
    <button
      title={props.title}
      disabled={props.disabled}
      onClick={props.onClick}
      className="flex min-w-0 items-center gap-1 rounded border border-line bg-panel px-2 py-1 text-fg hover:border-accent/40 hover:bg-panel-2 disabled:opacity-60"
    >
      {props.busy ? <LoaderCircle size={12} className="shrink-0 animate-spin" /> : <span className="shrink-0">{props.icon}</span>}
      <span className="min-w-0 truncate">{props.children}</span>
    </button>
  )
}
