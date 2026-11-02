import { create } from 'zustand'
import type { Project } from '@shared/types'
import { applyAgentReport, stripStatusGlyph, type AgentReport, type AgentSession, type AgentState } from './agent-status'
import { pane, paneIds, removePane, resizeSplit, splitPane, type LayoutNode, type SplitDirection } from './layout'

/** One shell. Lives in a pane of a tab's layout. */
export interface TerminalPane {
  id: string
  projectId: string
  tabId: string
  number: number
  /** Title pushed by the shell via OSC escape sequences. */
  shellTitle: string | null
  /** Title set by the user; wins over the shell title. */
  customTitle: string | null
  unread: boolean
  exitCode: number | null
}

/** A tab holds one or more terminals arranged side by side / stacked, or one file editor. */
export interface Tab {
  id: string
  projectId: string
  kind: 'terminal' | 'editor'
  /** Absolute path of the edited file (editor tabs only). */
  filePath: string | null
  /** Terminal layout. An editor tab keeps a single placeholder pane named after itself. */
  layout: LayoutNode
  /** The pane that has keyboard focus inside this tab. */
  activePaneId: string
  customTitle: string | null
}

interface AppState {
  projects: Project[]
  activeProjectId: string | null
  terminals: Record<string, TerminalPane>
  /** Terminal ids per project in creation order (sidebar listing). */
  terminalOrder: Record<string, string[]>
  tabs: Record<string, Tab>
  tabOrder: Record<string, string[]>
  activeTabByProject: Record<string, string | null>
  nextTerminalNumber: Record<string, number>
  /** Agents (Claude Code…) currently running in a terminal, keyed by terminal id. */
  agents: Record<string, AgentSession>

  loadProjects(): Promise<void>
  addProject(): Promise<void>
  renameProject(id: string, name: string): Promise<void>
  removeProject(id: string): Promise<void>
  reorderProjects(ids: string[]): Promise<void>
  selectProject(id: string): void

  newTab(projectId?: string): void
  /** Opens a file in an editor tab, or brings its existing tab forward. */
  openFile(projectId: string, path: string): void
  /** Closes unconditionally; unsaved-changes prompts happen before (editor-store). */
  closeTab(tabId: string): void
  selectTab(tabId: string): void
  cycleTab(direction: 1 | -1): void
  renameTab(tabId: string, title: string): void
  splitActivePane(direction: SplitDirection): void
  resizeSplit(tabId: string, path: number[], sizes: number[]): void
  focusPane(terminalId: string): void
  cyclePane(direction: 1 | -1): void
  closeActivePane(): void

  closeTerminal(terminalId: string): void
  renameTerminal(terminalId: string, title: string): void
  setShellTitle(terminalId: string, title: string): void
  markUnread(terminalId: string): void
  markExited(terminalId: string, exitCode: number): void
  applyAgentReport(terminalId: string, report: AgentReport): void
  clearAgent(terminalId: string): void
  /** Brings a terminal on screen from anywhere (sidebar, notification). */
  focusTerminal(terminalId: string): void
}

const ACTIVE_PROJECT_KEY = 'capitaine.activeProjectId'

/** Shells title themselves `user@host: ~/dir`; the user and host are noise here. */
function cleanShellTitle(title: string): string {
  return stripStatusGlyph(title).replace(/^[^@\s]+@[^:\s]+:\s*/, '')
}

export function terminalLabel(terminal: TerminalPane): string {
  return terminal.customTitle || (terminal.shellTitle && cleanShellTitle(terminal.shellTitle)) || `Terminal ${terminal.number}`
}

export function fileName(path: string): string {
  return path.split(/[\\/]/).pop() || path
}

export function tabLabel(state: Pick<AppState, 'terminals'>, tab: Tab): string {
  if (tab.kind === 'editor' && tab.filePath) return tab.customTitle || fileName(tab.filePath)
  const active = state.terminals[tab.activePaneId]
  return tab.customTitle || (active ? terminalLabel(active) : 'Terminal')
}

const URGENCY: AgentState[] = ['blocked', 'error', 'working', 'done', 'idle']

/** The most urgent agent state among the given terminals. */
export function mostUrgentAgent(agents: Record<string, AgentSession>, terminalIds: string[]): AgentSession | null {
  let best: AgentSession | null = null
  for (const id of terminalIds) {
    const agent = agents[id]
    if (agent && (!best || URGENCY.indexOf(agent.state) < URGENCY.indexOf(best.state))) best = agent
  }
  return best
}

