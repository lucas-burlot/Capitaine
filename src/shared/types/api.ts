import type { Project } from './projects'
import type { PtyCreateOptions, PtyCreateResult, SessionSaveInput, SavedSession } from './terminals'
import type { DirEntry, FileContent } from './files'
import type {
  BlobContent,
  BranchInfo,
  CommitOptions,
  ConflictResolution,
  DiffSide,
  GitActionResult,
  GitBranch,
  GitStash,
  GitStashFile,
  GitStatus,
  RepoStatus,
  StashOptions
} from './git'
import type { ClaudeUsage } from './claude'
import type { UpdateState } from './updater'
import type { DockerListResult, DockerAction } from './docker'

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
  docker: {
    /** Every container on the machine, stopped ones included. */
    list(): Promise<DockerListResult>
    /** Rejects with docker's error message. */
    action(id: string, action: DockerAction): Promise<void>
    /** The last lines the container wrote (stdout and stderr). */
    logs(id: string, tail: number): Promise<string>
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
