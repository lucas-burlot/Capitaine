/**
 * Keeps the open tabs and terminals across app restarts. The layout is saved shortly after every
 * change, the terminals' screens periodically and when the window unloads; on launch the tabs come
 * back and each terminal starts a new shell in the directory it was in, under its old output, and
 * resumes the Claude session that was running in it.
 */
import type { Project, SavedTerminal, SessionSaveInput } from '@shared/types'
import { pane, paneIds, removePane, type LayoutNode } from './layout'
import { useApp, type Tab, type TerminalPane } from './workspace-store'
import { snapshotTerminal } from '@/features/terminals/terminal-registry'

interface SavedWorkspace {
  terminals: Record<string, Pick<TerminalPane, 'id' | 'projectId' | 'tabId' | 'number' | 'shellTitle' | 'customTitle'>>
  terminalOrder: Record<string, string[]>
  tabs: Record<string, Pick<Tab, 'id' | 'projectId' | 'kind' | 'filePath' | 'layout' | 'activePaneId' | 'customTitle'>>
  tabOrder: Record<string, string[]>
  activeTabByProject: Record<string, string | null>
  nextTerminalNumber: Record<string, number>
}

type AppSnapshot = ReturnType<typeof useApp.getState>

type RestoredWorkspace = Omit<SavedWorkspace, 'terminals' | 'tabs'> & {
  terminals: Record<string, TerminalPane>
  tabs: Record<string, Tab>
}

const SAVE_DEBOUNCE_MS = 1000
// Screens change without the store knowing; this bounds what a crash can lose.
const SAVE_INTERVAL_MS = 30_000

/** Saved screens and directories, waiting for their terminal to mount. */
const restored = new Map<string, SavedTerminal>()

export function restoredTerminal(terminalId: string): SavedTerminal | undefined {
  return restored.get(terminalId)
}

/** The terminal is back (its new shell started): its saved state is no longer needed. */
export function forgetRestoredTerminal(terminalId: string): void {
  restored.delete(terminalId)
}

/** Reopens what was open last time. Call once the projects are loaded. */
export async function restoreSession(): Promise<void> {
  const saved = await window.capitaine.session.load().catch(() => null)
  if (!saved) return
  const workspace = sanitizeWorkspace(saved.workspace, useApp.getState().projects)
  if (!workspace) return
  for (const id of Object.keys(workspace.terminals)) {
    const terminal = saved.terminals[id]
    if (!terminal) continue
    restored.set(id, {
      cwd: typeof terminal.cwd === 'string' ? terminal.cwd : null,
      scrollback: String(terminal.scrollback ?? ''),
      // Already checked by the main process.
      agent: terminal.agent ?? null
    })
  }
  useApp.setState((state) => ({
    terminals: { ...workspace.terminals, ...state.terminals },
    terminalOrder: mergeOrders(workspace.terminalOrder, state.terminalOrder),
    tabs: { ...workspace.tabs, ...state.tabs },
    tabOrder: mergeOrders(workspace.tabOrder, state.tabOrder),
    activeTabByProject: { ...workspace.activeTabByProject, ...state.activeTabByProject },
    nextTerminalNumber: { ...workspace.nextTerminalNumber, ...state.nextTerminalNumber }
  }))
}

/** Saves on every change from now on. Start it after `restoreSession`, or the empty state wins. */
export function startSessionPersistence(): () => void {
  let timer: ReturnType<typeof setTimeout> | undefined
  const unsubscribe = useApp.subscribe((state, previous) => {
    if (
      state.tabs === previous.tabs &&
      state.terminals === previous.terminals &&
      state.tabOrder === previous.tabOrder &&
      state.activeTabByProject === previous.activeTabByProject
    ) {
      return
    }
    clearTimeout(timer)
    timer = setTimeout(() => window.capitaine.session.save(captureSession(useApp.getState())), SAVE_DEBOUNCE_MS)
  })
  const interval = setInterval(() => window.capitaine.session.save(captureSession(useApp.getState())), SAVE_INTERVAL_MS)
  // Synchronous: the shells are killed as soon as the window is gone.
  const onUnload = () => window.capitaine.session.saveNow(captureSession(useApp.getState()))
  window.addEventListener('beforeunload', onUnload)
  return () => {
    unsubscribe()
    clearTimeout(timer)
    clearInterval(interval)
    window.removeEventListener('beforeunload', onUnload)
  }
}

