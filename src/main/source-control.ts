import { execFile } from 'node:child_process'
import { readFile, stat } from 'node:fs/promises'
import { isAbsolute, join, relative } from 'node:path'
import type { BranchInfo, DiffSide, GitChange, GitChangeKind, GitStash, GitStashFile, RepoStatus } from '../shared/types'

interface GitResult {
  ok: boolean
  stdout: string
  stderr: string
}

function git(cwd: string, args: string[], input?: { maxBuffer?: number }): Promise<GitResult> {
  return new Promise((resolve) => {
    execFile(
      'git',
      ['-c', 'core.quotepath=false', ...args],
      { cwd, windowsHide: true, maxBuffer: input?.maxBuffer ?? 64 * 1024 * 1024, timeout: 15_000, encoding: 'utf8' },
      (error, stdout, stderr) => resolve({ ok: !error, stdout: String(stdout), stderr: String(stderr) })
    )
  })
}

async function gitOrThrow(cwd: string, args: string[]): Promise<string> {
  const result = await git(cwd, args)
  if (!result.ok) throw new Error(result.stderr.trim() || `git ${args[0]} a échoué`)
  return result.stdout
}

/** Above this many changed files the lists stop growing (a giant build dir committed by mistake). */
const MAX_LISTED = 2000

function kindOf(code: string): GitChangeKind {
  switch (code) {
    case 'A':
      return 'added'
    case 'D':
      return 'deleted'
    case 'R':
      return 'renamed'
    case 'C':
      return 'copied'
    case 'T':
      return 'type-changed'
    default:
      return 'modified'
  }
}

/** `--numstat -z` output → added/removed line counts by path ("-" for binary files). */
function parseNumstat(out: string): Map<string, { added: number | null; removed: number | null }> {
  const counts = new Map<string, { added: number | null; removed: number | null }>()
  const parts = out.split('\0')
  for (let i = 0; i < parts.length; i++) {
    const record = parts[i]
    if (!record) continue
    const [added, removed, path] = record.split('\t')
    const value = { added: added === '-' ? null : Number(added), removed: removed === '-' ? null : Number(removed) }
    if (path) counts.set(path, value)
    else {
      // Renames: empty path, then the old and new paths as separate NUL fields.
      const newPath = parts[i + 2]
      i += 2
      if (newPath) counts.set(newPath, value)
    }
  }
  return counts
}

