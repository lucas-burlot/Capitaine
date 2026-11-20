import { create } from 'zustand'

/** A place to show in a file: 1-based line, and column when known. */
export interface FilePosition {
  line: number
  column?: number
}

interface RevealState {
  /** The last place asked for, until the file's editor shows it. */
  request: { path: string; position: FilePosition; id: number } | null
  ask(path: string, position: FilePosition): void
  done(id: number): void
}

let counter = 0

/**
 * Where an opened file should scroll to. `openFile` asks; the file's editor shows the place once its
 * file has loaded, or right away when it was already open.
 */
export const useReveal = create<RevealState>((set, get) => ({
  request: null,
  ask(path, position) {
    set({ request: { path, position, id: ++counter } })
  },
  done(id) {
    if (get().request?.id === id) set({ request: null })
  }
}))
