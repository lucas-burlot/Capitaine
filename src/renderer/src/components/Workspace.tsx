import { lazy, Suspense, useMemo, useRef, useState } from 'react'
import { Columns2, FolderPlus, GitCompare, PanelRight, PanelRightClose, Plus, Rows2, SquareTerminal, X } from 'lucide-react'
import { useEditors } from '../editor-store'
import { useExplorer } from '../explorer-store'
import { startDrag } from '../drag'
import { computeLayout, dragSizes, nodeAt, paneIds, type Divider, type Rect } from '../layout'
import { isMac, shortcutLabel } from '../platform'
import { mostUrgentAgent, tabLabel, useApp, type Tab } from '../store'
import { AgentStatusIcon } from './AgentStatus'
import { EntryIcon } from './FileIcon'
import { TerminalView } from './TerminalView'
import logo from '../../../../resources/icon.svg'

const FULL: Rect = { left: 0, top: 0, width: 1, height: 1 }

// Monaco is several MB: it only loads once a file is opened.
const EditorView = lazy(() => import('./EditorView'))
const DiffView = lazy(() => import('./DiffView'))

export function Workspace() {
  const projects = useApp((s) => s.projects)
  const activeProjectId = useApp((s) => s.activeProjectId)
  const terminals = useApp((s) => s.terminals)
  const tabs = useApp((s) => s.tabs)
  const activeTabByProject = useApp((s) => s.activeTabByProject)
  const project = projects.find((p) => p.id === activeProjectId)
  const activeTabId = activeProjectId ? activeTabByProject[activeProjectId] : null
  const activeTab = activeTabId ? tabs[activeTabId] : undefined
  const stackRef = useRef<HTMLDivElement>(null)

  // Every tab is laid out (not only the visible one) so hidden shells keep their real size.
  const layouts = useMemo(() => {
    const result = new Map<string, ReturnType<typeof computeLayout>>()
    for (const tab of Object.values(tabs)) result.set(tab.id, computeLayout(tab.layout))
    return result
  }, [tabs])

  const projectPaths = new Map(projects.map((p) => [p.id, p.path]))

  return (
    <main className="flex min-w-0 flex-1 flex-col">
      {project ? <TabBar projectId={project.id} title={project.name} path={project.path} /> : <TitleSpacer />}

      <div ref={stackRef} className="relative min-h-0 flex-1">
        {/* Every terminal stays mounted so shells keep running when you switch tabs, projects or layouts. */}
        {Object.values(terminals).map((terminal) => {
          const tab = tabs[terminal.tabId]
          const layout = layouts.get(terminal.tabId)
          const visible = terminal.tabId === activeTabId
          return (
            <TerminalView
              key={terminal.id}
              terminalId={terminal.id}
              cwd={projectPaths.get(terminal.projectId) ?? ''}
              rect={layout?.panes.get(terminal.id) ?? FULL}
              visible={visible}
              focused={visible && tab?.activePaneId === terminal.id}
              showHeader={(layout?.panes.size ?? 1) > 1}
            />
          )
        })}
        {activeTab &&
          layouts
            .get(activeTab.id)
            ?.dividers.map((divider) => (
              <SplitDivider key={`${divider.path.join('.')}:${divider.index}`} tab={activeTab} divider={divider} stackRef={stackRef} />
            ))}
        {Object.values(tabs)
          .filter((tab) => tab.kind === 'editor' && tab.filePath)
          .map((tab) => (
            <Suspense key={tab.id} fallback={null}>
              <EditorView tabId={tab.id} projectId={tab.projectId} path={tab.filePath!} visible={tab.id === activeTabId} />
            </Suspense>
          ))}
        {Object.values(tabs)
          .filter((tab) => tab.kind === 'diff' && tab.diff)
          .map((tab) => (
            <Suspense key={tab.id} fallback={null}>
              <DiffView tabId={tab.id} projectId={tab.projectId} diff={tab.diff!} visible={tab.id === activeTabId} />
            </Suspense>
          ))}
        {!project && <NoProject />}
        {project && !activeTab && <NoTerminal />}
      </div>
    </main>
  )
}

