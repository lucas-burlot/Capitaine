import { randomUUID } from 'node:crypto'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import type { WebContents } from 'electron'
import * as pty from 'node-pty'
import type { PtyCreateOptions, PtyCreateResult } from '../shared/types'
import { buildShellEnv, resolveDefaultShell } from './shell'

interface Session {
  process: pty.IPty
  owner: WebContents
  buffer: string
  flushTimer: NodeJS.Timeout | null
  foreground: string
}

// Coalesce bursts of output (e.g. `cat` on a big file) into fewer IPC messages.
const FLUSH_INTERVAL_MS = 4
// node-pty only knows the real foreground process on macOS/Linux; on Windows it is always the shell.
const PROCESS_POLL_MS = process.platform === 'win32' ? 0 : 1500

export class PtyManager {
  private readonly sessions = new Map<string, Session>()
  private pollTimer: NodeJS.Timeout | null = null

  create(owner: WebContents, options: PtyCreateOptions): PtyCreateResult {
    const shell = resolveDefaultShell()
    const cwd = existsSync(options.cwd) ? options.cwd : homedir()
    const id = randomUUID()

    const proc = pty.spawn(shell.file, shell.args, {
      name: 'xterm-256color',
      cols: Math.max(2, options.cols),
      rows: Math.max(1, options.rows),
      cwd,
      env: buildShellEnv()
    })

    const session: Session = { process: proc, owner, buffer: '', flushTimer: null, foreground: proc.process }
    this.sessions.set(id, session)
    this.ensurePolling()

    proc.onData((data) => {
      session.buffer += data
      if (!session.flushTimer) {
        session.flushTimer = setTimeout(() => this.flush(id), FLUSH_INTERVAL_MS)
      }
    })

    proc.onExit(({ exitCode }) => {
      this.flush(id)
      this.sessions.delete(id)
      if (!owner.isDestroyed()) owner.send('pty:exit', id, exitCode)
    })

    return { id, shell: proc.process }
  }

  write(id: string, data: string): void {
    this.sessions.get(id)?.process.write(data)
  }

  resize(id: string, cols: number, rows: number): void {
    const session = this.sessions.get(id)
    if (!session || cols < 2 || rows < 1) return
    try {
      session.process.resize(Math.floor(cols), Math.floor(rows))
    } catch {
      // The process may have exited between the check and the resize.
    }
  }

  kill(id: string): void {
    const session = this.sessions.get(id)
    if (!session) return
    this.sessions.delete(id)
    if (session.flushTimer) clearTimeout(session.flushTimer)
    try {
      session.process.kill()
    } catch {
      // Already gone.
    }
  }

  killAllFor(owner: WebContents): void {
    for (const [id, session] of this.sessions) {
      if (session.owner === owner) this.kill(id)
    }
  }

  killAll(): void {
    for (const id of [...this.sessions.keys()]) this.kill(id)
  }

  /** Lets the renderer notice an agent that exited without saying so (crash, kill -9). */
  private ensurePolling(): void {
    if (!PROCESS_POLL_MS || this.pollTimer) return
    this.pollTimer = setInterval(() => {
      if (this.sessions.size === 0) {
        clearInterval(this.pollTimer!)
        this.pollTimer = null
        return
      }
      for (const [id, session] of this.sessions) {
        let name: string
        try {
          name = session.process.process
        } catch {
          continue
        }
        if (name === session.foreground) continue
        session.foreground = name
        if (!session.owner.isDestroyed()) session.owner.send('pty:process', id, name)
      }
    }, PROCESS_POLL_MS)
  }

  private flush(id: string): void {
    const session = this.sessions.get(id)
    if (!session) return
    if (session.flushTimer) {
      clearTimeout(session.flushTimer)
      session.flushTimer = null
    }
    if (!session.buffer) return
    const data = session.buffer
    session.buffer = ''
    if (!session.owner.isDestroyed()) session.owner.send('pty:data', id, data)
  }
}
