import { create } from 'zustand'
import type { ClaudeConfig } from '@shared/types'

interface ClaudeConfigState {
  /** Per project id; undefined until the first read. */
  config: Record<string, ClaudeConfig>
  error: Record<string, string | null>
  refreshing: Record<string, boolean>
  refresh(projectId: string): Promise<void>
}

const inFlight = new Map<string, Promise<void>>()
const lastJson = new Map<string, string>()

/** Skills, agents, commands, rules and CLAUDE.md files that apply to each project. */
export const useClaudeConfig = create<ClaudeConfigState>((set) => ({
  config: {},
  error: {},
  refreshing: {},

  refresh(projectId) {
    let pending = inFlight.get(projectId)
    if (pending) return pending
    pending = (async () => {
      set((s) => ({ refreshing: { ...s.refreshing, [projectId]: true } }))
      try {
        const config = await window.capitaine.claude.config(projectId)
        const json = JSON.stringify(config)
        // Polled: keep the same object when nothing changed, so the list doesn't re-render.
        if (json !== lastJson.get(projectId)) {
          lastJson.set(projectId, json)
          set((s) => ({ config: { ...s.config, [projectId]: config } }))
        }
        set((s) => ({ error: { ...s.error, [projectId]: null } }))
      } catch (error) {
        set((s) => ({ error: { ...s.error, [projectId]: error instanceof Error ? error.message : String(error) } }))
      } finally {
        inFlight.delete(projectId)
        set((s) => ({ refreshing: { ...s.refreshing, [projectId]: false } }))
      }
    })()
    inFlight.set(projectId, pending)
    return pending
  }
}))
