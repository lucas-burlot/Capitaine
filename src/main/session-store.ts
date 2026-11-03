import { app } from 'electron'
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { SavedSession, SavedTerminal, SessionSaveInput } from '../shared/types'
import type { PtyManager } from './pty-manager'

// A runaway scrollback (e.g. a huge `cat`) must not bloat the file read at every launch.
const MAX_SCROLLBACK_CHARS = 1_000_000

/**
 * Persists the open tabs and terminals (layout, current directory, screen contents) as JSON in
 * the per-user app data folder, so closing the app doesn't lose them. Shells themselves can't
 * outlive the app: they are started again, in the directory they were in.
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
      return data as SavedSession
    } catch {
      return null
    }
  }

  async save(input: SessionSaveInput): Promise<void> {
    const generation = ++this.generation
    const entries = Object.entries(input?.terminals ?? {})
    const cwds = await Promise.all(entries.map(([, t]) => (typeof t?.ptyId === 'string' ? this.ptys.cwdOf(t.ptyId) : null)))
    if (generation !== this.generation) return
    this.write(input, (_, i) => cwds[i])
  }

  saveSync(input: SessionSaveInput): void {
    ++this.generation
    this.write(input, ([, t]) => (typeof t?.ptyId === 'string' ? this.ptys.cwdOfSync(t.ptyId) : null))
  }

  private write(input: SessionSaveInput, cwdOf: (entry: [string, SessionSaveInput['terminals'][string]], index: number) => string | null): void {
    const terminals: Record<string, SavedTerminal> = {}
    Object.entries(input?.terminals ?? {}).forEach((entry, i) => {
      const scrollback = typeof entry[1]?.scrollback === 'string' ? entry[1].scrollback : ''
      terminals[entry[0]] = { cwd: cwdOf(entry, i), scrollback: trimScrollback(scrollback) }
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

/** Keeps the end of the scrollback, cut at a line start so no escape sequence is split. */
function trimScrollback(scrollback: string): string {
  if (scrollback.length <= MAX_SCROLLBACK_CHARS) return scrollback
  const tail = scrollback.slice(-MAX_SCROLLBACK_CHARS)
  const lineStart = tail.indexOf('\n')
  return lineStart === -1 ? '' : `\x1b[0m${tail.slice(lineStart + 1)}`
}
