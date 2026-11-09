import { execFile } from 'node:child_process'
import { existsSync } from 'node:fs'
import { delimiter, join } from 'node:path'

/** PATH as the user's login shell sets it: apps launched from a dock or menu don't inherit it. */
export function loginShellPath(): Promise<string> {
  if (process.platform === 'win32') return Promise.resolve('')
  const shell = process.env.SHELL && existsSync(process.env.SHELL) ? process.env.SHELL : '/bin/sh'
  return new Promise((resolve) => {
    execFile(shell, ['-lc', 'printf "%s" "$PATH"'], { timeout: 5000, encoding: 'utf8' }, (error, stdout) =>
      resolve(error ? '' : String(stdout).trim())
    )
  })
}

export interface ShellSpec {
  file: string
  args: string[]
}

function findOnPath(executable: string): string | null {
  const dirs = (process.env.PATH ?? process.env.Path ?? '').split(delimiter)
  for (const dir of dirs) {
    if (!dir) continue
    const candidate = join(dir, executable)
    if (existsSync(candidate)) return candidate
  }
  return null
}

/** Picks the user's default interactive shell for the current OS. */
export function resolveDefaultShell(): ShellSpec {
  if (process.platform === 'win32') {
    const pwsh = findOnPath('pwsh.exe')
    if (pwsh) return { file: pwsh, args: ['-NoLogo'] }
    const powershell = findOnPath('powershell.exe')
    if (powershell) return { file: powershell, args: ['-NoLogo'] }
    return { file: process.env.COMSPEC || 'cmd.exe', args: [] }
  }

  const fallback = process.platform === 'darwin' ? '/bin/zsh' : '/bin/bash'
  const shell = process.env.SHELL && existsSync(process.env.SHELL) ? process.env.SHELL : fallback
  // Login shell: GUI-launched apps (Finder, Dock, .desktop) don't inherit the user's PATH otherwise.
  return { file: shell, args: ['-l'] }
}

/** Environment for spawned shells: the app's env minus Electron internals, plus terminal hints. */
export function buildShellEnv(): Record<string, string> {
  const env: Record<string, string> = {}
  for (const [key, value] of Object.entries(process.env)) {
    if (value === undefined || key.startsWith('ELECTRON_')) continue
    env[key] = value
  }
  env.TERM = 'xterm-256color'
  env.COLORTERM = 'truecolor'
  env.TERM_PROGRAM = 'Capitaine'
  if (process.platform !== 'win32' && !env.LANG) env.LANG = 'en_US.UTF-8'
  return env
}
