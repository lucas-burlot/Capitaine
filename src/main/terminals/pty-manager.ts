import { execFile, execFileSync } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { readlinkSync, statSync } from 'node:fs'
import { readlink } from 'node:fs/promises'
import { homedir } from 'node:os'
import type { WebContents } from 'electron'
import * as pty from 'node-pty'
import type { PtyCreateOptions, PtyCreateResult, SavedAgent } from '../../shared/types'
import { resumeCommand, sanitizeAgent } from '../claude/claude-sessions'
import { buildShellEnv, resolveDefaultShell } from '../system/shell'

interface Session {
  process: pty.IPty
  owner: WebContents
  buffer: string
  flushTimer: NodeJS.Timeout | null
  foreground: string
  /** Claude session typed at startup, until it has had time to register itself. */
  relaunched: { agent: SavedAgent; at: number; started: boolean } | null
  /** The shell's own process name. */
  shellName: string
}

// Coalesce bursts of output (e.g. `cat` on a big file) into fewer IPC messages.
const FLUSH_INTERVAL_MS = 4
// node-pty only knows the real foreground process on macOS/Linux; on Windows it is always the shell.
const PROCESS_POLL_MS = process.platform === 'win32' ? 0 : 1500
const SHELL_READY_POLL_MS = 150
// Fallback readiness when the terminal mode can't be read: startup output quiet for this long.
const SHELL_SETTLE_MS = 400
// Slow rc files (plugin managers…) get this long before the command is typed anyway.
const SHELL_READY_TIMEOUT_MS = 10_000
// How long a relaunched Claude counts as running before it shows up in its session file.
const RELAUNCH_GRACE_MS = 30_000

export class PtyManager {
  private readonly sessions = new Map<string, Session>()
  private pollTimer: NodeJS.Timeout | null = null

  create(owner: WebContents, options: PtyCreateOptions): PtyCreateResult {
    const shell = resolveDefaultShell()
    const agent = options.resumeAgent ? sanitizeAgent(options.resumeAgent) : null
    // Claude finds its conversation from the folder it is started in.
    const cwd = agent?.cwd ?? [options.restoreCwd, options.cwd].find((dir) => !!dir && isDirectory(dir)) ?? homedir()
    const id = randomUUID()

    const proc = pty.spawn(shell.file, shell.args, {
      name: 'xterm-256color',
      cols: Math.max(2, options.cols),
      rows: Math.max(1, options.rows),
      cwd,
      env: buildShellEnv()
    })

    const session: Session = { process: proc, owner, buffer: '', flushTimer: null, foreground: proc.process, shellName: proc.process, relaunched: agent && { agent, at: Date.now(), started: false } }
    this.sessions.set(id, session)
    this.ensurePolling()
    if (agent) this.typeWhenReady(id, session, agent)

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

  /** The shell's process id, to find what runs under it. */
  pidOf(id: string): number | null {
    return this.sessions.get(id)?.process.pid ?? null
  }

  /** The Claude session relaunched in this terminal moments ago, if it may not be visible yet. */
  relaunchedAgentOf(id: string): SavedAgent | null {
    const relaunched = this.sessions.get(id)?.relaunched
    return relaunched && Date.now() - relaunched.at < RELAUNCH_GRACE_MS ? relaunched.agent : null
  }

  /** The shell's current directory (null on Windows, or when it can't be read). */
  async cwdOf(id: string): Promise<string | null> {
    const pid = this.sessions.get(id)?.process.pid
    if (!pid) return null
    if (process.platform === 'linux') return readlink(`/proc/${pid}/cwd`).catch(() => null)
    if (process.platform !== 'darwin') return null
    return new Promise((resolve) => {
      execFile('lsof', lsofArgs(pid), { timeout: LSOF_TIMEOUT_MS }, (error, stdout) => resolve(error ? null : parseLsofCwd(stdout)))
    })
  }

  cwdOfSync(id: string): string | null {
    const pid = this.sessions.get(id)?.process.pid
    if (!pid) return null
    try {
      if (process.platform === 'linux') return readlinkSync(`/proc/${pid}/cwd`)
      if (process.platform === 'darwin') return parseLsofCwd(execFileSync('lsof', lsofArgs(pid), { timeout: LSOF_TIMEOUT_MS, encoding: 'utf8' }))
    } catch {
      // Process gone or lsof unavailable.
    }
    return null
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
        // The relaunched Claude came and went: the terminal is a plain shell again.
        if (session.relaunched && name !== session.shellName) session.relaunched.started = true
        else if (session.relaunched?.started) session.relaunched = null
        if (!session.owner.isDestroyed()) session.owner.send('pty:process', id, name)
      }
    }, PROCESS_POLL_MS)
  }

  /**
   * Types the resume command once the shell's line editor is reading the keyboard. Typed during
   * the rc files, the terminal would echo it once and the prompt draw it again.
   */
  private typeWhenReady(id: string, session: Session, agent: SavedAgent): void {
    const startedAt = Date.now()
    let lastOutputAt = 0
    const output = session.process.onData(() => {
      lastOutputAt = Date.now()
    })
    const tick = async () => {
      if (this.sessions.get(id) !== session) return output.dispose()
      const editing = await lineEditorActive(session.process)
      if (this.sessions.get(id) !== session) return output.dispose()
      const now = Date.now()
      // Without a way to tell (Windows), a shell quiet for a moment after printing is ready enough.
      const settled = editing === null && lastOutputAt > 0 && now - lastOutputAt >= SHELL_SETTLE_MS
      if (!editing && !settled && now - startedAt < SHELL_READY_TIMEOUT_MS) {
        setTimeout(tick, SHELL_READY_POLL_MS)
        return
      }
      output.dispose()
      session.relaunched = { agent, at: now, started: false }
      session.process.write(`${resumeCommand(agent)}\r`)
    }
    setTimeout(tick, SHELL_READY_POLL_MS)
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

const LSOF_TIMEOUT_MS = 1500

/**
 * Whether the shell's line editor (zle, readline…) owns the terminal: it turns canonical mode off,
 * the kernel's line discipline keeps it on while rc files run. Null when it can't be told.
 */
function lineEditorActive(proc: pty.IPty): Promise<boolean | null> {
  // Not in node-pty's typings, but exposed by its Unix implementation.
  const tty = (proc as { ptsName?: unknown }).ptsName
  if (process.platform === 'win32' || typeof tty !== 'string' || !tty.startsWith('/dev/')) return Promise.resolve(null)
  return new Promise((resolve) => {
    execFile('stty', [process.platform === 'darwin' ? '-f' : '-F', tty, '-a'], { timeout: 1000 }, (error, stdout) =>
      resolve(error ? null : /(^|\s)-icanon(\s|;|$)/.test(stdout))
    )
  })
}

function lsofArgs(pid: number): string[] {
  return ['-a', '-p', String(pid), '-d', 'cwd', '-Fn']
}

/** `lsof -Fn` prints one field per line; the name field starts with `n`. */
function parseLsofCwd(output: string): string | null {
  const line = output.split('\n').find((l) => l.startsWith('n'))
  return line ? line.slice(1) : null
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}
