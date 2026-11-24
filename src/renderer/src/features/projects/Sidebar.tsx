import { useEffect, useState } from 'react'
import { ArrowDown, ArrowUp, Container, FilePen, FolderOpen, FolderPlus, GitBranch, MoreHorizontal, Pencil, Sparkles, SquareTerminal, Trash2 } from 'lucide-react'
import type { Project } from '@shared/types'
import { isMac, shortcutLabel } from '@/lib/platform'
import { usePanels, type AppPage } from '@/app/panels-store'
import { belongsTo, useDocker } from '@/features/docker/docker-store'
import { useGit } from '@/features/git/git-store'
import { useApp } from '@/features/workspace/workspace-store'
import { AgentStatusIcon, AgentSummary, ProjectAgentList } from '@/features/claude/AgentStatus'
import { ResizeHandle, usePanelWidth } from '@/ui/ResizeHandle'
import { TitleBarBrand, titleBarHeightClass } from '@/app/TitleBar'
import { ContextMenu, MenuItem } from '@/ui/ContextMenu'
import { RenameInput } from '@/ui/RenameInput'

export function Sidebar() {
  const panel = usePanelWidth({ storageKey: 'capitaine.sidebarWidth', defaultWidth: 240, min: 180, max: 560 })
  const projects = useApp((s) => s.projects)
  const addProject = useApp((s) => s.addProject)
  const reorderProjects = useApp((s) => s.reorderProjects)
  const [dragId, setDragId] = useState<string | null>(null)
  useBranchPolling(projects.map((p) => p.id).join('\n'))

  const dropOn = (targetId: string) => {
    if (!dragId || dragId === targetId) return
    const ids = projects.map((p) => p.id).filter((id) => id !== dragId)
    ids.splice(ids.indexOf(targetId), 0, dragId)
    void reorderProjects(ids)
  }

  return (
    <aside className="relative flex shrink-0 flex-col border-r border-line bg-panel" style={{ width: panel.width }}>
      <ResizeHandle panel={panel} />
      <div className={`drag-region flex shrink-0 items-center ${titleBarHeightClass}`}>
        <TitleBarBrand />
      </div>
      <div className="flex h-8 shrink-0 items-center justify-between pr-2 pl-3">
        <span className="text-caption font-semibold tracking-wider text-muted uppercase">Projets</span>
        <button
          className="rounded p-1 text-muted hover:bg-panel-2 hover:text-fg"
          title={`Ajouter un projet (${shortcutLabel('addProject')})`}
          onClick={() => void addProject()}
        >
          <FolderPlus size={15} />
        </button>
      </div>

      <nav className="flex-1 overflow-y-auto px-2 pb-2">
        {projects.map((project) => (
          <div key={project.id}>
            <ProjectRow
              project={project}
              dragging={dragId === project.id}
              onDragStart={() => setDragId(project.id)}
              onDragEnd={() => setDragId(null)}
              onDrop={() => dropOn(project.id)}
            />
            <ProjectAgentList projectId={project.id} />
          </div>
        ))}
        {projects.length === 0 && (
          <p className="px-2 py-3 text-small leading-relaxed text-faint">Aucun projet. Ajoutez un dossier pour commencer.</p>
        )}
      </nav>
      <PageNav />
      <AgentSummary />
    </aside>
  )
}

/** Bottom of the sidebar: the pages that cover the terminals (skills and agents, Docker). */
function PageNav() {
  const page = usePanels((s) => s.page)
  const projectPath = useApp((s) => s.projects.find((p) => p.id === s.activeProjectId)?.path)
  // Known once the Docker page has been opened.
  const running = useDocker((s) =>
    s.result?.ok && projectPath ? s.result.containers.filter((c) => c.state === 'running' && belongsTo(c, projectPath)).length : 0
  )
  if (!projectPath) return null
  return (
    <div className="flex flex-col gap-0.5 border-t border-line px-2 py-1.5">
      <PageNavButton page="claude" current={page} icon={<Sparkles size={14} />} label="Skills et agents" tooltip="Skills, agents, commands, rules et CLAUDE.md du projet sélectionné" />
      <PageNavButton
        page="docker"
        current={page}
        icon={<Container size={14} />}
        label="Docker"
        tooltip="Les conteneurs de la machine, ceux du projet en premier"
        badge={running > 0 ? <span className="rounded-full bg-emerald-400/15 px-1.5 text-caption text-emerald-300 tabular-nums">{running}</span> : null}
      />
    </div>
  )
}

