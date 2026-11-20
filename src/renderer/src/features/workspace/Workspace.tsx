import { lazy, Suspense, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Columns2, FolderPlus, GitCompare, MessageSquare, PanelRight, PanelRightClose, Plus, Rows2, SquareTerminal, X } from 'lucide-react'
import { useEditors } from '@/features/editor/editor-store'
import { usePanels } from '@/app/panels-store'
import { startDrag } from '@/lib/drag'
import { computeLayout, dragSizes, nodeAt, paneIds, type Divider, type Rect } from './layout'
import { isMac, shortcutLabel } from '@/lib/platform'
import { mostUrgentAgent, tabLabel, useApp, type Tab } from './workspace-store'
import { TabMenu } from './TabMenu'
import { AgentStatusIcon } from '@/features/claude/AgentStatus'
import { EntryIcon } from '@/features/files/FileIcon'
import { TerminalView } from '@/features/terminals/TerminalView'
import { ChatView } from '@/features/chat/ChatView'
import { AgentButton, ViewToggleButton } from '@/features/chat/AgentButton'
import { TitleBarBrand, titleBarHeightClass, WindowControlsSpacer } from '@/app/TitleBar'
import logo from '@resources/icon.svg'

const FULL: Rect = { left: 0, top: 0, width: 1, height: 1 }

// Monaco is several MB: it only loads once a file is opened.
const EditorView = lazy(() => import('@/features/editor/EditorView'))
const DiffView = lazy(() => import('@/features/git/DiffView'))

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
          const props = {
            cwd: projectPaths.get(terminal.projectId) ?? '',
            rect: layout?.panes.get(terminal.id) ?? FULL,
            visible,
            focused: visible && tab?.activePaneId === terminal.id,
            showHeader: (layout?.panes.size ?? 1) > 1
          }
          // A pane switching between chat and terminal remounts as the other view.
          return terminal.view === 'chat' ? (
            <ChatView key={`${terminal.id}:chat`} chatId={terminal.id} {...props} />
          ) : (
            <TerminalView key={`${terminal.id}:shell`} terminalId={terminal.id} {...props} />
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
  const sidebarOpen = usePanels((s) => s.sidebarOpen)
  return (
    <div className={`drag-region flex shrink-0 items-center border-b border-line ${titleBarHeightClass}`}>
      {!sidebarOpen && <TitleBarBrand compact />}
      <div className="flex-1" />
      <WindowControlsSpacer />
    </div>
  )
}

function TabBar({ projectId, title, path }: { projectId: string; title: string; path: string }) {
  const order = useApp((s) => s.tabOrder[projectId]) ?? []
  const tabs = useApp((s) => s.tabs)
  const activeId = useApp((s) => s.activeTabByProject[projectId])
  const activeIsTerminal = useApp((s) => s.tabs[s.activeTabByProject[projectId] ?? '']?.kind === 'terminal')
  const activePaneId = useApp((s) => {
    const tab = s.tabs[s.activeTabByProject[projectId] ?? '']
    return tab?.kind === 'terminal' ? tab.activePaneId : null
  })
  const newTab = useApp((s) => s.newTab)
  const splitActivePane = useApp((s) => s.splitActivePane)
  const explorerOpen = usePanels((s) => s.rightOpen)
  const toggleExplorer = usePanels((s) => s.toggleRight)
  const sidebarOpen = usePanels((s) => s.sidebarOpen)
  const strip = useRef<HTMLDivElement>(null)
  const edges = useStripEdges(strip, order.length)

  return (
    <header className={`drag-region @container flex shrink-0 items-end gap-3 border-b border-line bg-panel ${explorerOpen ? 'pr-2' : ''} ${titleBarHeightClass}`}>
      {!sidebarOpen && (
        <div className="flex shrink-0 self-stretch">
          <TitleBarBrand compact />
        </div>
      )}
      <div className={`flex min-w-0 shrink-0 flex-col justify-center self-stretch ${sidebarOpen ? 'pl-4' : ''}`} title={path}>
        <span className="max-w-56 truncate text-ui font-medium text-fg">{title}</span>
      </div>
      <div
        ref={strip}
        className="scrollbar-none no-drag flex min-w-0 shrink snap-x snap-proximity items-end gap-0.5 overflow-x-auto"
        style={{ maskImage: stripMask(edges), WebkitMaskImage: stripMask(edges) }}
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
      {/* Empty title-bar space: grab here to move the window (the tab strip itself is no-drag). */}
      <div className="min-w-[96px] flex-1 self-stretch" data-window-drag />
      <div className="no-drag mb-1.5 flex shrink-0 items-center gap-0.5">
        <AgentButton projectId={projectId} />
        {activePaneId && <ViewToggleButton terminalId={activePaneId} />}
        <div className="mx-1 h-4 w-px bg-line" />
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
      {/* The window buttons sit over the top-most right header: the right panel's when it's open. */}
      {!explorerOpen && (
        <div className="self-stretch">
          <WindowControlsSpacer />
        </div>
      )}
    </header>
  )
}

