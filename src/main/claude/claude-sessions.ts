import { execFile, execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'
import type { SavedAgent } from '../../shared/types'

/**
 * Finds the Claude Code sessions running in Capitaine's terminals, still without hooks: every
 * interactive Claude writes `<config>/sessions/<pid>.json` (its current session id and folder,
 * kept up to date across `/clear` and `/resume`), and the process tree says which shell it runs in.
 */

const SESSION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
// Claude may sit under wrappers (npx, a script…); never walk further than this.
const MAX_DEPTH = 16
const PS_TIMEOUT_MS = 1500

// Launch options worth carrying over to the resumed session; prompts and the rest are dropped.
const KEPT_SWITCHES = new Set(['--dangerously-skip-permissions', '--allow-dangerously-skip-permissions'])
const KEPT_OPTIONS = new Set(['--model', '--permission-mode', '--effort'])
const OPTION_VALUE_RE = /^[\w.:[\]-]{1,64}$/

export function claudeConfigDir(): string {
  return process.env.CLAUDE_CONFIG_DIR || join(homedir(), '.claude')
}

interface ClaudeProcess {
  pid: number
  sessionId: string
  cwd: string
  /** Process start time as Claude recorded it, to rule out a reused pid. */
  procStart: string | null
}

interface ProcessInfo {
  ppid: number
  /** Comparable with Claude's `procStart` (Linux only). */
  start: string | null
  args(): string[]
}

type ProcessTable = (pid: number) => ProcessInfo | null

/** Claude sessions, keyed by terminal id, for the shells given as terminal id → shell pid. */
export async function findClaudeAgents(shells: Map<string, number>): Promise<Map<string, SavedAgent>> {
  const claudes = shells.size ? claudeProcesses() : []
  if (claudes.length === 0) return new Map()
  if (process.platform === 'linux') return matchShells(shells, claudes, linuxProcess)
  if (process.platform !== 'darwin') return new Map()
  const output = await new Promise<string | null>((resolve) => {
    execFile('ps', PS_ARGS, { timeout: PS_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024 }, (error, stdout) => resolve(error ? null : stdout))
  })
  return output === null ? new Map() : matchShells(shells, claudes, psTable(output))
}

/** Same, blocking: for the moment the window unloads and the shells are about to die. */
export function findClaudeAgentsSync(shells: Map<string, number>): Map<string, SavedAgent> {
  const claudes = shells.size ? claudeProcesses() : []
  if (claudes.length === 0) return new Map()
  if (process.platform === 'linux') return matchShells(shells, claudes, linuxProcess)
  if (process.platform !== 'darwin') return new Map()
  try {
    const output = execFileSync('ps', PS_ARGS, { timeout: PS_TIMEOUT_MS, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 })
    return matchShells(shells, claudes, psTable(output))
  } catch {
    return new Map()
  }
}

/** Claude can only resume a conversation it wrote down, i.e. one with at least one message. */
export function hasTranscript(sessionId: string): boolean {
  if (!SESSION_ID_RE.test(sessionId)) return false
  const dir = join(claudeConfigDir(), 'projects')
  try {
    return readdirSync(dir).some((project) => existsSync(join(dir, project, `${sessionId}.jsonl`)))
  } catch {
    return false
  }
}

/** Checks a saved agent (it comes back through the renderer); null when it can't be relaunched. */
export function sanitizeAgent(raw: unknown): SavedAgent | null {
  if (typeof raw !== 'object' || raw === null) return null
  const { sessionId: rawId, cwd, args } = raw as Record<string, unknown>
  const sessionId = typeof rawId === 'string' && SESSION_ID_RE.test(rawId) ? rawId : null
  if (rawId !== null && sessionId === null) return null
  if (typeof cwd !== 'string' || !isDirectory(cwd)) return null
  return { sessionId, cwd, args: Array.isArray(args) ? launchOptions(['claude', ...args.filter((a): a is string => typeof a === 'string')]) : [] }
}

/** What to type in the restored shell. Typed rather than spawned so the user's aliases apply. */
export function resumeCommand(agent: SavedAgent): string {
  const words = ['claude', ...(agent.sessionId ? ['--resume', agent.sessionId] : []), ...launchOptions(['claude', ...agent.args])]
  return words.map(quoteWord).join(' ')
}

function claudeProcesses(): ClaudeProcess[] {
  const dir = join(claudeConfigDir(), 'sessions')
  let names: string[]
  try {
    names = readdirSync(dir)
  } catch {
    return []
  }
  const result: ClaudeProcess[] = []
  for (const name of names) {
    const match = /^(\d+)\.json$/.exec(name)
    if (!match) continue
    try {
      const data = JSON.parse(readFileSync(join(dir, name), 'utf8')) as Record<string, unknown>
      // `claude -p` and SDK processes aren't sessions the user had open.
      if (data.kind !== undefined && data.kind !== 'interactive') continue
      if (typeof data.sessionId !== 'string' || !SESSION_ID_RE.test(data.sessionId) || typeof data.cwd !== 'string') continue
      result.push({ pid: Number(match[1]), sessionId: data.sessionId, cwd: data.cwd, procStart: typeof data.procStart === 'string' ? data.procStart : null })
    } catch {
      // Being rewritten, or left over by a dead process.
    }
  }
  return result
}

function matchShells(shells: Map<string, number>, claudes: ClaudeProcess[], table: ProcessTable): Map<string, SavedAgent> {
  const terminalOfShell = new Map([...shells].map(([terminalId, pid]) => [pid, terminalId]))
  const found = new Map<string, SavedAgent & { depth: number }>()
  for (const claude of claudes) {
    const self = table(claude.pid)
    if (!self || (claude.procStart && self.start && claude.procStart !== self.start)) continue
    let pid = self.ppid
    for (let depth = 0; depth < MAX_DEPTH && pid > 1; depth++) {
      const terminalId = terminalOfShell.get(pid)
      if (terminalId) {
        // A Claude started from inside another one: the outer one is what the terminal shows.
        const previous = found.get(terminalId)
        if (!previous || depth < previous.depth) {
          found.set(terminalId, { sessionId: claude.sessionId, cwd: claude.cwd, args: launchOptions(self.args()), depth })
        }
        break
      }
      pid = table(pid)?.ppid ?? 0
    }
  }
  return new Map([...found].map(([id, { depth: _depth, ...agent }]) => [id, agent]))
}

function linuxProcess(pid: number): ProcessInfo | null {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, 'utf8')
    // The name (field 2) may hold spaces and parentheses; the fields after it are plain.
    const fields = stat.slice(stat.lastIndexOf(')') + 2).split(' ')
    return {
      ppid: Number(fields[1]),
      start: fields[19] ?? null,
      args: () => {
        try {
          return readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0').filter(Boolean)
        } catch {
          return []
        }
      }
    }
  } catch {
    return null
  }
}