function PageNavButton(props: { page: AppPage; current: AppPage | null; icon: React.ReactNode; label: string; tooltip: string; badge?: React.ReactNode }) {
  const open = props.current === props.page
  return (
    <button
      aria-current={open ? 'page' : undefined}
      onClick={() => usePanels.getState().setPage(open ? null : props.page)}
      title={props.tooltip}
      className={`flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-ui outline-none focus-visible:ring-1 focus-visible:ring-accent/50 ${
        open ? 'bg-panel-2 text-fg' : 'text-muted hover:bg-panel-2/60 hover:text-fg'
      }`}
    >
      <span className={open ? 'text-accent' : 'text-muted'}>{props.icon}</span>
      <span className="flex-1">{props.label}</span>
      {props.badge}
    </button>
  )
}

const BRANCH_POLL_MS = 10_000

/** Branch summaries for every project: on a timer, on window focus, and right after the active repo moves. */
function useBranchPolling(projectIdsKey: string) {
  const activeVersion = useGit((s) => s.version[useApp.getState().activeProjectId ?? ''] ?? 0)
  useEffect(() => {
    const ids = projectIdsKey ? projectIdsKey.split('\n') : []
    if (ids.length === 0) return
    const refresh = () => void useGit.getState().refreshBranches(ids)
    refresh()
    const timer = setInterval(() => document.hasFocus() && refresh(), BRANCH_POLL_MS)
    window.addEventListener('focus', refresh)
    return () => {
      clearInterval(timer)
      window.removeEventListener('focus', refresh)
    }
  }, [projectIdsKey, activeVersion])
}

function BranchLine({ projectId }: { projectId: string }) {
  const info = useGit((s) => s.branches[projectId])
  if (!info) return null
  const label = info.branch ?? 'HEAD détachée'
  const tooltip = [
    `Branche : ${label}`,
    info.upstream ? `Suit ${info.upstream} (${info.ahead} à pousser, ${info.behind} à récupérer)` : 'Pas de branche distante',
    `${info.changes} fichier(s) modifié(s)`,
    'Clic : voir les changements'
  ].join('\n')
  return (
    <div
      title={tooltip}
      onClick={(e) => {
        e.stopPropagation()
        useApp.getState().selectProject(projectId)
        usePanels.getState().showView('git')
      }}
      className="flex min-w-0 items-center gap-1 text-caption text-faint hover:text-muted"
    >
      <GitBranch size={10} className="shrink-0" />
      <span className="min-w-0 truncate">{label}</span>
      {info.ahead > 0 && (
        <span className="flex shrink-0 items-center">
          <ArrowUp size={9} />
          {info.ahead}
        </span>
      )}
      {info.behind > 0 && (
        <span className="flex shrink-0 items-center">
          <ArrowDown size={9} />
          {info.behind}
        </span>
      )}
      {info.changes > 0 && (
        <span className="flex shrink-0 items-center gap-0.5 text-muted" aria-label={`${info.changes} fichier${info.changes > 1 ? 's' : ''} modifié${info.changes > 1 ? 's' : ''}`}>
          <FilePen size={9} />
          {info.changes}
        </span>
      )}
    </div>
  )
}

interface RowProps {
  project: Project
  dragging: boolean
  onDragStart(): void
  onDragEnd(): void
  onDrop(): void
}

