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
