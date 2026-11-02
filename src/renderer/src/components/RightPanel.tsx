import { useEffect } from 'react'
import { FolderTree, GitBranch, PanelRightClose, RefreshCw } from 'lucide-react'
import type { Project } from '@shared/types'
import { useExplorer, type RightPanelView } from '../explorer-store'
import { useGit } from '../git-store'
import { isMac, shortcutLabel } from '../platform'
import { FileExplorer, FileExplorerActions, IconButton } from './FileExplorer'
import { ResizeHandle, usePanelWidth } from './ResizeHandle'
import { SourceControlPanel } from './SourceControlPanel'

const GIT_POLL_MS = 3000

/** Right side of the window: the project's files or its git changes. */
export function RightPanel({ project }: { project: Project }) {
  const panel = usePanelWidth({ storageKey: 'capitaine.explorerWidth', defaultWidth: 260, min: 180, max: 640 })
  const view = useExplorer((s) => s.view)
  const toggleOpen = useExplorer((s) => s.toggleOpen)
  useGitPolling(project.id)

  return (
    <section className="relative flex shrink-0 flex-col border-l border-line bg-panel" style={{ width: panel.width }}>
      <ResizeHandle panel={panel} edge="left" />
      <header className={`drag-region flex shrink-0 items-center gap-1 border-b border-line pr-1.5 pl-2 ${isMac ? 'h-12' : 'h-10'}`}>
        <div className="no-drag flex min-w-0 flex-1 items-center gap-0.5" role="tablist">
          <ViewTab view="files" current={view} icon={<FolderTree size={13} />} label="Fichiers" />
          <ViewTab view="git" current={view} icon={<GitBranch size={13} />} label="Git" badge={<GitBadge projectId={project.id} />} />
        </div>
        {view === 'files' ? (
          <FileExplorerActions project={project} />
        ) : (
          <IconButton title="Rafraîchir" onClick={() => void useGit.getState().refresh(project.id)}>
            <RefreshCw size={13} />
          </IconButton>
        )}
        <IconButton title={`Masquer le panneau (${shortcutLabel('toggleExplorer')})`} onClick={toggleOpen}>
          <PanelRightClose size={13} />
        </IconButton>
      </header>
      {view === 'files' ? <FileExplorer project={project} /> : <SourceControlPanel project={project} />}
    </section>
  )
}

function ViewTab(props: { view: RightPanelView; current: RightPanelView; icon: React.ReactNode; label: string; badge?: React.ReactNode }) {
  const active = props.view === props.current
  return (
    <button
      role="tab"
      aria-selected={active}
      onClick={() => useExplorer.getState().showView(props.view)}
      className={`flex items-center gap-1.5 rounded px-2 py-1 text-[11.5px] font-medium ${
        active ? 'bg-panel-2 text-fg' : 'text-muted hover:bg-panel-2/60 hover:text-fg'
      }`}
    >
      {props.icon}
      {props.label}
      {props.badge}
    </button>
  )
}

function GitBadge({ projectId }: { projectId: string }) {
  const count = useGit((s) => {
    const status = s.status[projectId]
    return status ? status.staged.length + status.unstaged.length + status.conflicts.length : 0
  })
  if (!count) return null
  return <span className="rounded-full bg-accent/20 px-1.5 text-[10px] text-accent tabular-nums">{count > 999 ? '999+' : count}</span>
}

/**
 * Keeps the project's git status fresh while the panel is open: on a timer (agents and terminals
 * change things behind our back), when the window regains focus, and after file changes.
 */
function useGitPolling(projectId: string) {
  useEffect(() => {
    const refresh = () => void useGit.getState().refresh(projectId)
    refresh()
    const timer = setInterval(() => document.hasFocus() && refresh(), GIT_POLL_MS)
    let debounce: ReturnType<typeof setTimeout> | undefined
    const offChanged = window.capitaine.files.onChanged(() => {
      clearTimeout(debounce)
      debounce = setTimeout(refresh, 400)
    })
    window.addEventListener('focus', refresh)
    return () => {
      clearInterval(timer)
      clearTimeout(debounce)
      offChanged()
      window.removeEventListener('focus', refresh)
    }
  }, [projectId])
}