function ProjectRow({ project, dragging, onDragStart, onDragEnd, onDrop }: RowProps) {
  const active = useApp((s) => s.activeProjectId === project.id)
  const terminalIds = useApp((s) => s.terminalOrder[project.id])
  const hasUnread = useApp((s) => (s.terminalOrder[project.id] ?? []).some((id) => s.terminals[id]?.unread))
  // Most urgent agent state in the project: someone waiting on you beats someone working.
  const agentState = useApp((s) => {
    const states = (s.terminalOrder[project.id] ?? []).map((id) => s.agents[id]?.state)
    return states.includes('blocked') ? 'blocked' : states.includes('working') ? 'working' : null
  })
  const selectProject = useApp((s) => s.selectProject)
  const renameProject = useApp((s) => s.renameProject)
  const removeProject = useApp((s) => s.removeProject)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const [editing, setEditing] = useState(false)
  const count = terminalIds?.length ?? 0

  return (
    <div
      draggable={!editing}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onDragOver={(e) => e.preventDefault()}
      onDrop={onDrop}
      onClick={() => selectProject(project.id)}
      onContextMenu={(e) => {
        e.preventDefault()
        setMenu({ x: e.clientX, y: e.clientY })
      }}
      title={project.path}
      className={`group relative mb-0.5 flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 ${
        active ? 'bg-panel-2 text-fg' : 'text-muted hover:bg-panel-2/60 hover:text-fg'
      } ${dragging ? 'opacity-40' : ''}`}
    >
      <span
        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded text-caption font-bold uppercase ${
          active ? 'bg-accent text-bg' : 'bg-line text-muted'
        }`}
      >
        {project.name.slice(0, 1)}
      </span>

      <div className="min-w-0 flex-1">
        {editing ? (
          <RenameInput
            initial={project.name}
            onDone={(name) => {
              setEditing(false)
              if (name !== null) void renameProject(project.id, name)
            }}
          />
        ) : (
          <div className="truncate text-ui" onDoubleClick={() => setEditing(true)}>
            {project.name}
          </div>
        )}
        <BranchLine projectId={project.id} />
      </div>

      {agentState && <AgentStatusIcon state={agentState} size={12} />}
      {hasUnread && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" title="Nouvelle sortie" />}
      {count > 0 && (
        <span
          className="flex items-center gap-0.5 text-caption text-faint tabular-nums group-hover:hidden"
          title={`${count} terminal${count > 1 ? 'aux' : ''} ou chat${count > 1 ? 's' : ''} ouvert${count > 1 ? 's' : ''}`}
          aria-label={`${count} terminal${count > 1 ? 'aux' : ''} ou chat${count > 1 ? 's' : ''} ouvert${count > 1 ? 's' : ''}`}
        >
          <SquareTerminal size={10} />
          {count}
        </span>
      )}

      <button
        className={`rounded p-0.5 text-faint hover:text-fg ${menu ? 'block' : 'hidden group-hover:block'}`}
        title="Actions du projet"
        onClick={(e) => {
          e.stopPropagation()
          const rect = e.currentTarget.getBoundingClientRect()
          setMenu((open) => (open ? null : { x: rect.right - 4, y: rect.bottom + 2 }))
        }}
      >
        <MoreHorizontal size={14} />
      </button>

      {menu && (
        <ContextMenu x={menu.x} y={menu.y} onClose={() => setMenu(null)}>
          <MenuItem
            icon={<Pencil size={13} />}
            label="Renommer"
            onClick={() => {
              setMenu(null)
              setEditing(true)
            }}
          />
          <MenuItem
            icon={<FolderOpen size={13} />}
            label={isMac ? 'Afficher dans le Finder' : "Ouvrir l'emplacement"}
            onClick={() => {
              setMenu(null)
              void window.capitaine.projects.reveal(project.id)
            }}
          />
          <MenuItem
            icon={<Trash2 size={13} />}
            label={count > 0 ? `Retirer (ferme ${count} terminal${count > 1 ? 'aux' : ''})` : 'Retirer de la liste'}
            danger
            onClick={() => {
              setMenu(null)
              void removeProject(project.id)
            }}
          />
        </ContextMenu>
      )}
    </div>
  )
}
