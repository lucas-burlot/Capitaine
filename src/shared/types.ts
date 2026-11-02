export interface Project {
  id: string
  name: string
  path: string
  createdAt: number
}

export interface PtyCreateOptions {
  cwd: string
  cols: number
  rows: number
}

export interface PtyCreateResult {
  id: string
  /** Foreground process name at spawn, i.e. the shell (`zsh`, `bash`…). */
  shell: string
}

export interface DirEntry {
  name: string
  /** Absolute path. */
  path: string
  /** Path from the project root, always `/`-separated. */
  relPath: string
  isDirectory: boolean
  isSymlink: boolean
}

export type FileContent =
  | { kind: 'text'; content: string; mtimeMs: number }
  | { kind: 'binary'; size: number }
  | { kind: 'too-large'; size: number }
  | { kind: 'missing' }

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
}

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

export type BlobContent = { kind: 'text'; content: string } | { kind: 'missing' } | { kind: 'binary' }

export type MenuCommand =
  | 'new-terminal'
  | 'close-terminal'
  | 'next-terminal'
  | 'prev-terminal'
  | 'split-right'
  | 'split-down'
  | 'next-pane'
  | 'prev-pane'
  | 'add-project'
  | 'toggle-explorer'

/** API exposed to the renderer by the preload script as `window.capitaine`. */
export interface CapitaineApi {
  platform: NodeJS.Platform
  projects: {
    list(): Promise<Project[]>
    add(): Promise<Project | null>
    rename(id: string, name: string): Promise<Project[]>
    remove(id: string): Promise<Project[]>
    reorder(ids: string[]): Promise<Project[]>
    reveal(id: string): Promise<void>
  }
  pty: {
    create(options: PtyCreateOptions): Promise<PtyCreateResult>
    write(id: string, data: string): void
    resize(id: string, cols: number, rows: number): void
    kill(id: string): void
    onData(listener: (id: string, data: string) => void): () => void
    onExit(listener: (id: string, exitCode: number) => void): () => void
    /** Fires when the terminal's foreground process changes (macOS/Linux only). */
    onProcess(listener: (id: string, processName: string) => void): () => void
  }
  files: {
    list(projectId: string, dir: string): Promise<DirEntry[]>
    watch(projectId: string, dir: string): void
    unwatch(dir: string): void
    onChanged(listener: (dir: string) => void): () => void
    gitStatus(projectId: string): Promise<GitStatus | null>
    read(projectId: string, path: string): Promise<FileContent>
    /** Resolves with the new modification time. */
    write(projectId: string, path: string, content: string): Promise<number>
    /** Opens with the OS default application. */
    open(projectId: string, path: string): Promise<void>
    reveal(projectId: string, path: string): void
    copyText(text: string): void
    /** Absolute path of a file dropped from the OS (Electron hides `File.path`). */
    pathForFile(file: File): string
  }
  git: {
    status(projectId: string): Promise<RepoStatus | null>
    stage(projectId: string, paths: string[]): Promise<void>
    unstage(projectId: string, paths: string[]): Promise<void>
    stashes(projectId: string): Promise<GitStash[]>
    stashFiles(projectId: string, ref: string): Promise<GitStashFile[]>
    show(projectId: string, side: DiffSide): Promise<BlobContent>
  }
  focusWindow(): void
  /** The renderer settled unsaved changes; finish the close (or quit) it had vetoed. */
  confirmClose(): void
  cancelClose(): void
  onMenuCommand(listener: (command: MenuCommand) => void): () => void
}
