import { execFile, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { delimiter, dirname, join } from 'node:path'

/**
 * One-shot calls to Claude through the Claude Code CLI (`claude -p`): it brings the user's own
 * login, so the app holds no API key. Tools, MCP servers, hooks and CLAUDE.md are all off: the
 * model only reads what the prompt hands it and answers with text.
 */

export interface ClaudeRequest {
  prompt: string
  system: string
  /** Alias (`haiku`, `sonnet`, `opus`) or full model id. */
  model: string
  cwd: string
  timeoutMs: number
}

let resolved: Promise<{ file: string; env: NodeJS.ProcessEnv } | null> | null = null

/** PATH as the user's login shell sets it: apps launched from a dock or menu don't inherit it. */
function loginShellPath(): Promise<string> {
  if (process.platform === 'win32') return Promise.resolve('')
  const shell = process.env.SHELL && existsSync(process.env.SHELL) ? process.env.SHELL : '/bin/sh'
  return new Promise((resolve) => {
    execFile(shell, ['-lc', 'printf "%s" "$PATH"'], { timeout: 5000, encoding: 'utf8' }, (error, stdout) =>
      resolve(error ? '' : String(stdout).trim())
    )
  })
}

function findClaude(pathValue: string): string | null {
  const names = process.platform === 'win32' ? ['claude.exe', 'claude.cmd'] : ['claude']
  const home = homedir()
  const dirs = [
    ...pathValue.split(delimiter),
    join(home, '.local', 'bin'),
    join(home, '.claude', 'local'),
    join(home, '.npm-global', 'bin'),
    '/opt/homebrew/bin',
    '/usr/local/bin',
    ...(process.env.APPDATA ? [join(process.env.APPDATA, 'npm')] : [])
  ]
  for (const dir of dirs) {
    if (!dir) continue
    for (const name of names) {
      const candidate = join(dir, name)
      if (existsSync(candidate)) return candidate
    }
  }
  return null
}

function resolveClaude() {
  resolved ??= (async () => {
    const login = await loginShellPath()
    const pathValue = [login, process.env.PATH ?? process.env.Path ?? ''].filter(Boolean).join(delimiter)
    const file = findClaude(pathValue)
    if (!file) return null
    const env: NodeJS.ProcessEnv = {}
    for (const [key, value] of Object.entries(process.env)) {
      // Electron internals, and the markers that make Claude think it runs inside another Claude.
      if (value === undefined || key.startsWith('ELECTRON_') || key === 'CLAUDECODE' || key === 'CLAUDE_CODE_ENTRYPOINT') continue
      env[key] = value
    }
    // npm installs are node scripts: their interpreter must be on PATH too.
    env.PATH = [dirname(file), pathValue].join(delimiter)
    return { file, env }
  })()
  return resolved.then((value) => {
    if (!value) resolved = null // installed later: look again next time
    return value
  })
}

class ClaudeError extends Error {}

function run(file: string, args: string[], env: NodeJS.ProcessEnv, request: ClaudeRequest): Promise<string> {
  return new Promise((resolve, reject) => {
    const windowsScript = process.platform === 'win32' && /\.cmd$/i.test(file)
    const child = spawn(windowsScript ? `"${file}"` : file, windowsScript ? args.map((a) => `"${a.replace(/"/g, '""')}"`) : args, {
      cwd: request.cwd,
      env,
      windowsHide: true,
      shell: windowsScript
    })
    let stdout = ''
    let stderr = ''
    let settled = false
    const finish = (fn: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      fn()
    }
    const timer = setTimeout(() => {
      child.kill()
      finish(() => reject(new ClaudeError(`Claude n’a pas répondu en ${Math.round(request.timeoutMs / 1000)} s`)))
    }, request.timeoutMs)
    child.stdout.setEncoding('utf8').on('data', (chunk: string) => (stdout += chunk))
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => (stderr += chunk))
    child.on('error', (error) => finish(() => reject(new ClaudeError(`Impossible de lancer Claude Code : ${error.message}`))))
    child.on('close', (code) =>
      finish(() => {
        if (code === 0 && stdout.trim()) resolve(stdout)
        else reject(new ClaudeError((stderr || stdout).trim() || `Claude Code s’est arrêté (code ${code})`))
      })
    )
    child.stdin.on('error', () => {})
    child.stdin.end(request.prompt)
  })
}

/** Sends one prompt, returns the model's text answer. */
export async function askClaude(request: ClaudeRequest): Promise<string> {
  const claude = await resolveClaude()
  if (!claude) throw new Error('Claude Code est introuvable. Installe-le (https://claude.com/claude-code) puis réessaie.')
  const base = ['-p', '--model', request.model, '--output-format', 'text', '--tools', '', '--strict-mcp-config', '--no-session-persistence', '--system-prompt', request.system]
  try {
    return await run(claude.file, ['--safe-mode', ...base], claude.env, request)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    // Older Claude Code without --safe-mode: same call, customizations left on.
    if (/unknown option.*safe-mode/i.test(message)) return run(claude.file, base, claude.env, request).catch((e) => Promise.reject(friendly(e)))
    throw friendly(error)
  }
}

function friendly(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error)
  if (/not logged in|please run \/login|invalid api key|authentication|oauth token/i.test(message)) {
    return new Error('Claude Code n’est pas connecté : lance `claude` dans un terminal pour te connecter.')
  }
  if (/usage limit|rate limit/i.test(message)) return new Error('Limite d’utilisation de Claude atteinte : réessaie plus tard.')
  return new Error(message.split('\n').slice(0, 4).join('\n'))
}
