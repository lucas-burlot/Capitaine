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