function captureSession(state: AppSnapshot): SessionSaveInput {
  // Diff tabs point at changes or stashes that may be gone next time; they aren't kept.
  const tabs: SavedWorkspace['tabs'] = {}
  for (const tab of Object.values(state.tabs)) {
    if (tab.kind === 'diff') continue
    const { id, projectId, kind, filePath, layout, activePaneId, customTitle } = tab
    tabs[id] = { id, projectId, kind, filePath, layout, activePaneId, customTitle }
  }
  const terminals: SavedWorkspace['terminals'] = {}
  const screens: SessionSaveInput['terminals'] = {}
  for (const terminal of Object.values(state.terminals)) {
    const { id, projectId, tabId, number, shellTitle, customTitle } = terminal
    terminals[id] = { id, projectId, tabId, number, shellTitle, customTitle }
    // A terminal not mounted yet still has its saved screen: keep it rather than lose it.
    const pending = restored.get(id)
    screens[id] = snapshotTerminal(id) ?? { ptyId: null, scrollback: pending?.scrollback ?? '', agent: pending?.agent ?? null }
  }
  const tabOrder: Record<string, string[]> = {}
  for (const [projectId, ids] of Object.entries(state.tabOrder)) tabOrder[projectId] = ids.filter((id) => tabs[id])
  const workspace: SavedWorkspace = {
    terminals,
    terminalOrder: state.terminalOrder,
    tabs,
    tabOrder,
    activeTabByProject: state.activeTabByProject,
    nextTerminalNumber: state.nextTerminalNumber
  }
  return { workspace, terminals: screens }
}

