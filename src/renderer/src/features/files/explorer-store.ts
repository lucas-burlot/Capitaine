import { create } from 'zustand'
import type { DirEntry, GitFileStatus, GitStatus } from '@shared/types'
import { usePanels } from '@/app/panels-store'
import { useEditors } from '@/features/editor/editor-store'
import { fileName, isUnder, movedPath, useApp } from '@/features/workspace/workspace-store'

/** A name being typed in the tree: a new entry in `dir`, or a new name for `path`. */
export type ExplorerEdit = { mode: 'create'; dir: string; kind: 'file' | 'directory' } | { mode: 'rename'; path: string }

interface ExplorerState {
  /** Expanded directories (absolute paths) per project. The root is always shown. */
  expanded: Record<string, string[]>
  /** Directory listings by absolute path. */
  children: Record<string, DirEntry[]>
  errors: Record<string, string>
  selected: Record<string, string | null>
  git: Record<string, GitStatus | null>
  editing: Record<string, ExplorerEdit | null>
  /** Why the last file operation failed, shown a few seconds above the tree. */
  notice: Record<string, string | null>

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

  startCreate(projectId: string, root: string, dir: string, kind: 'file' | 'directory'): void
  startRename(projectId: string, path: string): void
  cancelEdit(projectId: string): void
  create(projectId: string, dir: string, name: string, kind: 'file' | 'directory'): Promise<void>
  rename(projectId: string, path: string, name: string): Promise<void>
  duplicate(projectId: string, path: string): Promise<void>
  /**
   * To the system trash, or for good when `permanently`; editor tabs of what it held close (unless
   * they have unsaved changes). Resolves with the error, null once done.
   */
  remove(projectId: string, path: string, permanently: boolean): Promise<string | null>
  setNotice(projectId: string, text: string | null): void
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
    if (path === dir || isUnder(path, dir)) {
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
  editing: {},
  notice: {},

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
        for (const path of Object.keys(children)) if (path === dir || isUnder(path, dir)) delete children[path]
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
  },

  startCreate(projectId, root, dir, kind) {
    if (dir !== root && !(get().expanded[projectId] ?? []).includes(dir)) get().toggleDir(projectId, dir)
    set((s) => ({ editing: { ...s.editing, [projectId]: { mode: 'create', dir, kind } } }))
  },

  startRename(projectId, path) {
    set((s) => ({ editing: { ...s.editing, [projectId]: { mode: 'rename', path } } }))
  },

  cancelEdit(projectId) {
    set((s) => ({ editing: { ...s.editing, [projectId]: null } }))
  },

  async create(projectId, dir, name, kind) {
    get().cancelEdit(projectId)
    if (!name.trim()) return
    try {
      const path = await window.capitaine.files.create(projectId, dir, name, kind)
      await get().loadDir(projectId, dir)
      get().select(projectId, path)
      if (kind === 'file') useApp.getState().openFile(projectId, path)
    } catch (error) {
      get().setNotice(projectId, errorText(error))
    }
  },

  async rename(projectId, path, name) {
    get().cancelEdit(projectId)
    if (!name.trim() || name.trim() === fileName(path)) return
    // Its tab would reopen on the new path and lose what isn't saved.
    const unsaved = editorTabsUnder(path).filter((tab) => useEditors.getState().meta[tab.id]?.dirty)
    if (unsaved.length > 0) {
      get().setNotice(projectId, `Enregistre ou ferme « ${fileName(unsaved[0].filePath ?? '')} » avant de renommer.`)
      return
    }
    try {
      const target = await window.capitaine.files.rename(projectId, path, name)
      unwatchUnder(path)
      set((s) => {
        const expanded = (s.expanded[projectId] ?? []).map((dir) => movedPath(dir, path, target) ?? dir)
        const children = { ...s.children }
        for (const key of Object.keys(children)) if (key === path || isUnder(key, path)) delete children[key]
        return { expanded: { ...s.expanded, [projectId]: expanded }, children }
      })
      useApp.getState().moveFiles(path, target)
      await get().loadDir(projectId, parentOf(path))
      for (const dir of get().expanded[projectId] ?? []) if (dir === target || isUnder(dir, target)) void get().loadDir(projectId, dir)
      get().select(projectId, target)
    } catch (error) {
      get().setNotice(projectId, errorText(error))
    }
  },

  async duplicate(projectId, path) {
    try {
      const copy = await window.capitaine.files.duplicate(projectId, path)
      await get().loadDir(projectId, parentOf(path))
      get().select(projectId, copy)
    } catch (error) {
      get().setNotice(projectId, errorText(error))
    }
  },

  async remove(projectId, path, permanently) {
    try {
      if (permanently) await window.capitaine.files.delete(projectId, path)
      else await window.capitaine.files.trash(projectId, path)
    } catch (error) {
      return errorText(error)
    }
    for (const tab of editorTabsUnder(path)) if (!useEditors.getState().meta[tab.id]?.dirty) useApp.getState().closeTab(tab.id)
    unwatchUnder(path)
    set((s) => {
      const children = { ...s.children }
      for (const key of Object.keys(children)) if (key === path || isUnder(key, path)) delete children[key]
      const expanded = (s.expanded[projectId] ?? []).filter((dir) => dir !== path && !isUnder(dir, path))
      return { children, expanded: { ...s.expanded, [projectId]: expanded }, selected: { ...s.selected, [projectId]: null } }
    })
    await get().loadDir(projectId, parentOf(path))
    return null
  },

  setNotice(projectId, text) {
    clearTimeout(noticeTimers.get(projectId))
    set((s) => ({ notice: { ...s.notice, [projectId]: text } }))
    if (text) noticeTimers.set(projectId, setTimeout(() => get().setNotice(projectId, null), 6000))
  }
}))

const noticeTimers = new Map<string, ReturnType<typeof setTimeout>>()

function errorText(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  // IPC errors arrive as "Error invoking remote method 'files:rename': Error: <the message>".
  return message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}

function parentOf(path: string): string {
  const cut = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return cut > 0 ? path.slice(0, cut) : path
}

/** Editor tabs showing `path` or a file inside it. */
function editorTabsUnder(path: string) {
  return Object.values(useApp.getState().tabs).filter((tab) => tab.kind === 'editor' && tab.filePath && (tab.filePath === path || isUnder(tab.filePath, path)))
}

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
