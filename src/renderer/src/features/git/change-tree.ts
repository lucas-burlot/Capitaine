import { create } from 'zustand'
import type { GitChange } from '@shared/types'

export interface ChangeFolder {
  kind: 'folder'
  /** Shown name; folders holding a single folder are merged into one row (`src/renderer/src`). */
  name: string
  /** Repo-relative path of the deepest merged folder. */
  path: string
  children: ChangeNode[]
  /** Every change below this folder, at any depth. */
  changes: GitChange[]
}

export interface ChangeFile {
  kind: 'file'
  change: GitChange
}

export type ChangeNode = ChangeFolder | ChangeFile

interface Dir {
  dirs: Map<string, Dir>
  files: GitChange[]
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

const baseName = (path: string) => path.slice(path.lastIndexOf('/') + 1)

/** Groups changes by folder: folders first, then files, each sorted by name. */
export function buildChangeTree(changes: GitChange[]): ChangeNode[] {
  const root: Dir = { dirs: new Map(), files: [] }
  for (const change of changes) {
    const parts = change.path.split('/')
    parts.pop()
    let dir = root
    for (const part of parts) {
      let next = dir.dirs.get(part)
      if (!next) {
        next = { dirs: new Map(), files: [] }
        dir.dirs.set(part, next)
      }
      dir = next
    }
    dir.files.push(change)
  }
  return convert(root, '')
}

function convert(dir: Dir, prefix: string): ChangeNode[] {
  const folders = [...dir.dirs.entries()]
    .sort(([a], [b]) => collator.compare(a, b))
    .map(([segment, sub]): ChangeFolder => {
      let name = segment
      let path = prefix ? `${prefix}/${segment}` : segment
      let current = sub
      while (current.files.length === 0 && current.dirs.size === 1) {
        const [[nextSegment, next]] = current.dirs
        name += `/${nextSegment}`
        path += `/${nextSegment}`
        current = next
      }
      const children = convert(current, path)
      return { kind: 'folder', name, path, children, changes: children.flatMap((c) => (c.kind === 'file' ? [c.change] : c.changes)) }
    })
  const files = [...dir.files]
    .sort((a, b) => collator.compare(baseName(a.path), baseName(b.path)))
    .map((change): ChangeFile => ({ kind: 'file', change }))
  return [...folders, ...files]
}

/** Every folder path of a tree, to collapse them all at once. */
export function folderPaths(nodes: ChangeNode[]): string[] {
  return nodes.flatMap((n) => (n.kind === 'folder' ? [n.path, ...folderPaths(n.children)] : []))
}

const MODE_KEY = 'capitaine.gitChangesView'

export type ChangeViewMode = 'tree' | 'list'

interface ChangeViewState {
  /** Changes grouped by folder, or the flat list. Remembered across launches. */
  mode: ChangeViewMode
  setMode(mode: ChangeViewMode): void
  /** Collapsed folders, keyed by `collapseKey`. Not remembered: folders open again on launch. */
  collapsed: Record<string, true>
  toggleFolder(key: string): void
  collapseAll(keys: string[]): void
}

export const collapseKey = (projectId: string, area: string, path: string) => `${projectId}:${area}:${path}`

function readMode(): ChangeViewMode {
  try {
    return localStorage.getItem(MODE_KEY) === 'list' ? 'list' : 'tree'
  } catch {
    return 'tree'
  }
}

export const useChangeView = create<ChangeViewState>((set) => ({
  mode: readMode(),
  setMode(mode) {
    try {
      localStorage.setItem(MODE_KEY, mode)
    } catch {
      // Not remembered; still applies for this session.
    }
    set({ mode })
  },
  collapsed: {},
  toggleFolder(key) {
    set((s) => {
      const collapsed = { ...s.collapsed }
      if (collapsed[key]) delete collapsed[key]
      else collapsed[key] = true
      return { collapsed }
    })
  },
  collapseAll(keys) {
    set((s) => ({ collapsed: { ...s.collapsed, ...Object.fromEntries(keys.map((k) => [k, true as const])) } }))
  }
}))
