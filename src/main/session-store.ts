import { app } from 'electron'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { SavedAgent, SavedSession, SavedTerminal, SessionSaveInput } from '../shared/types'
import { findClaudeAgents, findClaudeAgentsSync, hasTranscript, sanitizeAgent } from './claude-sessions'
import type { PtyManager } from './pty-manager'

// A runaway scrollback (e.g. a huge `cat`) must not bloat the file read at every launch.
const MAX_SCROLLBACK_CHARS = 1_000_000

/**
 * Persists the open tabs and terminals (layout, current directory, screen contents) as JSON in
 * the per-user app data folder, so closing the app doesn't lose them. Shells themselves can't
 * outlive the app: they are started again, in the directory they were in, and the Claude sessions
 * that ran in them are resumed.
 */
export class SessionStore {
  private readonly file = join(app.getPath('userData'), 'session.json')
  // Bumped on every save so a slow async save never overwrites a newer one.
  private generation = 0

  constructor(private readonly ptys: PtyManager) {}

  load(): SavedSession | null {
    try {
      const data = JSON.parse(readFileSync(this.file, 'utf8')) as Partial<SavedSession>
      if (data.version !== 1 || typeof data.terminals !== 'object' || !data.terminals) return null
      for (const terminal of Object.values(data.terminals)) {
        if (terminal && typeof terminal === 'object') terminal.agent = resumableAgent(terminal.agent)
      }
      return data as SavedSession
    } catch {
      return null
    }
  }

  async save(input: SessionSaveInput): Promise<void> {
    const generation = ++this.generation
    const entries = Object.entries(input?.terminals ?? {})
    const [cwds, agents] = await Promise.all([
      Promise.all(entries.map(([, t]) => (typeof t?.ptyId === 'string' ? this.ptys.cwdOf(t.ptyId) : null))),
      findClaudeAgents(this.shellPids(input))
    ])
    if (generation !== this.generation) return
    this.write(input, (_, i) => cwds[i], agents)
  }

  saveSync(input: SessionSaveInput): void {
    ++this.generation
    const agents = findClaudeAgentsSync(this.shellPids(input))
    this.write(input, ([, t]) => (typeof t?.ptyId === 'string' ? this.ptys.cwdOfSync(t.ptyId) : null), agents)
  }

  /** Terminal id → pid of its live shell. */
  private shellPids(input: SessionSaveInput): Map<string, number> {
    const pids = new Map<string, number>()
    for (const [terminalId, terminal] of Object.entries(input?.terminals ?? {})) {
      const pid = typeof terminal?.ptyId === 'string' ? this.ptys.pidOf(terminal.ptyId) : null
      if (pid) pids.set(terminalId, pid)
    }
    return pids
  }

  private write(
    input: SessionSaveInput,
    cwdOf: (entry: [string, SessionSaveInput['terminals'][string]], index: number) => string | null,
    agents: Map<string, SavedAgent>
  ): void {
    const terminals: Record<string, SavedTerminal> = {}
    Object.entries(input?.terminals ?? {}).forEach((entry, i) => {
      const [terminalId, terminal] = entry
      const scrollback = typeof terminal?.scrollback === 'string' ? terminal.scrollback : ''
      const ptyId = typeof terminal?.ptyId === 'string' ? terminal.ptyId : null
      // Live shell: whatever Claude runs in it now. Otherwise the one still waiting to come back.
      const agent = ptyId ? (agents.get(terminalId) ?? this.ptys.relaunchedAgentOf(ptyId)) : sanitizeAgent(terminal?.agent)
      terminals[terminalId] = { cwd: cwdOf(entry, i), scrollback: trimScrollback(scrollback), agent }
    })
    const data: SavedSession = { version: 1, savedAt: Date.now(), workspace: input?.workspace ?? null, terminals }
    try {
      mkdirSync(app.getPath('userData'), { recursive: true })
      // Write-then-rename so a crash mid-write never corrupts the file.
      const tmp = `${this.file}.tmp`
      writeFileSync(tmp, JSON.stringify(data), 'utf8')
      renameSync(tmp, this.file)
    } catch (error) {
      console.error('[capitaine] failed to write session.json', error)
    }
  }
}

/** A saved Claude session as it can be relaunched now; one with no conversation on disk restarts fresh. */
function resumableAgent(raw: unknown): SavedAgent | null {
  const agent = sanitizeAgent(raw)
  if (agent?.sessionId && !hasTranscript(agent.sessionId)) return { ...agent, sessionId: null }
  return agent
}

/** Keeps the end of the scrollback, cut at a line start so no escape sequence is split. */
function trimScrollback(scrollback: string): string {
  if (scrollback.length <= MAX_SCROLLBACK_CHARS) return scrollback
  const tail = scrollback.slice(-MAX_SCROLLBACK_CHARS)
  const lineStart = tail.indexOf('\n')
  return lineStart === -1 ? '' : `\x1b[0m${tail.slice(lineStart + 1)}`
}