const STRIP_FADE = 28

/** Which ends of the tab strip hide tabs, kept up to date as it scrolls, resizes or gains tabs. */
function useStripEdges(ref: React.RefObject<HTMLDivElement | null>, tabCount: number) {
  const [edges, setEdges] = useState({ start: false, end: false })
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const measure = () => {
      const start = el.scrollLeft > 1
      const end = el.scrollLeft + el.clientWidth < el.scrollWidth - 1
      setEdges((prev) => (prev.start === start && prev.end === end ? prev : { start, end }))
    }
    measure()
    el.addEventListener('scroll', measure, { passive: true })
    const observer = new ResizeObserver(measure)
    observer.observe(el)
    return () => {
      el.removeEventListener('scroll', measure)
      observer.disconnect()
    }
  }, [ref, tabCount])
  return edges
}

/** Fades the ends that hide tabs, so a cut tab reads as "more this way". */
function stripMask(edges: { start: boolean; end: boolean }): string | undefined {
  if (!edges.start && !edges.end) return undefined
  const from = edges.start ? `transparent, black ${STRIP_FADE}px` : 'black'
  const to = edges.end ? `black calc(100% - ${STRIP_FADE}px), transparent` : 'black'
  return `linear-gradient(to right, ${from}, ${to})`
}

