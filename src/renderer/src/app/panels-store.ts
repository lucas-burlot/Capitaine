import { create } from 'zustand'

const RIGHT_OPEN_KEY = 'capitaine.explorerOpen'
const RIGHT_VIEW_KEY = 'capitaine.rightPanelView'
const SIDEBAR_KEY = 'capitaine.sidebarOpen'

export type RightPanelView = 'files' | 'git' | 'docker'

/** Which side panels are shown, and what the right one shows. Remembered across launches. */
interface PanelsState {
  /** Left sidebar (projects) shown or collapsed. */
  sidebarOpen: boolean
  rightOpen: boolean
  rightView: RightPanelView
  toggleSidebar(): void
  toggleRight(): void
  /** Shows the right panel on that view (opening it if hidden). */
  showView(view: RightPanelView): void
}

function read(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value)
  } catch {
    // Not remembered; still applies for this session.
  }
}

function initialView(): RightPanelView {
  const view = read(RIGHT_VIEW_KEY)
  return view === 'git' || view === 'docker' ? view : 'files'
}

export const usePanels = create<PanelsState>((set, get) => ({
  sidebarOpen: read(SIDEBAR_KEY) !== '0',
  rightOpen: read(RIGHT_OPEN_KEY) !== '0',
  rightView: initialView(),

  toggleSidebar() {
    const sidebarOpen = !get().sidebarOpen
    write(SIDEBAR_KEY, sidebarOpen ? '1' : '0')
    set({ sidebarOpen })
  },

  toggleRight() {
    const rightOpen = !get().rightOpen
    write(RIGHT_OPEN_KEY, rightOpen ? '1' : '0')
    set({ rightOpen })
  },

  showView(view) {
    write(RIGHT_VIEW_KEY, view)
    write(RIGHT_OPEN_KEY, '1')
    set({ rightView: view, rightOpen: true })
  }
}))
