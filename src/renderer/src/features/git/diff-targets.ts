import type { GitChange, GitStash, GitStashFile } from '@shared/types'
import type { DiffTarget } from '@/features/workspace/workspace-store'

/** Diff of a change in the working tree: index → disk for unstaged, HEAD → index for staged. */
export function changeDiff(repoRoot: string, change: GitChange, area: 'unstaged' | 'staged' | 'conflict'): DiffTarget {
  const { path } = change
  const base = { key: `${area}::${path}`, area, path, repoRoot, stashRef: null }
  if (area === 'staged') {
    return { ...base, original: { source: 'head', path: change.origPath ?? path }, modified: { source: 'index', path } }
  }
  if (area === 'conflict') {
    // The working copy holds the conflict markers to resolve.
    return { ...base, original: { source: 'head', path }, modified: { source: 'worktree', path } }
  }
  return { ...base, original: { source: 'index', path }, modified: { source: 'worktree', path } }
}

/** Diff of a file inside a stash, against the commit the stash was made on. */
export function stashFileDiff(repoRoot: string, stash: GitStash, file: GitStashFile): DiffTarget {
  return {
    key: `stash:${stash.hash}:${file.path}`,
    area: 'stash',
    path: file.path,
    repoRoot,
    stashRef: stash.ref,
    original: { source: 'stash', ref: stash.ref, part: 'base', path: file.origPath ?? file.path },
    modified: { source: 'stash', ref: stash.ref, part: file.untracked ? 'untracked' : 'stash', path: file.path }
  }
}

/** Absolute path of a repo-relative path, with the repo root's own separator. */
export function repoAbsolutePath(repoRoot: string, path: string): string {
  const sep = repoRoot.includes('\\') ? '\\' : '/'
  return `${repoRoot}${sep}${sep === '\\' ? path.replace(/\//g, '\\') : path}`
}

/** Review of an AI conflict resolution: the file as it is (with markers) → the proposal. */
export function resolutionDiff(repoRoot: string, path: string): DiffTarget {
  return {
    key: `resolution::${path}`,
    area: 'resolution',
    path,
    repoRoot,
    stashRef: null,
    original: { source: 'worktree', path },
    modified: { source: 'resolution', path }
  }
}
