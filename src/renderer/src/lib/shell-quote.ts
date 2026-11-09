import { isWindows } from './platform'

/** Quotes a path so the shell (and agents reading the prompt) sees it as one argument. */
export function quotePath(path: string): string {
  if (/^[\w@%+=:,./\\-]+$/.test(path)) return path
  if (isWindows) return `"${path.replace(/"/g, '""')}"`
  return `'${path.replace(/'/g, `'\\''`)}'`
}

/** Text to insert for dropped/inserted paths: space-separated, with a trailing space to keep typing. */
export function pathsForTerminal(paths: string[]): string {
  return paths.map(quotePath).join(' ') + ' '
}
