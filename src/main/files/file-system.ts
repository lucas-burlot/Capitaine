import { execFile } from 'node:child_process'
import { watch, type FSWatcher } from 'node:fs'
import { readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'
import type { WebContents } from 'electron'
import type { DirEntry, FileContent, GitFileStatus, GitStatus } from '../../shared/types'

function toRelPath(root: string, target: string): string {
  return relative(root, target).split(sep).join('/')
}

const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

export async function listDirectory(root: string, dir: string): Promise<DirEntry[]> {
  const dirents = await readdir(dir, { withFileTypes: true })
  const entries = await Promise.all(
    dirents
      .filter((d) => d.name !== '.git')
      .map(async (d): Promise<DirEntry> => {
        const path = join(dir, d.name)
        let isDirectory = d.isDirectory()
        if (d.isSymbolicLink()) {
          // A symlink shows as what it points to; a dangling one shows as a file.
          isDirectory = await stat(path).then((s) => s.isDirectory(), () => false)
        }
        return { name: d.name, path, relPath: toRelPath(root, path), isDirectory, isSymlink: d.isSymbolicLink() }
      })
  )
  return entries.sort((a, b) => (a.isDirectory === b.isDirectory ? collator.compare(a.name, b.name) : a.isDirectory ? -1 : 1))
}

// The search keeps this many files at most; past that the project is mostly generated content.
const MAX_SEARCHED_FILES = 100_000
// Outside git there's no .gitignore to go by: skip the usual heavy, generated folders.
const SKIPPED_DIRS = new Set(['.git', 'node_modules', '.hg', '.svn', '.next', '.nuxt', '.turbo', '.cache', '.venv', 'venv', '__pycache__', 'target', 'vendor'])

/** Every file of the project, project-relative and `/`-separated, for the file search. */
export async function listProjectFiles(root: string): Promise<string[]> {
  // In a git repo: tracked and untracked files, minus the ignored ones (fast, and what you mean).
  const listed = await run(root, ['ls-files', '-z', '--cached', '--others', '--exclude-standard'])
  if (listed !== null) {
    // Tracked files deleted from the disk are still in the index.
    const deleted = new Set(((await run(root, ['ls-files', '-z', '--deleted'])) ?? '').split('\0'))
    return [...new Set(listed.split('\0'))].filter((path) => path && !deleted.has(path)).slice(0, MAX_SEARCHED_FILES)
  }
  return walkFiles(root)
}

async function walkFiles(root: string): Promise<string[]> {
  const files: string[] = []
  const queue = [root]
  while (queue.length > 0 && files.length < MAX_SEARCHED_FILES) {
    const dir = queue.shift()!
    const dirents = await readdir(dir, { withFileTypes: true }).catch(() => [])
    for (const d of dirents) {
      const path = join(dir, d.name)
      // Symlinked folders aren't followed: they can loop.
      if (d.isDirectory()) {
        if (!SKIPPED_DIRS.has(d.name)) queue.push(path)
      } else {
        files.push(toRelPath(root, path))
      }
    }
  }
  return files.slice(0, MAX_SEARCHED_FILES)
}

/** Beyond this the editor would crawl; the file opens in the OS app instead. */
const MAX_EDITABLE_BYTES = 5 * 1024 * 1024

export async function readTextFile(path: string): Promise<FileContent> {
  const info = await stat(path).catch((error: NodeJS.ErrnoException) => {
    if (error.code === 'ENOENT') return null
    throw error
  })
  if (!info) return { kind: 'missing' }
  if (info.size > MAX_EDITABLE_BYTES) return { kind: 'too-large', size: info.size }
  const buffer = await readFile(path)
  // Same heuristic as git: a NUL byte early on means binary.
  if (buffer.subarray(0, 8000).includes(0)) return { kind: 'binary', size: info.size }
  return { kind: 'text', content: buffer.toString('utf8'), mtimeMs: info.mtimeMs }
}

/** Writes in place (keeps the inode, permissions and any open watchers). */
export async function writeTextFile(path: string, content: string): Promise<number> {
  await writeFile(path, content, 'utf8')
  return (await stat(path)).mtimeMs
}

const WATCH_DEBOUNCE_MS = 150

interface Watch {
  watcher: FSWatcher
  owners: Map<WebContents, number>
  timer: NodeJS.Timeout | null
}

/** One non-recursive watcher per expanded directory, shared by every window that shows it. */
export class DirectoryWatchers {
  private readonly watches = new Map<string, Watch>()

  add(owner: WebContents, dir: string): void {
    let entry = this.watches.get(dir)
    if (!entry) {
      let watcher: FSWatcher
      try {
        watcher = watch(dir, { persistent: false })
      } catch {
        // Out of inotify watches, permission denied…: the tree still works, it just won't auto-refresh.
        return
      }
      const created: Watch = { watcher, owners: new Map(), timer: null }
      watcher.on('change', () => {
        if (created.timer) return
        created.timer = setTimeout(() => {
          created.timer = null
          for (const contents of created.owners.keys()) if (!contents.isDestroyed()) contents.send('fs:changed', dir)
        }, WATCH_DEBOUNCE_MS)
      })
      watcher.on('error', () => this.close(dir))
      this.watches.set(dir, created)
      entry = created
    }
    entry.owners.set(owner, (entry.owners.get(owner) ?? 0) + 1)
  }

  remove(owner: WebContents, dir: string): void {
    const entry = this.watches.get(dir)
    const count = entry?.owners.get(owner)
    if (!entry || !count) return
    if (count > 1) entry.owners.set(owner, count - 1)
    else entry.owners.delete(owner)
    if (entry.owners.size === 0) this.close(dir)
  }

  removeOwner(owner: WebContents): void {
    for (const [dir, entry] of this.watches) {
      entry.owners.delete(owner)
      if (entry.owners.size === 0) this.close(dir)
    }
  }

  private close(dir: string): void {
    const entry = this.watches.get(dir)
    if (!entry) return
    if (entry.timer) clearTimeout(entry.timer)
    entry.watcher.close()
    this.watches.delete(dir)
  }
}

function run(cwd: string, args: string[]): Promise<string | null> {
  return new Promise((resolve) => {
    execFile('git', args, { cwd, windowsHide: true, maxBuffer: 32 * 1024 * 1024, timeout: 10_000 }, (error, stdout) =>
      resolve(error ? null : stdout)
    )
  })
}

function classify(code: string): GitFileStatus {
  if (code === '??') return 'untracked'
  if (code === '!!') return 'ignored'
  if (code.includes('U') || code === 'AA' || code === 'DD') return 'conflict'
  if (code.includes('A')) return 'added'
  if (code.includes('D')) return 'deleted'
  if (code.includes('R')) return 'renamed'
  return 'modified'
}

/** Working-tree status relative to the repo root; null when `root` isn't in a git repo or git is missing. */
export async function gitStatus(root: string): Promise<GitStatus | null> {
  const top = await run(root, ['rev-parse', '--show-toplevel'])
  if (top === null) return null
  const repoRoot = top.trim()
  const out = await run(root, ['-c', 'core.quotepath=false', 'status', '--porcelain=v1', '-z', '--ignored'])
  if (out === null) return null

  const files: Record<string, GitFileStatus> = {}
  const parts = out.split('\0')
  for (let i = 0; i < parts.length; i++) {
    const record = parts[i]
    if (record.length < 4) continue
    const code = record.slice(0, 2)
    const repoPath = record.slice(3)
    // Renames/copies carry the original path in the next NUL-separated field.
    if (code[0] === 'R' || code[0] === 'C') i++
    // Paths come relative to the repo root; the project may be a sub-folder of it.
    const rel = toRelPath(root, join(repoRoot, repoPath))
    if (rel.startsWith('..')) continue
    files[repoPath.endsWith('/') ? `${rel}/` : rel] = classify(code)
  }
  return { files }
}