function without<T>(record: Record<string, T>, keys: Iterable<string>): Record<string, T> {
  const next = { ...record }
  for (const key of keys) delete next[key]
  return next
}

function newPane(state: AppState, projectId: string, tabId: string): { terminal: TerminalPane; nextNumber: number } {
  const number = state.nextTerminalNumber[projectId] ?? 1
  const terminal: TerminalPane = {
    id: crypto.randomUUID(),
    projectId,
    tabId,
    number,
    shellTitle: null,
    customTitle: null,
    unread: false,
    exitCode: null
  }
  return { terminal, nextNumber: number + 1 }
}

/** State patch removing a tab and focusing its neighbour when it was the active one. */
function removeTab(state: AppState, tabId: string): Partial<AppState> {
  const tab = state.tabs[tabId]
  if (!tab) return {}
  const { projectId } = tab
  const order = state.tabOrder[projectId] ?? []
  const index = order.indexOf(tabId)
  const nextOrder = order.filter((id) => id !== tabId)
  const wasActive = state.activeTabByProject[projectId] === tabId
  return {
    tabs: without(state.tabs, [tabId]),
    tabOrder: { ...state.tabOrder, [projectId]: nextOrder },
    activeTabByProject: wasActive
      ? { ...state.activeTabByProject, [projectId]: nextOrder[Math.min(index, nextOrder.length - 1)] ?? null }
      : state.activeTabByProject
  }
}

function clearUnread(terminals: Record<string, TerminalPane>, ids: string[]): Record<string, TerminalPane> {
  if (!ids.some((id) => terminals[id]?.unread)) return terminals
  const next = { ...terminals }
  for (const id of ids) if (next[id]?.unread) next[id] = { ...next[id], unread: false }
  return next
}

