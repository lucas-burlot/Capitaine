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
