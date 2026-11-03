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
  /** Directory the shell was in last session; used instead of `cwd` when it still exists. */
  restoreCwd?: string
  /** Claude session to bring back: the shell starts in its folder and relaunches it once ready. */
  resumeAgent?: SavedAgent
}

/** A Claude Code session that was open in a terminal. */
export interface SavedAgent {
  /** Null when Claude was open but the conversation had no message yet: it reopens fresh. */
  sessionId: string | null
  /** Where Claude ran; its conversations are stored per folder. */
  cwd: string
  /** Launch options carried over (permission mode, model, effort). */
  args: string[]
}

export interface PtyCreateResult {
  id: string
  /** Foreground process name at spawn, i.e. the shell (`zsh`, `bash`…). */
  shell: string
}

/** One terminal as the renderer hands it over when saving the session. */
export interface SessionTerminalInput {
  /** Live shell, so the main process can read its current directory. */
  ptyId: string | null
  /** Screen and scrollback, serialized as escape sequences. */
  scrollback: string
  /** Without a live shell: the Claude session still waiting to be relaunched, kept as is. */
  agent?: SavedAgent | null
}

export interface SessionSaveInput {
  /** Tabs, layouts and terminal metadata. Opaque here: the renderer owns (and validates) its shape. */
  workspace: unknown
  terminals: Record<string, SessionTerminalInput>
}

export interface SavedTerminal {
  cwd: string | null
  scrollback: string
  /** Claude session running in it when saved. */
  agent?: SavedAgent | null
}

/** What was open when the app last closed, so it can come back on the next launch. */
export interface SavedSession {
  version: 1
  savedAt: number
  workspace: unknown
  /** Keyed by terminal id. */
  terminals: Record<string, SavedTerminal>
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

export interface ClaudeUsageWindow {
  label: string
  usedPercent: number
  /** Epoch ms. */
  resetsAt: number | null
}

export interface ClaudeUsage {
  /** `expired`: Claude Code's login needs renewing (run `claude`); `no-credentials`: not logged in. */
  status: 'ok' | 'no-credentials' | 'expired' | 'rate-limited' | 'error'
  error: string | null
  session: ClaudeUsageWindow | null
  weekly: ClaudeUsageWindow | null
  weeklyByModel: ClaudeUsageWindow[]
  extraUsagePercent: number | null
  fetchedAt: number
}

export interface UpdateState {
  /**
   * `available`: a newer version exists (nothing downloaded yet); `ready`: downloaded, installs on
   * restart or quit; `unsupported`: dev mode or an install flavour that can't self-update.
   */
  status: 'idle' | 'unsupported' | 'checking' | 'up-to-date' | 'available' | 'downloading' | 'ready' | 'error'
  currentVersion: string
  /** The newer version on offer. */
  version: string | null
  /** Release highlights, one line each. */
  notes: string[]
  releaseUrl: string | null
  percent: number | null
  error: string | null
  /** The last check was asked by the user (so its outcome is worth showing). */
  manual: boolean
  /** Epoch ms of the last completed check. */
  checkedAt: number | null
  /** False on unsigned macOS builds: "download" opens the release page instead. */
  canSelfInstall: boolean
}

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
  | 'toggle-sidebar'
  | 'find-file'

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
  session: {
    load(): Promise<SavedSession | null>
    save(input: SessionSaveInput): void
    /** Blocks until written: for the moment the window unloads. */
    saveNow(input: SessionSaveInput): void
  }
  files: {
    list(projectId: string, dir: string): Promise<DirEntry[]>
    /** Every file of the project (project-relative, `/`-separated), minus git-ignored ones. */
    all(projectId: string): Promise<string[]>
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
    /** Null when the project isn't in a git repo. */
    branch(projectId: string): Promise<BranchInfo | null>
    branches(projectId: string): Promise<GitBranch[]>
    /** Local branch, or a remote one (a tracking local branch is created). */
    switchBranch(projectId: string, name: string): Promise<GitActionResult>
    /** `from`: branch to start from; HEAD when omitted. */
    createBranch(projectId: string, name: string, from?: string): Promise<GitActionResult>
    commit(projectId: string, options: CommitOptions): Promise<GitActionResult>
    push(projectId: string): Promise<GitActionResult>
    pull(projectId: string): Promise<GitActionResult>
    fetch(projectId: string): Promise<GitActionResult>
    /** Ends the merge / rebase in progress: `continue` once every conflict is staged, or `abort`. */
    finishOperation(projectId: string, how: 'continue' | 'abort'): Promise<GitActionResult>
    /** Resolves a conflict with one side entirely, and stages it. */
    takeSide(projectId: string, path: string, side: 'current' | 'incoming'): Promise<void>
    /** Writes a resolved file and stages it. */
    writeResolution(projectId: string, path: string, content: string): Promise<void>
    stashPush(projectId: string, options: StashOptions): Promise<GitActionResult>
    /** `hash` guards against `stash@{n}` having shifted since the list was read. `drop`: pop. */
    stashApply(projectId: string, ref: string, hash: string, drop: boolean): Promise<GitActionResult>
    stashDrop(projectId: string, ref: string, hash: string): Promise<GitActionResult>
    ai: {
      /** Commit message for the staged changes (all changes when `all`), written by Claude. */
      commitMessage(projectId: string, all: boolean): Promise<string>
      resolveConflict(projectId: string, path: string): Promise<ConflictResolution>
    }
  }
  claude: {
    /** `force`: the refresh button (still throttled to protect the rate-limited endpoint). */
    usage(force: boolean): Promise<ClaudeUsage>
  }
  window: {
    /** Linux/Windows draw their own title bar (logo, menu, window buttons). */
    customTitleBar: boolean
    minimize(): void
    toggleMaximize(): void
    close(): void
    isMaximized(): Promise<boolean>
    onMaximizedChange(listener: (maximized: boolean) => void): () => void
    /** Opens the application menu at a point of the window (the ⋯ button). */
    popupMenu(x: number, y: number): void
  }
  updater: {
    state(): Promise<UpdateState>
    check(): void
    /** Starts downloading the version on offer (never automatic). */
    download(): void
    /** Restart on the downloaded version. */
    install(): void
    openReleases(version?: string): void
    onState(listener: (state: UpdateState) => void): () => void
  }
  focusWindow(): void
  /** The renderer settled unsaved changes; finish the close (or quit) it had vetoed. */
  confirmClose(): void
  cancelClose(): void
  onMenuCommand(listener: (command: MenuCommand) => void): () => void
}