function SplitDivider({ tab, divider, stackRef }: { tab: Tab; divider: Divider; stackRef: React.RefObject<HTMLDivElement | null> }) {
  const resize = useApp((s) => s.resizeSplit)
  const horizontal = divider.direction === 'row'
  const { rect } = divider

  const onPointerDown = (event: React.PointerEvent) => {
    const stack = stackRef.current?.getBoundingClientRect()
    if (!stack) return
    const split = divider.splitRect
    startDrag(event, horizontal ? 'col-resize' : 'row-resize', (e) => {
      const node = nodeAt(useApp.getState().tabs[tab.id]?.layout ?? tab.layout, divider.path)
      if (node?.type !== 'split') return
      const fraction = horizontal
        ? (e.clientX - stack.left - split.left * stack.width) / (split.width * stack.width)
        : (e.clientY - stack.top - split.top * stack.height) / (split.height * stack.height)
      resize(tab.id, divider.path, dragSizes(node.sizes, divider.index, fraction))
    })
  }

  // Equal split on double-click.
  const onDoubleClick = () => {
    const node = nodeAt(tab.layout, divider.path)
    if (node?.type === 'split') resize(tab.id, divider.path, node.sizes.map(() => 1 / node.sizes.length))
  }

  return (
    <div
      onPointerDown={onPointerDown}
      onDoubleClick={onDoubleClick}
      title="Glisser pour redimensionner · double-clic pour égaliser"
      className={`group absolute z-10 flex items-center justify-center ${horizontal ? 'cursor-col-resize' : 'cursor-row-resize'}`}
      style={
        horizontal
          ? { left: `calc(${rect.left * 100}% - 3px)`, top: `${rect.top * 100}%`, width: 6, height: `${rect.height * 100}%` }
          : { left: `${rect.left * 100}%`, top: `calc(${rect.top * 100}% - 3px)`, width: `${rect.width * 100}%`, height: 6 }
      }
    >
      <div className={`bg-line transition-colors group-hover:bg-accent/70 ${horizontal ? 'h-full w-px' : 'h-px w-full'}`} />
    </div>
  )
}

function TitleSpacer() {
  return <div className={`drag-region shrink-0 border-b border-line ${isMac ? 'h-12' : 'h-10'}`} />
}

function TabBar({ projectId, title, path }: { projectId: string; title: string; path: string }) {
  const order = useApp((s) => s.tabOrder[projectId]) ?? []
  const tabs = useApp((s) => s.tabs)
  const activeId = useApp((s) => s.activeTabByProject[projectId])
  const activeIsTerminal = useApp((s) => s.tabs[s.activeTabByProject[projectId] ?? '']?.kind === 'terminal')
  const newTab = useApp((s) => s.newTab)
  const splitActivePane = useApp((s) => s.splitActivePane)
  const explorerOpen = useExplorer((s) => s.open)
  const toggleExplorer = useExplorer((s) => s.toggleOpen)

  return (
    <header className={`drag-region flex shrink-0 items-end gap-3 border-b border-line bg-panel pr-2 ${isMac ? 'h-12' : 'h-10'}`}>
      <div className="flex min-w-0 shrink-0 flex-col justify-center self-stretch pl-4" title={path}>
        <span className="max-w-56 truncate text-[13px] font-medium text-fg">{title}</span>
      </div>
      <div
        className="scrollbar-none no-drag flex min-w-0 flex-1 items-end gap-0.5 overflow-x-auto"
        onWheel={(e) => {
          // Vertical wheel scrolls the tab strip sideways.
          if (e.deltaY && !e.deltaX) e.currentTarget.scrollLeft += e.deltaY
        }}
      >
        {order.map((id) => {
          const tab = tabs[id]
          return tab ? <TabButton key={id} tab={tab} active={id === activeId} /> : null
        })}
        <button
          className="mb-1.5 ml-1 shrink-0 rounded p-1 text-muted hover:bg-panel-2 hover:text-fg"
          title={`Nouvel onglet (${shortcutLabel('newTerminal')})`}
          onClick={() => newTab(projectId)}
        >
          <Plus size={15} />
        </button>
      </div>
      <div className="no-drag mb-1.5 flex shrink-0 items-center gap-0.5">
        {activeIsTerminal && (
          <>
            <button
              className="rounded p-1 text-muted hover:bg-panel-2 hover:text-fg"
              title={`Diviser à droite (${shortcutLabel('splitRight')})`}
              onClick={() => splitActivePane('row')}
            >
              <Columns2 size={15} />
            </button>
            <button
              className="rounded p-1 text-muted hover:bg-panel-2 hover:text-fg"
              title={`Diviser en bas (${shortcutLabel('splitDown')})`}
              onClick={() => splitActivePane('column')}
            >
              <Rows2 size={15} />
            </button>
            <div className="mx-1 h-4 w-px bg-line" />
          </>
        )}
        <button
          className={`rounded p-1 hover:bg-panel-2 hover:text-fg ${explorerOpen ? 'text-accent' : 'text-muted'}`}
          title={`${explorerOpen ? 'Masquer' : 'Afficher'} l’explorateur (${shortcutLabel('toggleExplorer')})`}
          onClick={toggleExplorer}
        >
          {explorerOpen ? <PanelRightClose size={15} /> : <PanelRight size={15} />}
        </button>
      </div>
    </header>
  )
}