const PS_ARGS = ['-A', '-ww', '-o', 'pid=,ppid=,args=']

/** `ps` joins the arguments with spaces; fine for the plain values `launchOptions` keeps. */
function psTable(output: string): ProcessTable {
  const rows = new Map<number, ProcessInfo>()
  for (const line of output.split('\n')) {
    const match = /^\s*(\d+)\s+(\d+)\s?(.*)$/.exec(line)
    if (!match) continue
    const args = match[3].split(/\s+/).filter(Boolean)
    rows.set(Number(match[1]), { ppid: Number(match[2]), start: null, args: () => args })
  }
  return (pid) => rows.get(pid) ?? null
}

/** The options among `argv` (program first) that a resumed session should keep. */
function launchOptions(argv: string[]): string[] {
  const kept: string[] = []
  for (let i = 1; i < argv.length; i++) {
    const arg = argv[i]
    if (KEPT_SWITCHES.has(arg)) {
      if (!kept.includes(arg)) kept.push(arg)
      continue
    }
    const eq = arg.indexOf('=')
    const name = eq === -1 ? arg : arg.slice(0, eq)
    if (!KEPT_OPTIONS.has(name)) continue
    const value = eq === -1 ? argv[++i] : arg.slice(eq + 1)
    if (value === undefined || !OPTION_VALUE_RE.test(value)) continue
    // Given twice, the last one wins (as Claude reads it).
    const at = kept.indexOf(name)
    if (at !== -1) kept.splice(at, 2)
    kept.push(name, value)
  }
  return kept
}

/** Values are restricted to `OPTION_VALUE_RE`, so only `[ ]` (zsh globs: `opus[1m]`) need quoting. */
function quoteWord(word: string): string {
  return /^[\w.:=-]+$/.test(word) ? word : `'${word.replace(/'/g, `'\\''`)}'`
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}
