/** Who answers Claude's permission prompts, and how strictly (Claude Code's `--permission-mode`). */
export type ChatPermissionMode = 'default' | 'acceptEdits' | 'auto' | 'plan' | 'bypassPermissions' | 'dontAsk'

export interface ChatStartOptions {
  /** The pane the chat lives in. */
  chatId: string
  cwd: string
  /** Conversation to continue (`--resume`); null starts a new one. */
  sessionId: string | null
  /** Alias (`opus`, `sonnet`…) or full model id; null keeps Claude's default. */
  model: string | null
  permissionMode: ChatPermissionMode | null
  effort: string | null
}

/**
 * One line Claude Code wrote on stdout (stream-json), parsed. Opaque to the main process: the
 * renderer folds them into the conversation. `control_response`s are answered in the main process.
 */
export type ChatWireMessage = Record<string, unknown>

/** A control request to Claude (`initialize`, `interrupt`, `set_model`, `set_permission_mode`…). */
export interface ChatControlRequest {
  subtype: string
  [key: string]: unknown
}

/** What the renderer answers to a `can_use_tool` request. */
export type ChatPermissionResponse =
  | { behavior: 'allow'; updatedInput: Record<string, unknown>; updatedPermissions?: unknown[]; toolUseID?: string }
  | { behavior: 'deny'; message: string; interrupt?: boolean; toolUseID?: string }

export type ChatUserContent = Array<
  | { type: 'text'; text: string }
  | { type: 'image'; source: { type: 'base64'; media_type: string; data: string } }
>

/** The saved conversation, for a chat that reopens an existing session. */
export interface ChatHistory {
  /** Transcript records (user / assistant / system), oldest first, on the conversation's current branch. */
  records: ChatWireMessage[]
  /** Older records were left out. */
  truncated: boolean
}
