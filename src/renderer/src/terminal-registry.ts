import { isTerminalFocused, useApp } from './store'

interface TerminalHandle {
  /** Types text as a paste (respects bracketed paste, so agents treat it as one input). */
  paste(text: string): void
  focus(): void
}

const handles = new Map<string, TerminalHandle>()

export function registerTerminal(terminalId: string, handle: TerminalHandle): () => void {
  handles.set(terminalId, handle)
  return () => {
    if (handles.get(terminalId) === handle) handles.delete(terminalId)
  }
}

export function pasteIntoTerminal(terminalId: string, text: string): boolean {
  const handle = handles.get(terminalId)
  if (!handle) return false
  handle.paste(text)
  handle.focus()
  return true
}

/** The terminal that has keyboard focus in the active project, if any. */
export function focusedTerminalId(): string | null {
  const state = useApp.getState()
  const projectId = state.activeProjectId
  const tabId = projectId ? state.activeTabByProject[projectId] : null
  const paneId = tabId ? state.tabs[tabId]?.activePaneId : null
  return paneId && isTerminalFocused(state, paneId) ? paneId : null
}