/** Branch, upstream and the staged / unstaged / conflicted file lists of the repo containing `cwd`. */
export async function repoStatus(cwd: string): Promise<RepoStatus | null> {
  const top = await git(cwd, ['rev-parse', '--show-toplevel'])
  if (!top.ok) return null
  const repoRoot = top.stdout.trim()

  const [status, unstagedCounts, stagedCounts, stashes] = await Promise.all([
    gitOrThrow(repoRoot, ['status', '--porcelain=v2', '--branch', '-z', '--untracked-files=all']),
    git(repoRoot, ['diff', '--numstat', '-z']),
    git(repoRoot, ['diff', '--cached', '--numstat', '-z']),
    git(repoRoot, ['stash', 'list', '--format=%gd'])
  ])
  const unstagedLines = parseNumstat(unstagedCounts.stdout)
  const stagedLines = parseNumstat(stagedCounts.stdout)

  const result: RepoStatus = {
    repoRoot,
    branch: null,
    detached: false,
    upstream: null,
    ahead: 0,
    behind: 0,
    staged: [],
    unstaged: [],
    conflicts: [],
    truncated: false,
    stashCount: stashes.ok ? stashes.stdout.split('\n').filter(Boolean).length : 0
  }

  const push = (list: GitChange[], change: GitChange) => {
    if (result.staged.length + result.unstaged.length + result.conflicts.length >= MAX_LISTED) result.truncated = true
    else list.push(change)
  }

  const parts = status.split('\0')
  for (let i = 0; i < parts.length; i++) {
    const record = parts[i]
    if (!record) continue
    if (record.startsWith('# ')) {
      const [, key, ...rest] = record.split(' ')
      const value = rest.join(' ')
      if (key === 'branch.head') {
        result.detached = value === '(detached)'
        result.branch = result.detached ? null : value
      } else if (key === 'branch.upstream') result.upstream = value
      else if (key === 'branch.ab') {
        const match = /^\+(\d+) -(\d+)$/.exec(value)
        if (match) {
          result.ahead = Number(match[1])
          result.behind = Number(match[2])
        }
      }
      continue
    }
    const type = record[0]
    if (type === '?') {
      const path = record.slice(2)
      push(result.unstaged, { path, kind: 'untracked', added: null, removed: null })
      continue
    }
    if (type === '1' || type === '2') {
      // "1 XY sub mH mI mW hH hI path" / "2 XY sub mH mI mW hH hI Xscore path" + NUL + origPath
      const fields = record.split(' ')
      const xy = fields[1]
      const path = fields.slice(type === '1' ? 8 : 9).join(' ')
      const origPath = type === '2' ? parts[++i] : undefined
      if (xy[0] !== '.') {
        const lines = stagedLines.get(path)
        push(result.staged, { path, origPath, kind: kindOf(xy[0]), added: lines?.added ?? null, removed: lines?.removed ?? null })
      }
      if (xy[1] !== '.') {
        const lines = unstagedLines.get(path)
        push(result.unstaged, { path, kind: kindOf(xy[1]), added: lines?.added ?? null, removed: lines?.removed ?? null })
      }
      continue
    }
    if (type === 'u') {
      const fields = record.split(' ')
      push(result.conflicts, { path: fields.slice(10).join(' '), kind: 'conflict', added: null, removed: null })
    }
  }
  return result
}

/** Branch, upstream and change count only: cheap enough to poll for every project. */
export async function branchInfo(cwd: string): Promise<BranchInfo | null> {
  const out = await git(cwd, ['status', '--porcelain=v2', '--branch', '-z', '--untracked-files=normal'])
  if (!out.ok) return null
  const info: BranchInfo = { branch: null, detached: false, upstream: null, ahead: 0, behind: 0, changes: 0 }
  const parts = out.stdout.split('\0')
  for (let i = 0; i < parts.length; i++) {
    const record = parts[i]
    if (!record) continue
    if (record.startsWith('# branch.head ')) {
      const head = record.slice('# branch.head '.length)
      info.detached = head === '(detached)'
      info.branch = info.detached ? null : head
    } else if (record.startsWith('# branch.upstream ')) {
      info.upstream = record.slice('# branch.upstream '.length)
    } else if (record.startsWith('# branch.ab ')) {
      const match = /^\+(\d+) -(\d+)$/.exec(record.slice('# branch.ab '.length))
      if (match) {
        info.ahead = Number(match[1])
        info.behind = Number(match[2])
      }
    } else if (record[0] === '1' || record[0] === 'u' || record[0] === '?') {
      info.changes++
    } else if (record[0] === '2') {
      info.changes++
      i++ // the original path of a rename
    }
  }
  return info
}

export async function stagePaths(repoRoot: string, paths: string[]): Promise<void> {
  if (paths.length === 0) return
  // -A also records deletions of the listed paths.
  await gitOrThrow(repoRoot, ['add', '-A', '--', ...paths])
}

export async function unstagePaths(repoRoot: string, paths: string[]): Promise<void> {
  if (paths.length === 0) return
  const restored = await git(repoRoot, ['restore', '--staged', '--', ...paths])
  if (restored.ok) return
  // Before the first commit there is no HEAD to restore from: drop the entries from the index instead.
  await gitOrThrow(repoRoot, ['rm', '--cached', '-r', '-q', '--', ...paths])
}

const STASH_REF = /^stash@\{\d+\}$/