/** Rebuilds a consistent workspace from whatever was saved, for the projects that still exist. */
function sanitizeWorkspace(raw: unknown, projects: Project[]): RestoredWorkspace | null {
  if (!isRecord(raw)) return null
  const projectIds = new Set(projects.map((p) => p.id))

  const terminals: Record<string, TerminalPane> = {}
  for (const value of Object.values(isRecord(raw.terminals) ? raw.terminals : {})) {
    if (!isRecord(value) || typeof value.id !== 'string' || typeof value.tabId !== 'string') continue
    if (typeof value.projectId !== 'string' || !projectIds.has(value.projectId)) continue
    terminals[value.id] = {
      id: value.id,
      projectId: value.projectId,
      tabId: value.tabId,
      number: typeof value.number === 'number' ? value.number : 1,
      shellTitle: typeof value.shellTitle === 'string' ? value.shellTitle : null,
      customTitle: typeof value.customTitle === 'string' ? value.customTitle : null,
      unread: false,
      exitCode: null
    }
  }

  const tabs: Record<string, Tab> = {}
  for (const value of Object.values(isRecord(raw.tabs) ? raw.tabs : {})) {
    if (!isRecord(value) || typeof value.id !== 'string') continue
    if (typeof value.projectId !== 'string' || !projectIds.has(value.projectId)) continue
    const customTitle = typeof value.customTitle === 'string' ? value.customTitle : null
    if (value.kind === 'editor') {
      if (typeof value.filePath !== 'string') continue
      tabs[value.id] = { id: value.id, projectId: value.projectId, kind: 'editor', filePath: value.filePath, layout: pane(value.id), activePaneId: value.id, customTitle }
      continue
    }
    if (value.kind !== 'terminal') continue
    const tabId = value.id
    // Only panes whose terminal came back, and that belong to this tab.
    let layout = parseLayout(value.layout)
    for (const id of layout ? paneIds(layout) : []) {
      if (terminals[id]?.tabId !== tabId || terminals[id].projectId !== value.projectId) layout = layout && removePane(layout, id)
    }
    if (!layout) continue
    const ids = paneIds(layout)
    const activePaneId = typeof value.activePaneId === 'string' && ids.includes(value.activePaneId) ? value.activePaneId : ids[0]
    tabs[tabId] = { id: tabId, projectId: value.projectId, kind: 'terminal', filePath: null, layout, activePaneId, customTitle }
  }

  // Terminals no tab shows would be invisible shells.
  for (const [id, terminal] of Object.entries(terminals)) {
    const tab = tabs[terminal.tabId]
    if (!tab || tab.kind !== 'terminal' || !paneIds(tab.layout).includes(id)) delete terminals[id]
  }
  if (Object.keys(tabs).length === 0) return null

  const tabOrder = orderFor(raw.tabOrder, tabs)
  const terminalOrder = orderFor(raw.terminalOrder, terminals)
  const savedActive = isRecord(raw.activeTabByProject) ? raw.activeTabByProject : {}
  const activeTabByProject: Record<string, string | null> = {}
  for (const [projectId, order] of Object.entries(tabOrder)) {
    const active = savedActive[projectId]
    activeTabByProject[projectId] = typeof active === 'string' && tabs[active]?.projectId === projectId ? active : order[0] ?? null
  }

  const savedNumbers = isRecord(raw.nextTerminalNumber) ? raw.nextTerminalNumber : {}
  const nextTerminalNumber: Record<string, number> = {}
  for (const terminal of Object.values(terminals)) {
    const saved = savedNumbers[terminal.projectId]
    const floor = Math.max(typeof saved === 'number' ? saved : 1, nextTerminalNumber[terminal.projectId] ?? 1)
    nextTerminalNumber[terminal.projectId] = Math.max(floor, terminal.number + 1)
  }

  return { terminals, terminalOrder, tabs, tabOrder, activeTabByProject, nextTerminalNumber }
}

/** Saved per-project order, keeping only known items and appending any it missed. */
function orderFor(raw: unknown, items: Record<string, { id: string; projectId: string }>): Record<string, string[]> {
  const saved = isRecord(raw) ? raw : {}
  const result: Record<string, string[]> = {}
  for (const item of Object.values(items)) {
    if (result[item.projectId]) continue
    const list = Array.isArray(saved[item.projectId]) ? (saved[item.projectId] as unknown[]) : []
    result[item.projectId] = [...new Set(list.filter((id): id is string => typeof id === 'string' && items[id]?.projectId === item.projectId))]
  }
  for (const item of Object.values(items)) if (!result[item.projectId].includes(item.id)) result[item.projectId].push(item.id)
  return result
}

function parseLayout(raw: unknown): LayoutNode | null {
  if (!isRecord(raw)) return null
  if (raw.type === 'pane') return typeof raw.id === 'string' ? pane(raw.id) : null
  if (raw.type !== 'split' || (raw.direction !== 'row' && raw.direction !== 'column')) return null
  if (!Array.isArray(raw.children) || !Array.isArray(raw.sizes) || raw.children.length !== raw.sizes.length || raw.children.length < 2) return null
  const children = raw.children.map(parseLayout)
  const sizes = raw.sizes.map((size) => (typeof size === 'number' && size > 0 ? size : 0))
  if (children.some((child) => !child) || sizes.some((size) => size === 0)) return null
  const total = sizes.reduce((a, b) => a + b, 0)
  return { type: 'split', direction: raw.direction, children: children as LayoutNode[], sizes: sizes.map((size) => size / total) }
}

/** Saved order first, then anything opened before the restore finished. */
function mergeOrders(saved: Record<string, string[]>, current: Record<string, string[]>): Record<string, string[]> {
  const result = { ...saved }
  for (const [key, ids] of Object.entries(current)) result[key] = [...new Set([...(saved[key] ?? []), ...ids])]
  return result
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
