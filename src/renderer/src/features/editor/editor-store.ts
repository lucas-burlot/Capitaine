import { create } from 'zustand'
import { fileName, useApp } from '@/features/workspace/workspace-store'

export type EditorStatus = 'loading' | 'ready' | 'binary' | 'too-large' | 'missing' | 'error'

export interface EditorMeta {
  status: EditorStatus
  dirty: boolean
  /** The file changed on disk while you had unsaved edits, or was deleted. */
  external: 'changed' | 'deleted' | null
  /** Set when the editor silently picked up an outside change (e.g. an agent's edit). */
  reloadedAt: number | null
  error: string | null
}

interface CloseRequest {
  tabIds: string[]
  /** `window`: the app/window is closing; `tab`: a single tab is closing. */
  reason: 'tab' | 'window'
  error: string | null
  saving: boolean
}

interface EditorState {
  meta: Record<string, EditorMeta>
  closeRequest: CloseRequest | null
  setMeta(tabId: string, patch: Partial<EditorMeta>): void
  removeMeta(tabId: string): void
  /** Closes the tab, asking first when it has unsaved changes. */
  requestClose(tabId: string): void
  resolveClose(choice: 'save' | 'discard' | 'cancel'): Promise<void>
}

const EMPTY: EditorMeta = { status: 'loading', dirty: false, external: null, reloadedAt: null, error: null }

// Sessions live in the Monaco chunk; it's always loaded once an editor exists.
const sessions = () => import('./editor-sessions')

export const useEditors = create<EditorState>((set, get) => ({
  meta: {},
  closeRequest: null,

  setMeta(tabId, patch) {
    set((s) => ({ meta: { ...s.meta, [tabId]: { ...(s.meta[tabId] ?? EMPTY), ...patch } } }))
  },

  removeMeta(tabId) {
    set((s) => {
      if (!s.meta[tabId]) return s
      const meta = { ...s.meta }
      delete meta[tabId]
      return { meta }
    })
  },

  requestClose(tabId) {
    if (!get().meta[tabId]?.dirty) {
      useApp.getState().closeTab(tabId)
      return
    }
    useApp.getState().selectTab(tabId)
    set({ closeRequest: { tabIds: [tabId], reason: 'tab', error: null, saving: false } })
  },

  async resolveClose(choice) {
    const request = get().closeRequest
    if (!request) return
    if (choice === 'cancel') {
      set({ closeRequest: null })
      if (request.reason === 'window') window.capitaine.cancelClose()
      return
    }
    if (choice === 'save') {
      set({ closeRequest: { ...request, saving: true, error: null } })
      try {
        const { saveSession } = await sessions()
        for (const tabId of request.tabIds) await saveSession(tabId)
      } catch (error) {
        set({ closeRequest: { ...request, saving: false, error: error instanceof Error ? error.message : String(error) } })
        return
      }
    }
    set({ closeRequest: null })
    if (request.reason === 'tab') {
      for (const tabId of request.tabIds) useApp.getState().closeTab(tabId)
      return
    }
    allowUnload = true
    window.capitaine.confirmClose()
  }
}))

export function dirtyEditorIds(): string[] {
  return Object.entries(useEditors.getState().meta)
    .filter(([, m]) => m.dirty)
    .map(([id]) => id)
}

export function editorFileLabel(tabId: string): string {
  const path = useApp.getState().tabs[tabId]?.filePath
  return path ? fileName(path) : 'fichier'
}

// Closing the window (or quitting) with unsaved files: veto it and ask first.
let allowUnload = false
window.addEventListener('beforeunload', (event) => {
  if (allowUnload) return
  const dirty = dirtyEditorIds()
  if (dirty.length === 0) return
  event.preventDefault()
  event.returnValue = ''
  useEditors.setState({ closeRequest: { tabIds: dirty, reason: 'window', error: null, saving: false } })
})