export async function stashList(repoRoot: string): Promise<GitStash[]> {
  const out = await git(repoRoot, ['stash', 'list', '--format=%gd%x1f%H%x1f%ct%x1f%gs%x1e'])
  if (!out.ok) return []
  return out.stdout
    .split('\x1e')
    .map((record) => record.trim())
    .filter(Boolean)
    .map((record) => {
      const [ref, hash, time, subject] = record.split('\x1f')
      // Subjects look like "WIP on main: 1a2b3c msg" or "On main: msg".
      const match = /^(?:WIP on|On) ([^:]+): (.*)$/.exec(subject ?? '')
      return { ref, hash, createdAt: Number(time) * 1000, branch: match?.[1] ?? null, message: match?.[2] ?? subject ?? '' }
    })
}

export async function stashFiles(repoRoot: string, ref: string): Promise<GitStashFile[]> {
  if (!STASH_REF.test(ref)) throw new Error('Stash invalide')
  const tracked = await gitOrThrow(repoRoot, ['diff', '--name-status', '-z', `${ref}^1`, ref])
  const files: GitStashFile[] = []
  const parts = tracked.split('\0')
  for (let i = 0; i < parts.length; i++) {
    const code = parts[i]
    if (!code) continue
    if (code[0] === 'R' || code[0] === 'C') {
      const origPath = parts[++i]
      const path = parts[++i]
      files.push({ path, origPath, kind: kindOf(code[0]), untracked: false })
    } else {
      files.push({ path: parts[++i], kind: kindOf(code[0]), untracked: false })
    }
  }
  // `git stash -u` keeps untracked files in a third parent.
  const untracked = await git(repoRoot, ['ls-tree', '-r', '--name-only', '-z', `${ref}^3`])
  if (untracked.ok) {
    for (const path of untracked.stdout.split('\0').filter(Boolean)) files.push({ path, kind: 'untracked', untracked: true })
  }
  return files
}

const MAX_BLOB_BYTES = 5 * 1024 * 1024

export async function repoRootOf(cwd: string): Promise<string | null> {
  const top = await git(cwd, ['rev-parse', '--show-toplevel'])
  return top.ok ? top.stdout.trim() : null
}

type Blob = { kind: 'text'; content: string } | { kind: 'missing' } | { kind: 'binary' }

/** Working-tree file, by repo-relative path; anything resolving outside the repo is refused. */
async function readWorktree(repoRoot: string, repoPath: string): Promise<Blob> {
  const abs = join(repoRoot, repoPath)
  const rel = relative(repoRoot, abs)
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw new Error('Chemin hors du dépôt')
  const info = await stat(abs).catch(() => null)
  if (!info?.isFile()) return { kind: 'missing' }
  if (info.size > MAX_BLOB_BYTES) return { kind: 'binary' }
  const buffer = await readFile(abs)
  if (buffer.subarray(0, 8000).includes(0)) return { kind: 'binary' }
  return { kind: 'text', content: buffer.toString('utf8') }
}

/** One side of a diff: working tree, `head` (last commit), `index` (staged), or inside a stash. */
export async function showBlob(repoRoot: string, side: DiffSide): Promise<Blob> {
  if (side.source === 'worktree') return readWorktree(repoRoot, side.path)
  if (side.source === 'stash' && !STASH_REF.test(side.ref)) throw new Error('Stash invalide')
  const rev =
    side.source === 'head' ? 'HEAD' : side.source === 'index' ? '' : side.part === 'base' ? `${side.ref}^1` : side.part === 'untracked' ? `${side.ref}^3` : side.ref
  // The path is part of a single "<rev>:<path>" argument, never an option.
  const result = await git(repoRoot, ['show', `${rev}:${side.path}`], { maxBuffer: MAX_BLOB_BYTES })
  if (!result.ok) return { kind: 'missing' }
  if (result.stdout.slice(0, 8000).includes('\0')) return { kind: 'binary' }
  return { kind: 'text', content: result.stdout }
}