export const useApp = create<AppState>((set, get) => ({
  projects: [],
  activeProjectId: null,
  terminals: {},
  terminalOrder: {},
  tabs: {},
  tabOrder: {},
  activeTabByProject: {},
  nextTerminalNumber: {},
  agents: {},

  async loadProjects() {
    const projects = await window.capitaine.projects.list()
    const remembered = localStorage.getItem(ACTIVE_PROJECT_KEY)
    const active = projects.find((p) => p.id === remembered)?.id ?? projects[0]?.id ?? null
    set({ projects, activeProjectId: active })
  },

  async addProject() {
    const project = await window.capitaine.projects.add()
    if (!project) return
    const projects = await window.capitaine.projects.list()
    set({ projects })
    get().selectProject(project.id)
    if ((get().tabOrder[project.id] ?? []).length === 0) get().newTab(project.id)
  },

  async renameProject(id, name) {
    set({ projects: await window.capitaine.projects.rename(id, name) })
  },

  async removeProject(id) {
    const projects = await window.capitaine.projects.remove(id)
    set((state) => {
      const terminalIds = state.terminalOrder[id] ?? []
      const tabIds = state.tabOrder[id] ?? []
      const activeProjectId = state.activeProjectId === id ? (projects[0]?.id ?? null) : state.activeProjectId
      return {
        projects,
        activeProjectId,
        terminals: without(state.terminals, terminalIds),
        agents: without(state.agents, terminalIds),
        terminalOrder: without(state.terminalOrder, [id]),
        tabs: without(state.tabs, tabIds),
        tabOrder: without(state.tabOrder, [id]),
        activeTabByProject: without(state.activeTabByProject, [id])
      }
    })
  },

  async reorderProjects(ids) {
    set({ projects: await window.capitaine.projects.reorder(ids) })
  },

  selectProject(id) {
    localStorage.setItem(ACTIVE_PROJECT_KEY, id)
    set({ activeProjectId: id })
    const activeTab = get().activeTabByProject[id]
    if (activeTab) get().selectTab(activeTab)
  },

  newTab(projectId) {
    const target = projectId ?? get().activeProjectId
    if (!target) return
    set((state) => {
      const tabId = crypto.randomUUID()
      const { terminal, nextNumber } = newPane(state, target, tabId)
      const tab: Tab = {
        id: tabId,
        projectId: target,
        kind: 'terminal',
        filePath: null,
        layout: pane(terminal.id),
        activePaneId: terminal.id,
        customTitle: null
      }
      return {
        terminals: { ...state.terminals, [terminal.id]: terminal },
        terminalOrder: { ...state.terminalOrder, [target]: [...(state.terminalOrder[target] ?? []), terminal.id] },
        tabs: { ...state.tabs, [tabId]: tab },
        tabOrder: { ...state.tabOrder, [target]: [...(state.tabOrder[target] ?? []), tabId] },
        activeTabByProject: { ...state.activeTabByProject, [target]: tabId },
        nextTerminalNumber: { ...state.nextTerminalNumber, [target]: nextNumber }
      }
    })
  },

  openFile(projectId, path) {
    const state = get()
    const existing = (state.tabOrder[projectId] ?? []).find((id) => state.tabs[id]?.filePath === path)
    if (state.activeProjectId !== projectId) state.selectProject(projectId)
    if (existing) {
      get().selectTab(existing)
      return
    }
    set((s) => {
      const tabId = crypto.randomUUID()
      const tab: Tab = { id: tabId, projectId, kind: 'editor', filePath: path, layout: pane(tabId), activePaneId: tabId, customTitle: null }
      // New editor tabs land right after the current tab, like in most editors.
      const order = s.tabOrder[projectId] ?? []
      const at = order.indexOf(s.activeTabByProject[projectId] ?? '')
      const nextOrder = at === -1 ? [...order, tabId] : [...order.slice(0, at + 1), tabId, ...order.slice(at + 1)]
      return {
        tabs: { ...s.tabs, [tabId]: tab },
        tabOrder: { ...s.tabOrder, [projectId]: nextOrder },
        activeTabByProject: { ...s.activeTabByProject, [projectId]: tabId }
      }
    })
  },

  closeTab(tabId) {
    const tab = get().tabs[tabId]
    if (!tab) return
    if (tab.kind === 'editor') {
      set((state) => removeTab(state, tabId))
      return
    }
    for (const id of paneIds(tab.layout)) get().closeTerminal(id)
  },

  selectTab(tabId) {
    set((state) => {
      const tab = state.tabs[tabId]
      if (!tab) return state
      return {
        activeTabByProject: { ...state.activeTabByProject, [tab.projectId]: tabId },
        terminals: clearUnread(state.terminals, paneIds(tab.layout))
      }
    })
  },

  cycleTab(direction) {
    const { activeProjectId, tabOrder, activeTabByProject } = get()
    if (!activeProjectId) return
    const order = tabOrder[activeProjectId] ?? []
    if (order.length < 2) return
    const current = order.indexOf(activeTabByProject[activeProjectId] ?? '')
    get().selectTab(order[(current + direction + order.length) % order.length])
  },

  renameTab(tabId, title) {
    set((state) => {
      const tab = state.tabs[tabId]
      if (!tab) return state
      return { tabs: { ...state.tabs, [tabId]: { ...tab, customTitle: title.trim() || null } } }
    })
  },

  splitActivePane(direction) {
    const { activeProjectId, activeTabByProject } = get()
    const tabId = activeProjectId ? activeTabByProject[activeProjectId] : null
    // Editors don't split (yet): a split request from one opens a terminal tab instead.
    if (!activeProjectId || !tabId || get().tabs[tabId]?.kind === 'editor') {
      get().newTab()
      return
    }
    set((state) => {
      const tab = state.tabs[tabId]
      const { terminal, nextNumber } = newPane(state, activeProjectId, tabId)
      return {
        terminals: { ...state.terminals, [terminal.id]: terminal },
        terminalOrder: {
          ...state.terminalOrder,
          [activeProjectId]: [...(state.terminalOrder[activeProjectId] ?? []), terminal.id]
        },
        tabs: {
          ...state.tabs,
          [tabId]: { ...tab, layout: splitPane(tab.layout, tab.activePaneId, terminal.id, direction), activePaneId: terminal.id }
        },
        nextTerminalNumber: { ...state.nextTerminalNumber, [activeProjectId]: nextNumber }
      }
    })
  },

  resizeSplit(tabId, path, sizes) {
    set((state) => {
      const tab = state.tabs[tabId]
      if (!tab) return state
      return { tabs: { ...state.tabs, [tabId]: { ...tab, layout: resizeSplit(tab.layout, path, sizes) } } }
    })
  },

  focusPane(terminalId) {
    set((state) => {
      const terminal = state.terminals[terminalId]
      const tab = terminal && state.tabs[terminal.tabId]
      if (!tab) return state
      const unchanged = tab.activePaneId === terminalId && state.activeTabByProject[tab.projectId] === tab.id && !terminal.unread
      if (unchanged) return state
      return {
        tabs: tab.activePaneId === terminalId ? state.tabs : { ...state.tabs, [tab.id]: { ...tab, activePaneId: terminalId } },
        activeTabByProject: { ...state.activeTabByProject, [tab.projectId]: tab.id },
        terminals: clearUnread(state.terminals, [terminalId])
      }
    })
  },

  cyclePane(direction) {
    const { activeProjectId, activeTabByProject, tabs } = get()
    const tab = activeProjectId ? tabs[activeTabByProject[activeProjectId] ?? ''] : undefined
    if (!tab) return
    const ids = paneIds(tab.layout)
    if (ids.length < 2) return
    const current = ids.indexOf(tab.activePaneId)
    get().focusPane(ids[(current + direction + ids.length) % ids.length])
  },

  closeActivePane() {
    const { activeProjectId, activeTabByProject, tabs } = get()
    const tab = activeProjectId ? tabs[activeTabByProject[activeProjectId] ?? ''] : undefined
    if (tab?.kind === 'terminal') get().closeTerminal(tab.activePaneId)
  },

  closeTerminal(terminalId) {
    set((state) => {
      const terminal = state.terminals[terminalId]
      if (!terminal) return state
      const { projectId, tabId } = terminal
      const tab = state.tabs[tabId]
      const base = {
        terminals: without(state.terminals, [terminalId]),
        agents: without(state.agents, [terminalId]),
        terminalOrder: { ...state.terminalOrder, [projectId]: (state.terminalOrder[projectId] ?? []).filter((id) => id !== terminalId) }
      }
      if (!tab) return base

      const layout = removePane(tab.layout, terminalId)
      if (layout) {
        // Focus moves to the pane that took the closed one's place.
        const before = paneIds(tab.layout)
        const after = paneIds(layout)
        const activePaneId =
          tab.activePaneId === terminalId ? after[Math.min(before.indexOf(terminalId), after.length - 1)] : tab.activePaneId
        return { ...base, tabs: { ...state.tabs, [tabId]: { ...tab, layout, activePaneId } } }
      }

      return { ...base, ...removeTab(state, tabId) }
    })
  },

  renameTerminal(terminalId, title) {
    set((state) => {
      const terminal = state.terminals[terminalId]
      if (!terminal) return state
      return { terminals: { ...state.terminals, [terminalId]: { ...terminal, customTitle: title.trim() || null } } }
    })
  },

  setShellTitle(terminalId, title) {
    set((state) => {
      const terminal = state.terminals[terminalId]
      if (!terminal || terminal.shellTitle === (title || null)) return state
      return { terminals: { ...state.terminals, [terminalId]: { ...terminal, shellTitle: title || null } } }
    })
  },

  markUnread(terminalId) {
    set((state) => {
      const terminal = state.terminals[terminalId]
      if (!terminal || terminal.unread) return state
      return { terminals: { ...state.terminals, [terminalId]: { ...terminal, unread: true } } }
    })
  },

  markExited(terminalId, exitCode) {
    set((state) => {
      const terminal = state.terminals[terminalId]
      if (!terminal) return state
      return {
        terminals: { ...state.terminals, [terminalId]: { ...terminal, exitCode } },
        agents: without(state.agents, [terminalId])
      }
    })
  },

  applyAgentReport(terminalId, report) {
    set((state) => {
      if (!state.terminals[terminalId]) return state
      const next = applyAgentReport(state.agents[terminalId], report, Date.now())
      if (!next) return state.agents[terminalId] ? { agents: without(state.agents, [terminalId]) } : state
      return { agents: { ...state.agents, [terminalId]: next } }
    })
  },

  clearAgent(terminalId) {
    set((state) => (state.agents[terminalId] ? { agents: without(state.agents, [terminalId]) } : state))
  },

  focusTerminal(terminalId) {
    const terminal = get().terminals[terminalId]
    if (!terminal) return
    if (get().activeProjectId !== terminal.projectId) get().selectProject(terminal.projectId)
    get().focusPane(terminalId)
  }
}))

/** True when the terminal is on screen (its tab is the active one of the active project). */
export function isTerminalVisible(state: AppState, terminalId: string): boolean {
  const terminal = state.terminals[terminalId]
  return !!terminal && state.activeProjectId === terminal.projectId && state.activeTabByProject[terminal.projectId] === terminal.tabId
}

/** True when the terminal is on screen and has keyboard focus. */
export function isTerminalFocused(state: AppState, terminalId: string): boolean {
  const terminal = state.terminals[terminalId]
  return isTerminalVisible(state, terminalId) && state.tabs[terminal.tabId]?.activePaneId === terminalId
}
