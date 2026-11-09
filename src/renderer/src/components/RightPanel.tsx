import { useEffect } from 'react'
import { Container, FolderTree, GitBranch, PanelRightClose, RefreshCw } from 'lucide-react'
import type { Project } from '@shared/types'
import { belongsTo, useDocker } from '../docker-store'
import { useExplorer, type RightPanelView } from '../explorer-store'
import { useGit } from '../git-store'
import { shortcutLabel } from '../platform'
import { DockerPanel } from './DockerPanel'
import { FileExplorer, FileExplorerActions, IconButton } from './FileExplorer'
import { ResizeHandle, usePanelWidth } from './ResizeHandle'
import { SourceControlPanel } from './SourceControlPanel'
import { customTitleBar, titleBarHeightClass, WindowControlsSpacer } from './TitleBar'

const GIT_POLL_MS = 3000
/** Background `git fetch`, so the panel knows when there is something to pull. */
const GIT_FETCH_MS = 3 * 60_000
// With window buttons on the right the spacer provides the gap; otherwise a small right padding.
const WINDOW_CONTROLS_PAD = customTitleBar ? '' : 'pr-1.5'

/** Right side of the window: the project's files or its git changes. */
export function RightPanel({ project }: { project: Project }) {
  // Wider floor with a custom title bar: the window buttons sit over this header.
  const panel = usePanelWidth({
    storageKey: 'capitaine.explorerWidth',
    defaultWidth: customTitleBar ? 320 : 260,
    min: customTitleBar ? 300 : 180,
    max: 720
  })
  const view = useExplorer((s) => s.view)
  const toggleOpen = useExplorer((s) => s.toggleOpen)
  useGitPolling(project.id)

  return (
    <section className="relative flex shrink-0 flex-col border-l border-line bg-panel" style={{ width: panel.width }}>
      <ResizeHandle panel={panel} edge="left" />
      <header className={`drag-region flex shrink-0 items-center gap-1 border-b border-line pl-2 ${WINDOW_CONTROLS_PAD} ${titleBarHeightClass}`}>
        <div className="no-drag flex shrink-0 items-center gap-0.5" role="tablist">
          <ViewTab view="files" current={view} icon={<FolderTree size={14} />} label="Fichiers" />
          <ViewTab view="git" current={view} icon={<GitBranch size={14} />} label="Git" badge={<GitBadge projectId={project.id} />} />
          <ViewTab view="docker" current={view} icon={<Container size={14} />} label="Docker" badge={<DockerBadge projectPath={project.path} />} />
        </div>
        <div className="min-w-[32px] flex-1 self-stretch" data-window-drag />
        {view === 'files' ? (
          <FileExplorerActions project={project} />
        ) : view === 'git' ? (
          <GitRefreshButton projectId={project.id} />
        ) : (
          <DockerRefreshButton />
        )}
        <IconButton title={`Masquer le panneau (${shortcutLabel('toggleExplorer')})`} onClick={toggleOpen}>
          <PanelRightClose size={13} />
        </IconButton>
        <WindowControlsSpacer />
      </header>
      {view === 'files' ? (
        <FileExplorer project={project} />
      ) : view === 'git' ? (
        <SourceControlPanel project={project} />
      ) : (
        <DockerPanel project={project} />
      )}
    </section>
  )
}

function ViewTab(props: { view: RightPanelView; current: RightPanelView; icon: React.ReactNode; label: string; badge?: React.ReactNode }) {
  const active = props.view === props.current
  return (
    // Icon tabs, as in Orca's right sidebar; the label lives in the tooltip.
    <button
      role="tab"
      aria-selected={active}
      aria-label={props.label}
      title={props.label}
      onClick={() => useExplorer.getState().showView(props.view)}
      className={`flex h-7 items-center gap-1 rounded px-1.5 text-[11px] font-medium ${
        active ? 'bg-panel-2 text-accent' : 'text-muted hover:bg-panel-2/60 hover:text-fg'
      }`}
    >
      {props.icon}
      {props.badge}
    </button>
  )
}

/** Re-reads the repo, and fetches the remotes too (the panel also does it every few minutes). */
function GitRefreshButton({ projectId }: { projectId: string }) {
  const fetching = useGit((s) => !!s.fetching[projectId])
  const hasRemote = useGit((s) => !!s.status[projectId]?.hasRemote)
  return (
    <IconButton
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

function DockerRefreshButton() {
  const refreshing = useDocker((s) => s.refreshing)
  return (
    <IconButton title="Rafraîchir les conteneurs" onClick={() => void useDocker.getState().refresh()}>
      <RefreshCw size={13} className={refreshing ? 'animate-spin' : ''} />
    </IconButton>
  )
}

/** Containers of this project that are up (known once the Docker view has been opened). */
function DockerBadge({ projectPath }: { projectPath: string }) {
  const count = useDocker((s) =>
    s.result?.ok ? s.result.containers.filter((c) => c.state === 'running' && belongsTo(c, projectPath)).length : 0
  )
  if (!count) return null
  return <span className="rounded-full bg-emerald-400/15 px-1.5 text-[10px] text-emerald-300 tabular-nums">{count}</span>
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
    const fetchRemote = () => {
      if (document.hasFocus() && useGit.getState().status[projectId]?.hasRemote) void useGit.getState().fetch(projectId, true)
    }
    refresh()
    const timer = setInterval(() => document.hasFocus() && refresh(), GIT_POLL_MS)
    const fetchTimer = setInterval(fetchRemote, GIT_FETCH_MS)
    const firstFetch = setTimeout(fetchRemote, 4000)
    let debounce: ReturnType<typeof setTimeout> | undefined
    const offChanged = window.capitaine.files.onChanged(() => {
      clearTimeout(debounce)
      debounce = setTimeout(refresh, 400)
    })
    window.addEventListener('focus', refresh)
    return () => {
      clearInterval(timer)
      clearInterval(fetchTimer)
      clearTimeout(firstFetch)
      clearTimeout(debounce)
      offChanged()
      window.removeEventListener('focus', refresh)
    }
  }, [projectId])
}
