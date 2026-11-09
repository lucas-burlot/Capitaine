export type GitFileStatus = 'modified' | 'added' | 'deleted' | 'renamed' | 'untracked' | 'ignored' | 'conflict'

export interface GitStatus {
  /** Keyed by project-relative `/` path; directories reported whole end with `/`. */
  files: Record<string, GitFileStatus>
}

export type GitChangeKind = 'modified' | 'added' | 'deleted' | 'renamed' | 'copied' | 'type-changed' | 'untracked' | 'conflict'

export interface GitChange {
  /** Repo-relative, `/`-separated. */
  path: string
  origPath?: string
  kind: GitChangeKind
  /** Line counts; null for binary or untracked files. */
  added: number | null
  removed: number | null
  /**
   * Conflicts only: git's two-letter code (`UU` both modified, `AA` both added, `UD` deleted by
   * them, `DU` deleted by us…). Only `UU`/`AA` leave conflict markers in the file.
   */
  conflictCode?: string
}

/** A multi-step git operation left half-way, usually by conflicts. */
export type RepoOperation = 'merge' | 'rebase' | 'cherry-pick' | 'revert'

export interface RepoStatus {
  repoRoot: string
  /** Null when HEAD is detached. */
  branch: string | null
  detached: boolean
  upstream: string | null
  ahead: number
  behind: number
  staged: GitChange[]
  unstaged: GitChange[]
  conflicts: GitChange[]
  /** More changes than the lists show. */
  truncated: boolean
  stashCount: number
  /** Merge / rebase / cherry-pick / revert in progress. */
  operation: RepoOperation | null
  /** Human description of that operation ("Merge branch 'x' into main"). */
  operationLabel: string | null
  /** The repo has at least one remote (push / pull make sense). */
  hasRemote: boolean
}

/** A local or remote-tracking branch, for the branch picker. */
export interface GitBranch {
  /** Short name: `main`, `origin/feature`. */
  name: string
  remote: boolean
  current: boolean
  upstream: string | null
  ahead: number
  behind: number
  /** Epoch ms of the tip commit. */
  updatedAt: number
  subject: string
}

/** What a commit / push / pull / sync did, for the confirmation line. */
export interface GitActionResult {
  message: string
  /** The action stopped on conflicts (pull, continue…): the status now lists them. */
  conflicts?: boolean
}

export type CommitFollowUp = 'none' | 'push' | 'sync'

export interface CommitOptions {
  message: string
  /** Nothing staged: stage every change first (VS Code's "smart commit"). */
  all: boolean
  amend?: boolean
}

export interface StashOptions {
  message: string
  /** `git stash -u`: new files go into the stash too. */
  includeUntracked: boolean
  /** `git stash --staged`: only what is staged (git 2.35+). */
  stagedOnly: boolean
  /** Only these repo-relative paths (the rest of the changes stay). */
  paths?: string[]
}

/** An AI-proposed resolution of one conflicted file, waiting for review. */
export interface ConflictResolution {
  path: string
  content: string
  /** One or two sentences on what was kept from each side. */
  explanation: string
}

export interface GitStash {
  /** `stash@{n}` */
  ref: string
  hash: string
  createdAt: number
  branch: string | null
  message: string
}

export interface GitStashFile {
  path: string
  origPath?: string
  kind: GitChangeKind
  /** Kept in the stash's untracked-files commit (`git stash -u`). */
  untracked: boolean
}

/** Where one side of a diff comes from. Paths are repo-relative. */
export type DiffSide =
  | { source: 'worktree'; path: string }
  | { source: 'head'; path: string }
  | { source: 'index'; path: string }
  | { source: 'stash'; ref: string; part: 'base' | 'stash' | 'untracked'; path: string }
  /** An AI conflict resolution held by the renderer until accepted (never read from git). */
  | { source: 'resolution'; path: string }

export type BlobContent = { kind: 'text'; content: string } | { kind: 'missing' } | { kind: 'binary' }

/** Lightweight per-project git summary for the sidebar. */
export interface BranchInfo {
  branch: string | null
  detached: boolean
  upstream: string | null
  ahead: number
  behind: number
  /** Changed + untracked files (ignored excluded). */
  changes: number
}