function TabButton({ tab, active }: { tab: Tab; active: boolean }) {
  const ref = useRef<HTMLDivElement>(null)
  // The tab you're on is always in view, whole.
  useLayoutEffect(() => {
    const el = ref.current
    const strip = el?.parentElement
    if (!active || !el || !strip) return
    // The strip alone scrolls: scrollIntoView could also shift the clipped containers above it.
    const box = el.getBoundingClientRect()
    const view = strip.getBoundingClientRect()
    if (box.left < view.left) strip.scrollLeft -= view.left - box.left
    else if (box.right > view.right) strip.scrollLeft += box.right - view.right
  }, [active])
  const isEditor = tab.kind === 'editor'
  const isDiff = tab.kind === 'diff'
  const ids = tab.kind === 'terminal' ? paneIds(tab.layout) : []
  const dirty = useEditors((s) => isEditor && !!s.meta[tab.id]?.dirty)
  const label = useApp((s) => tabLabel(s, tab))
  const agent = useApp((s) => mostUrgentAgent(s.agents, ids))
  const unread = useApp((s) => ids.some((id) => s.terminals[id]?.unread))
  const exited = useApp((s) => s.terminals[tab.activePaneId]?.exitCode != null)
  const chat = useApp((s) => tab.kind === 'terminal' && s.terminals[tab.activePaneId]?.view === 'chat')
  const selectTab = useApp((s) => s.selectTab)
  // Editor tabs go through the unsaved-changes prompt.
  const closeTab = (tabId: string) => useEditors.getState().requestClose(tabId)
  const renameTab = useApp((s) => s.renameTab)
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const closeMenu = useCallback(() => setMenu(null), [])
  const startRename = () => {
    setDraft(label)
    setEditing(true)
  }

  const finish = (save: boolean) => {
    if (save) renameTab(tab.id, draft)
    setEditing(false)
  }

  return (
    <div
      ref={ref}
      onMouseDown={(e) => {
        // Middle click closes, like browser tabs.
        if (e.button === 1) {
          e.preventDefault()
          closeTab(tab.id)
        }
      }}
      onClick={() => selectTab(tab.id)}
      onContextMenu={(e) => {
        e.preventDefault()
        setMenu({ x: e.clientX, y: e.clientY })
      }}
      onDoubleClick={() => {
        if (tab.kind === 'terminal') startRename()
      }}
      title={isEditor ? (tab.filePath ?? label) : isDiff ? `Diff · ${tab.diff?.path ?? label}` : label}
      className={`group flex h-8 max-w-56 min-w-28 shrink-0 cursor-pointer snap-start items-center gap-1.5 rounded-t-md border border-b-0 px-2.5 text-small ${
        active ? 'border-line bg-bg text-fg' : 'border-transparent text-muted hover:bg-panel-2 hover:text-fg'
      }`}
    >
      {isEditor ? (
        <EntryIcon entry={{ name: label, isDirectory: false }} />
      ) : isDiff ? (
        <GitCompare size={13} className="shrink-0 text-violet-300/80" />
      ) : agent ? (
        <AgentStatusIcon state={agent.state} kind={agent.kind} />
      ) : chat ? (
        <MessageSquare size={13} className={active ? 'text-accent' : ''} />
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
          className="w-full min-w-0 rounded border border-line bg-panel px-1 text-small text-fg outline-none focus:border-accent"
        />
      ) : (
        <span className="min-w-0 flex-1 truncate">{label}</span>
      )}
      {ids.length > 1 && (
        <span className="flex shrink-0 items-center gap-0.5 text-caption text-faint" title={`${ids.length} terminaux`}>
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
      {menu && <TabMenu tab={tab} x={menu.x} y={menu.y} onClose={closeMenu} onRename={startRename} />}
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
  const newAgent = useApp((s) => s.newAgent)
  return (
    <EmptyState
      title="Aucun terminal ouvert"
      text={`Les terminaux et les agents s'ouvrent dans le dossier du projet. ${shortcutLabel('splitRight')} pour en mettre deux côte à côte.`}
      action={{ label: 'Nouveau terminal', shortcut: shortcutLabel('newTerminal'), icon: <Plus size={14} />, onClick: () => newTab() }}
      secondary={{ label: 'Nouvel agent Claude', shortcut: shortcutLabel('newAgent'), icon: <MessageSquare size={14} />, onClick: () => newAgent() }}
    />
  )
}

interface EmptyStateAction {
  label: string
  shortcut: string
  icon: React.ReactNode
  onClick(): void
}

interface EmptyStateProps {
  logo?: boolean
  title: string
  text: string
  action: EmptyStateAction
  secondary?: EmptyStateAction
}

function EmptyState({ logo: showLogo, title, text, action, secondary }: EmptyStateProps) {
  return (
    <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-center">
      {showLogo && <img src={logo} alt="" className="mb-2 h-24 w-24" draggable={false} />}
      <h2 className="text-title font-medium text-fg">{title}</h2>
      <p className="max-w-sm text-ui text-muted">{text}</p>
      <button
        onClick={action.onClick}
        className="mt-2 flex items-center gap-2 rounded-md bg-accent px-3 py-1.5 text-ui font-medium text-bg hover:brightness-110"
      >
        {action.icon}
        {action.label}
        <kbd className="ml-1 rounded bg-bg/15 px-1.5 py-0.5 font-sans text-caption">{action.shortcut}</kbd>
      </button>
      {secondary && (
        <button
          onClick={secondary.onClick}
          className="flex items-center gap-2 rounded-md border border-line px-3 py-1.5 text-ui font-medium text-fg hover:bg-panel-2"
        >
          {secondary.icon}
          {secondary.label}
          <kbd className="ml-1 rounded bg-panel-2 px-1.5 py-0.5 font-sans text-caption text-muted">{secondary.shortcut}</kbd>
        </button>
      )}
    </div>
  )
}
