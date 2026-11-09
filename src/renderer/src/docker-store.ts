import { create } from 'zustand'
import type { DockerAction, DockerContainer, DockerListResult } from '@shared/types'

interface DockerStoreState {
  /** Undefined until the first read. */
  result: DockerListResult | undefined
  /** Action in flight per container id. */
  busy: Record<string, DockerAction>
  /** Last failed action, shown above the list until dismissed. */
  actionError: string | null
  refreshing: boolean
  refresh(): Promise<void>
  act(id: string, action: DockerAction): Promise<void>
  dismissError(): void
}

let inFlight: Promise<void> | null = null
let lastJson = ''

export const useDocker = create<DockerStoreState>((set, get) => ({
  result: undefined,
  busy: {},
  actionError: null,
  refreshing: false,

  refresh() {
    inFlight ??= (async () => {
      set({ refreshing: true })
      try {
        const result = await window.capitaine.docker.list()
        const json = JSON.stringify(result)
        // Polled every few seconds: keep the same object when nothing changed.
        if (json !== lastJson) {
          lastJson = json
          set({ result })
        }
      } catch (error) {
        set({ result: { ok: false, reason: 'daemon', message: error instanceof Error ? error.message : String(error) } })
        lastJson = ''
      } finally {
        set({ refreshing: false })
        inFlight = null
      }
    })()
    return inFlight
  },

  async act(id, action) {
    if (get().busy[id]) return
    set((s) => ({ busy: { ...s.busy, [id]: action }, actionError: null }))
    try {
      await window.capitaine.docker.action(id, action)
    } catch (error) {
      set({ actionError: cleanIpcError(error) })
    } finally {
      set((s) => {
        const busy = { ...s.busy }
        delete busy[id]
        return { busy }
      })
      void get().refresh()
    }
  },

  dismissError() {
    set({ actionError: null })
  }
}))

/** Electron prefixes errors thrown in a handler with `Error invoking remote method '…': Error: `. */
export function cleanIpcError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}

/** Whether a container belongs to the project: its compose folder is the project or inside it. */
export function belongsTo(container: DockerContainer, projectPath: string): boolean {
  if (!container.composeDir) return false
  const caseless = window.capitaine.platform !== 'linux'
  const norm = (p: string) => {
    const clean = p.replace(/\\/g, '/').replace(/\/+$/, '')
    return caseless ? clean.toLowerCase() : clean
  }
  const dir = norm(container.composeDir)
  const root = norm(projectPath)
  return dir === root || dir.startsWith(`${root}/`)
}
