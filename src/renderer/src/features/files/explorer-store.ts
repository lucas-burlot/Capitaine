import { create } from 'zustand'
import type { DirEntry, GitFileStatus, GitStatus } from '@shared/types'
import { usePanels } from '@/app/panels-store'

interface ExplorerState {
  /** Expanded directories (absolute paths) per project. The root is always shown. */
  expanded: Record<string, string[]>
  /** Directory listings by absolute path. */
  children: Record<string, DirEntry[]>
  errors: Record<string, string>
  selected: Record<string, string | null>
  git: Record<string, GitStatus | null>

  /** Bumped to put the keyboard in the file search. */
  searchFocusRequest: number
  /** Opens the files view and focuses its search field. */
  focusSearch(): void
  loadDir(projectId: string, dir: string): Promise<void>
  toggleDir(projectId: string, dir: string): void
  collapseAll(projectId: string, root: string): void
  select(projectId: string, path: string | null): void
  refreshGit(projectId: string): Promise<void>
  refreshAll(projectId: string, root: string): void
}

// Which project owns a watched directory, so fs:changed events can be routed.
const watched = new Map<string, string>()

function watchDir(projectId: string, dir: string) {
  if (watched.has(dir)) return
  watched.set(dir, projectId)
  window.capitaine.files.watch(projectId, dir)
}

function unwatchUnder(dir: string) {
  for (const path of [...watched.keys()]) {
    if (path === dir || path.startsWith(dir + '/') || path.startsWith(dir + '\\')) {
      watched.delete(path)
      window.capitaine.files.unwatch(path)
    }
  }
}

export const useExplorer = create<ExplorerState>((set, get) => ({
  expanded: {},
  children: {},
  errors: {},
  selected: {},
  git: {},

  searchFocusRequest: 0,

  focusSearch() {
    usePanels.getState().showView('files')
    set((s) => ({ searchFocusRequest: s.searchFocusRequest + 1 }))
  },

  async loadDir(projectId, dir) {
    try {
      const entries = await window.capitaine.files.list(projectId, dir)
      set((s) => {
        const errors = { ...s.errors }
        delete errors[dir]
        return { children: { ...s.children, [dir]: entries }, errors }
      })
      watchDir(projectId, dir)
    } catch (error) {
      set((s) => ({ errors: { ...s.errors, [dir]: error instanceof Error ? error.message : String(error) } }))
    }
  },

  toggleDir(projectId, dir) {
    const current = get().expanded[projectId] ?? []
    if (current.includes(dir)) {
      set((s) => ({ expanded: { ...s.expanded, [projectId]: current.filter((d) => d !== dir) } }))
      unwatchUnder(dir)
      // Re-read on next expand: the cached listing may be stale once unwatched.
      set((s) => {
        const children = { ...s.children }
        for (const path of Object.keys(children)) if (path === dir || path.startsWith(dir + '/') || path.startsWith(dir + '\\')) delete children[path]
        return { children }
      })
      return
    }
    set((s) => ({ expanded: { ...s.expanded, [projectId]: [...current, dir] } }))
    void get().loadDir(projectId, dir)
  },

  collapseAll(projectId, root) {
    for (const dir of get().expanded[projectId] ?? []) unwatchUnder(dir)
    set((s) => ({ expanded: { ...s.expanded, [projectId]: [] } }))
    void get().loadDir(projectId, root)
  },

  select(projectId, path) {
    set((s) => ({ selected: { ...s.selected, [projectId]: path } }))
  },

  async refreshGit(projectId) {
    const status = await window.capitaine.files.gitStatus(projectId).catch(() => null)
    set((s) => (sameStatus(s.git[projectId], status) ? s : { git: { ...s.git, [projectId]: status } }))
  },

  refreshAll(projectId, root) {
    void get().loadDir(projectId, root)
    for (const dir of get().expanded[projectId] ?? []) void get().loadDir(projectId, dir)
    void get().refreshGit(projectId)
  }
}))

function sameStatus(a: GitStatus | null | undefined, b: GitStatus | null): boolean {
  if (!a || !b) return a === b
  const ka = Object.keys(a.files)
  return ka.length === Object.keys(b.files).length && ka.every((k) => a.files[k] === b.files[k])
}

// Live refresh: re-list the changed directory and re-read git status shortly after.
const gitTimers = new Map<string, ReturnType<typeof setTimeout>>()
window.capitaine.files.onChanged((dir) => {
  const projectId = watched.get(dir)
  if (!projectId) return
  void useExplorer.getState().loadDir(projectId, dir)
  clearTimeout(gitTimers.get(projectId))
  gitTimers.set(projectId, setTimeout(() => void useExplorer.getState().refreshGit(projectId), 400))
})

/** Status for a path, falling back to an ancestor reported whole (untracked/ignored folder). */
export function fileStatus(git: GitStatus | null | undefined, relPath: string): GitFileStatus | null {
  if (!git) return null
  const direct = git.files[relPath] ?? git.files[`${relPath}/`]
  if (direct) return direct
  let cursor = relPath
  while (cursor.includes('/')) {
    cursor = cursor.slice(0, cursor.lastIndexOf('/'))
    const inherited = git.files[`${cursor}/`]
    if (inherited === 'untracked' || inherited === 'ignored') return inherited
  }
  return null
}

/** Whether something under this folder changed (for the dot on collapsed folders). */
export function folderHasChanges(git: GitStatus | null | undefined, relPath: string): GitFileStatus | null {
  if (!git) return null
  const prefix = `${relPath}/`
  let found: GitFileStatus | null = null
  for (const [path, status] of Object.entries(git.files)) {
    if (status === 'ignored' || !path.startsWith(prefix) || path === prefix) continue
    if (status === 'conflict') return status
    found = found === 'modified' ? found : status
  }
  return found
}
