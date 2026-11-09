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

/** What a Claude Code configuration file is. `memory`: CLAUDE.md and the files it imports. */
export type ClaudeConfigKind = 'skill' | 'agent' | 'command' | 'rule' | 'memory'

/** `user`: ~/.claude, for every project; `project`: the project's own files; `plugin`: shipped by an installed plugin. */
export type ClaudeConfigScope = 'user' | 'project' | 'plugin'

export interface ClaudeConfigItem {
  kind: ClaudeConfigKind
  scope: ClaudeConfigScope
  /** As Claude Code knows it (plugin items are namespaced `plugin:name`). */
  name: string
  description: string | null
  /** Absolute path of the Markdown file. */
  path: string
  /** Plugin that ships it, e.g. `code-review@claude-plugins-official`. */
  plugin: string | null
  /** The plugin is turned off in `enabledPlugins`. */
  disabled: boolean
  /** Rules only: the globs it is limited to (null: always loaded). */
  paths: string[] | null
  /** The other front matter fields (tools, model, argument-hint…). */
  meta: Record<string, string | string[]>
}

export interface ClaudeConfig {
  items: ClaudeConfigItem[]
  /** ~/.claude, or CLAUDE_CONFIG_DIR when set. */
  userDir: string
  /** The user's home, to shorten paths to `~/…`. */
  homeDir: string
}
