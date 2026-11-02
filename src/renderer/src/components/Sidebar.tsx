import { useEffect, useRef, useState } from 'react'
import { FolderOpen, FolderPlus, MoreHorizontal, Pencil, Trash2 } from 'lucide-react'
import type { Project } from '@shared/types'
import { isMac, shortcutLabel } from '../platform'
import { useApp } from '../store'
import { AgentStatusIcon, AgentSummary, ProjectAgentList } from './AgentStatus'
import { ResizeHandle, usePanelWidth } from './ResizeHandle'

export function Sidebar() {
  const panel = usePanelWidth({ storageKey: 'capitaine.sidebarWidth', defaultWidth: 240, min: 180, max: 560 })
  const projects = useApp((s) => s.projects)
  const addProject = useApp((s) => s.addProject)
  const reorderProjects = useApp((s) => s.reorderProjects)
  const [dragId, setDragId] = useState<string | null>(null)

  const dropOn = (targetId: string) => {
    if (!dragId || dragId === targetId) return
    const ids = projects.map((p) => p.id).filter((id) => id !== dragId)
    ids.splice(ids.indexOf(targetId), 0, dragId)
    void reorderProjects(ids)
  }

  return (
    <aside className="relative flex shrink-0 flex-col border-r border-line bg-panel" style={{ width: panel.width }}>
      <ResizeHandle panel={panel} />
      <div className={`drag-region flex items-center justify-between px-3 ${isMac ? 'h-12 pl-20' : 'h-10'}`}>
        <span className="text-[11px] font-semibold tracking-wider text-muted uppercase">Projets</span>
        <button
          className="no-drag rounded p-1 text-muted hover:bg-panel-2 hover:text-fg"
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
          <p className="px-2 py-3 text-xs leading-relaxed text-faint">Aucun projet. Ajoutez un dossier pour commencer.</p>
        )}
      </nav>
      <AgentSummary />
    </aside>
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
  const [menuOpen, setMenuOpen] = useState(false)
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
      title={project.path}
      className={`group relative mb-0.5 flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 ${
        active ? 'bg-panel-2 text-fg' : 'text-muted hover:bg-panel-2/60 hover:text-fg'
      } ${dragging ? 'opacity-40' : ''}`}
    >
      <span
        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded text-[10px] font-bold uppercase ${
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
          <div className="truncate text-[13px]" onDoubleClick={() => setEditing(true)}>
            {project.name}
          </div>
        )}
      </div>

      {agentState && <AgentStatusIcon state={agentState} size={12} />}
      {hasUnread && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" title="Nouvelle sortie" />}
      {count > 0 && <span className="text-[11px] text-faint tabular-nums group-hover:hidden">{count}</span>}

      <button
        className={`rounded p-0.5 text-faint hover:text-fg ${menuOpen ? 'block' : 'hidden group-hover:block'}`}
        onClick={(e) => {
          e.stopPropagation()
          setMenuOpen((v) => !v)
        }}
      >
        <MoreHorizontal size={14} />
      </button>

      {menuOpen && (
        <Menu onClose={() => setMenuOpen(false)}>
          <MenuItem icon={<Pencil size={13} />} label="Renommer" onClick={() => setEditing(true)} />
          <MenuItem
            icon={<FolderOpen size={13} />}
            label={isMac ? 'Afficher dans le Finder' : "Ouvrir l'emplacement"}
            onClick={() => void window.capitaine.projects.reveal(project.id)}
          />
          <MenuItem
            icon={<Trash2 size={13} />}
            label={count > 0 ? `Retirer (ferme ${count} terminal${count > 1 ? 'aux' : ''})` : 'Retirer de la liste'}
            danger
            onClick={() => void removeProject(project.id)}
          />
        </Menu>
      )}
    </div>
  )
}

function RenameInput({ initial, onDone }: { initial: string; onDone(value: string | null): void }) {
  const [value, setValue] = useState(initial)
  return (
    <input
      autoFocus
      value={value}
      onFocus={(e) => e.currentTarget.select()}
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => onDone(value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onDone(value)
        if (e.key === 'Escape') onDone(null)
      }}
      className="w-full rounded border border-line bg-bg px-1 text-[13px] text-fg outline-none focus:border-accent"
    />
  )
}

function Menu({ children, onClose }: { children: React.ReactNode; onClose(): void }) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) onClose()
    }
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', esc)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', esc)
    }
  }, [onClose])
  return (
    <div
      ref={ref}
      onClick={(e) => {
        e.stopPropagation()
        onClose()
      }}
      className="absolute top-8 right-1 z-20 min-w-52 rounded-md border border-line bg-panel-2 py-1 shadow-xl shadow-black/40"
    >
      {children}
    </div>
  )
}

function MenuItem(props: { icon: React.ReactNode; label: string; danger?: boolean; onClick(): void }) {
  return (
    <button
      onClick={props.onClick}
      className={`flex w-full items-center gap-2 px-3 py-1.5 text-left text-[12px] hover:bg-line ${
        props.danger ? 'text-red-400' : 'text-fg'
      }`}
    >
      {props.icon}
      {props.label}
    </button>
  )
}
