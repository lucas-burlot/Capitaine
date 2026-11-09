import type { SessionTerminalInput } from '@shared/types'
import { isTerminalFocused, useApp } from '@/features/workspace/workspace-store'

interface TerminalHandle {
  /** Types text as a paste (respects bracketed paste, so agents treat it as one input). */
  paste(text: string): void
  focus(): void
  /** Live shell and serialized screen, for saving the session. */
  snapshot(): SessionTerminalInput
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

export function snapshotTerminal(terminalId: string): SessionTerminalInput | null {
  try {
    return handles.get(terminalId)?.snapshot() ?? null
  } catch {
    return null
  }
}
