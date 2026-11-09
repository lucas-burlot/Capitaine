/** What a new terminal runs once its shell is ready. Kept out of the saved session: a restart opens a plain shell. */
interface TerminalStartup {
  /** Container name to open a shell in (`docker exec`). */
  dockerExec: string
}

const startups = new Map<string, TerminalStartup>()

export function setTerminalStartup(terminalId: string, startup: TerminalStartup): void {
  startups.set(terminalId, startup)
}

/** Read once, when the terminal creates its shell. */
export function takeTerminalStartup(terminalId: string): TerminalStartup | undefined {
  const startup = startups.get(terminalId)
  startups.delete(terminalId)
  return startup
}