function TabButton({ tab, active }: { tab: Tab; active: boolean }) {
  const isEditor = tab.kind === 'editor'
  const isDiff = tab.kind === 'diff'
  const ids = tab.kind === 'terminal' ? paneIds(tab.layout) : []
  const dirty = useEditors((s) => isEditor && !!s.meta[tab.id]?.dirty)
  const label = useApp((s) => tabLabel(s, tab))
  const agent = useApp((s) => mostUrgentAgent(s.agents, ids))
  const unread = useApp((s) => ids.some((id) => s.terminals[id]?.unread))
  const exited = useApp((s) => s.terminals[tab.activePaneId]?.exitCode != null)
  const selectTab = useApp((s) => s.selectTab)
  const closeTerminalTab = useApp((s) => s.closeTab)
  // Editor tabs go through the unsaved-changes prompt.
  const closeTab = (tabId: string) => (isEditor ? useEditors.getState().requestClose(tabId) : closeTerminalTab(tabId))
  const renameTab = useApp((s) => s.renameTab)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')

  const finish = (save: boolean) => {
    if (save) renameTab(tab.id, draft)
    setEditing(false)
  }

  return (
    <div
      onMouseDown={(e) => {
        // Middle click closes, like browser tabs.
        if (e.button === 1) {
          e.preventDefault()
          closeTab(tab.id)
        }
      }}
      onClick={() => selectTab(tab.id)}
      onDoubleClick={() => {
        if (tab.kind !== 'terminal') return
        setDraft(label)
        setEditing(true)
      }}
      title={isEditor ? (tab.filePath ?? label) : isDiff ? `Diff · ${tab.diff?.path ?? label}` : label}
      className={`group flex h-8 max-w-56 min-w-28 shrink-0 cursor-pointer items-center gap-1.5 rounded-t-md border border-b-0 px-2.5 text-[12px] ${
        active ? 'border-line bg-bg text-fg' : 'border-transparent text-muted hover:bg-panel-2 hover:text-fg'
      }`}
    >
      {isEditor ? (
        <EntryIcon entry={{ name: label, isDirectory: false }} />
      ) : isDiff ? (
        <GitCompare size={13} className="shrink-0 text-violet-300/80" />
      ) : agent ? (
        <AgentStatusIcon state={agent.state} kind={agent.kind} />
      ) : (
        <SquareTerminal size={13} className={exited ? 'text-red-400' : active ? 'text-accent' : ''} />
      )}
      {editing ? (
        <input
          autoFocus
          value={draft}
          onFocus={(e) => e.currentTarget.select()}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => finish(true)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') finish(true)
            if (e.key === 'Escape') finish(false)
          }}
          className="w-full min-w-0 rounded border border-line bg-panel px-1 text-[12px] text-fg outline-none focus:border-accent"
        />
      ) : (
        <span className="min-w-0 flex-1 truncate">{label}</span>
      )}
      {ids.length > 1 && (
        <span className="flex shrink-0 items-center gap-0.5 text-[10px] text-faint" title={`${ids.length} terminaux`}>
          <Columns2 size={10} />
          {ids.length}
        </span>
      )}
      {unread && !active && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />}
      <button
        className={`group/close relative shrink-0 rounded p-0.5 text-faint hover:bg-line hover:text-fg ${active || dirty ? '' : 'opacity-0 group-hover:opacity-100'}`}
        title={
          dirty
            ? 'Modifications non enregistrées · fermer'
            : ids.length > 1
              ? `Fermer l’onglet (${ids.length} terminaux)`
              : `Fermer (${shortcutLabel('closeTerminal')})`
        }
        onClick={(e) => {
          e.stopPropagation()
          closeTab(tab.id)
        }}
      >
        {/* Unsaved: a dot that turns into × on hover, like VS Code. */}
        {dirty ? (
          <>
            <span className="block h-3 w-3 p-[3px] group-hover/close:hidden">
              <span className="block h-full w-full rounded-full bg-fg" />
            </span>
            <X size={12} className="hidden group-hover/close:block" />
          </>
        ) : (
          <X size={12} />
        )}
      </button>
    </div>
  )
}

function NoProject() {
  const addProject = useApp((s) => s.addProject)
  return (
    <EmptyState
      logo
      title="Bienvenue à bord de Capitaine"
      text="Ajoutez un dossier de projet pour y ouvrir des terminaux."
      action={{ label: 'Ajouter un projet', shortcut: shortcutLabel('addProject'), icon: <FolderPlus size={14} />, onClick: () => void addProject() }}
    />
  )
}

function NoTerminal() {
  const newTab = useApp((s) => s.newTab)
  return (
    <EmptyState
      title="Aucun terminal ouvert"
      text={`Les terminaux s'ouvrent dans le dossier du projet. ${shortcutLabel('splitRight')} pour en mettre deux côte à côte.`}
      action={{ label: 'Nouveau terminal', shortcut: shortcutLabel('newTerminal'), icon: <Plus size={14} />, onClick: () => newTab() }}
    />
  )
}

interface EmptyStateProps {
  logo?: boolean
  title: string
  text: string
  action: { label: string; shortcut: string; icon: React.ReactNode; onClick(): void }
}

function EmptyState({ logo: showLogo, title, text, action }: EmptyStateProps) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-center">
      {showLogo && <img src={logo} alt="" className="mb-2 h-24 w-24" draggable={false} />}
      <h2 className="text-base font-medium text-fg">{title}</h2>
      <p className="max-w-sm text-[13px] text-muted">{text}</p>
      <button
        onClick={action.onClick}
        className="mt-2 flex items-center gap-2 rounded-md bg-accent px-3 py-1.5 text-[13px] font-medium text-bg hover:brightness-110"
      >
        {action.icon}
        {action.label}
        <kbd className="ml-1 rounded bg-bg/15 px-1.5 py-0.5 font-sans text-[11px]">{action.shortcut}</kbd>
      </button>
    </div>
  )
}
