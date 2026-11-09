import { writeFile } from 'node:fs/promises'
import type { CommitOptions, GitActionResult, GitBranch, StashOptions } from '../../shared/types'
import { branchInfo, git, gitError, gitOrThrow, insideRepo, operationInProgress, type GitOptions } from './git-repo'

/** Network operations get far longer than the local ones (slow remotes, big fetches, hooks). */
const NETWORK_TIMEOUT = 180_000
const HOOK_TIMEOUT = 120_000

/**
 * ssh must not ask for a passphrase or a host-key confirmation: nobody can answer (or it lands
 * unseen in the terminal the app was started from). ssh-agent keys still work. A user-chosen ssh
 * command is left alone.
 */
async function networkOptions(repoRoot: string): Promise<GitOptions> {
  const custom = process.env.GIT_SSH_COMMAND || process.env.GIT_SSH || (await git(repoRoot, ['config', '--get', 'core.sshCommand'])).stdout.trim()
  return { timeout: NETWORK_TIMEOUT, env: custom ? {} : { GIT_SSH_COMMAND: 'ssh -o BatchMode=yes' } }
}

const plural = (n: number, one: string, many: string) => `${n} ${n > 1 ? many : one}`

/** Local branches, then remote ones not already tracked by a local branch; most recent first. */
export async function listBranches(repoRoot: string): Promise<GitBranch[]> {
  const format = ['%(refname)', '%(refname:short)', '%(upstream:short)', '%(upstream:track,nobracket)', '%(committerdate:unix)', '%(contents:subject)', '%(HEAD)'].join('%1f')
  const out = await gitOrThrow(repoRoot, ['for-each-ref', '--sort=-committerdate', `--format=${format}`, 'refs/heads', 'refs/remotes'])
  const branches: GitBranch[] = []
  for (const line of out.split('\n')) {
    if (!line) continue
    const [ref, name, upstream, track, time, subject, head] = line.split('\x1f')
    // `origin/HEAD` is an alias of the remote's default branch, not a branch.
    if (ref.startsWith('refs/remotes/') && ref.endsWith('/HEAD')) continue
    const ahead = /ahead (\d+)/.exec(track ?? '')
    const behind = /behind (\d+)/.exec(track ?? '')
    branches.push({
      name,
      remote: ref.startsWith('refs/remotes/'),
      current: head === '*',
      upstream: upstream || null,
      ahead: ahead ? Number(ahead[1]) : 0,
      behind: behind ? Number(behind[1]) : 0,
      updatedAt: Number(time) * 1000,
      subject: subject ?? ''
    })
  }
  const tracked = new Set(branches.filter((b) => !b.remote && b.upstream).map((b) => b.upstream))
  return branches.filter((b) => !b.remote || !tracked.has(b.name))
}

const refExists = async (repoRoot: string, ref: string) => (await git(repoRoot, ['show-ref', '--verify', '--quiet', ref])).ok

/** Refuses anything git wouldn't accept as a branch name (and anything that could pass as an option). */
async function checkBranchName(repoRoot: string, name: string): Promise<string> {
  const trimmed = name.trim()
  if (!trimmed || trimmed.startsWith('-')) throw new Error('Nom de branche invalide')
  const check = await git(repoRoot, ['check-ref-format', '--branch', trimmed])
  if (!check.ok) throw new Error(`« ${trimmed} » n’est pas un nom de branche valide`)
  return trimmed
}

export async function switchBranch(repoRoot: string, name: string): Promise<GitActionResult> {
  if (!name || name.startsWith('-')) throw new Error('Branche invalide')
  if (await refExists(repoRoot, `refs/heads/${name}`)) {
    await gitOrThrow(repoRoot, ['switch', name])
    return { message: `Sur la branche ${name}` }
  }
  if (!(await refExists(repoRoot, `refs/remotes/${name}`))) throw new Error(`La branche ${name} n’existe pas`)
  // Remote branch: switch to the local branch tracking it, creating it the first time.
  const remotes = (await gitOrThrow(repoRoot, ['remote'])).split('\n').filter(Boolean)
  const remote = remotes.filter((r) => name.startsWith(`${r}/`)).sort((a, b) => b.length - a.length)[0]
  const local = remote ? name.slice(remote.length + 1) : name
  if (await refExists(repoRoot, `refs/heads/${local}`)) {
    await gitOrThrow(repoRoot, ['switch', local])
    return { message: `Sur la branche ${local}` }
  }
  await gitOrThrow(repoRoot, ['switch', '--track', '-c', local, name])
  return { message: `Branche ${local} créée depuis ${name}` }
}

export async function createBranch(repoRoot: string, name: string, from?: string): Promise<GitActionResult> {
  const branch = await checkBranchName(repoRoot, name)
  if (await refExists(repoRoot, `refs/heads/${branch}`)) throw new Error(`La branche ${branch} existe déjà`)
  const args = ['switch', '-c', branch]
  if (from) {
    if (from.startsWith('-') || !(await git(repoRoot, ['rev-parse', '--verify', '--quiet', `${from}^{commit}`])).ok) {
      throw new Error(`Point de départ introuvable : ${from}`)
    }
    // A branch made from a remote one shouldn't silently track it (pushing would go there).
    args.push('--no-track', from)
  }
  await gitOrThrow(repoRoot, args)
  return { message: `Branche ${branch} créée${from ? ` depuis ${from}` : ''}` }
}

export async function commit(repoRoot: string, options: CommitOptions): Promise<GitActionResult> {
  const message = options.message.replace(/\r\n/g, '\n').trim()
  if (!message) throw new Error('Le message de commit est vide')
  const unresolved = await unmergedPaths(repoRoot)
  if (unresolved.length) throw new Error(`Il reste ${plural(unresolved.length, 'conflit', 'conflits')} à résoudre`)
  if (options.all) await gitOrThrow(repoRoot, ['add', '-A'])
  const args = ['commit', '--cleanup=strip', '-m', message]
  if (options.amend) args.push('--amend')
  const result = await git(repoRoot, args, { timeout: HOOK_TIMEOUT })
  if (!result.ok) {
    if (/nothing (added )?to commit|no changes added to commit/.test(result.stdout)) throw new Error('Rien à commiter')
    throw new Error(gitError(result, args))
  }
  const summary = (await git(repoRoot, ['log', '-1', '--format=%h %s'])).stdout.trim()
  return { message: `Commit ${summary}` }
}

async function unmergedPaths(repoRoot: string): Promise<string[]> {
  const out = await git(repoRoot, ['diff', '--name-only', '--diff-filter=U', '-z'])
  return out.stdout.split('\0').filter(Boolean)
}

/** Remote a new branch is published to: the configured push remote, else origin, else the only one. */
async function pushRemote(repoRoot: string, branch: string): Promise<string> {
  const config = async (key: string) => (await git(repoRoot, ['config', '--get', key])).stdout.trim()
  const configured = (await config(`branch.${branch}.pushRemote`)) || (await config('remote.pushDefault'))
  if (configured) return configured
  const remotes = (await gitOrThrow(repoRoot, ['remote'])).split('\n').filter(Boolean)
  if (remotes.length === 0) throw new Error('Aucun dépôt distant configuré (git remote add origin <url>)')
  return remotes.includes('origin') ? 'origin' : remotes[0]
}

export async function push(repoRoot: string): Promise<GitActionResult> {
  const info = await branchInfo(repoRoot)
  if (!info?.branch) throw new Error('HEAD détachée : crée une branche avant de pousser')
  const args = info.upstream ? ['push'] : ['push', '--set-upstream', await pushRemote(repoRoot, info.branch), info.branch]
  const result = await git(repoRoot, args, await networkOptions(repoRoot))
  if (!result.ok) {
    const output = result.stderr + result.stdout
    if (/non-fast-forward|fetch first|\[rejected\]/.test(output)) {
      throw new Error('La branche distante contient des commits que tu n’as pas : récupère-les (pull) avant de pousser.')
    }
    throw new Error(gitError(result, args))
  }
  if (!info.upstream) return { message: `Branche publiée sur ${args[2]}/${info.branch}` }
  if (/Everything up-to-date/.test(result.stderr)) return { message: 'Rien à pousser : déjà à jour' }
  return { message: info.ahead ? `${plural(info.ahead, 'commit poussé', 'commits poussés')} vers ${info.upstream}` : `Poussé vers ${info.upstream}` }
}

export async function pull(repoRoot: string): Promise<GitActionResult> {
  const info = await branchInfo(repoRoot)
  if (!info?.branch) throw new Error('HEAD détachée : rien à récupérer')
  if (!info.upstream) throw new Error('Cette branche n’a pas encore de branche distante : pousse-la pour la publier')
  const before = (await git(repoRoot, ['rev-parse', 'HEAD'])).stdout.trim()
  const args = ['pull']
  // Without a configured strategy, recent git refuses divergent branches: merge, like VS Code does.
  const strategy = await git(repoRoot, ['config', '--get', 'pull.rebase'])
  if (!strategy.stdout.trim()) args.push('--no-rebase')
  const result = await git(repoRoot, args, await networkOptions(repoRoot))
  if (!result.ok) {
    const conflicts = await unmergedPaths(repoRoot)
    if (conflicts.length) return { message: `${plural(conflicts.length, 'conflit', 'conflits')} à résoudre`, conflicts: true }
    throw new Error(gitError(result, args))
  }
  const after = (await git(repoRoot, ['rev-parse', 'HEAD'])).stdout.trim()
  if (before === after) return { message: 'Déjà à jour' }
  const count = Number((await git(repoRoot, ['rev-list', '--count', `${before}..${after}`])).stdout.trim()) || 0
  return { message: `${plural(count, 'commit récupéré', 'commits récupérés')} depuis ${info.upstream}` }
}

export async function fetchAll(repoRoot: string): Promise<GitActionResult> {
  const remotes = await git(repoRoot, ['remote'])
  if (!remotes.stdout.trim()) return { message: 'Aucun dépôt distant' }
  await gitOrThrow(repoRoot, ['fetch', '--all', '--prune'], await networkOptions(repoRoot))
  return { message: 'Branches distantes à jour' }
}

const OPERATION_LABEL = { merge: 'Fusion', rebase: 'Rebase', 'cherry-pick': 'Cherry-pick', revert: 'Revert' } as const

export async function finishOperation(repoRoot: string, how: 'continue' | 'abort'): Promise<GitActionResult> {
  const operation = await operationInProgress(repoRoot)
  if (!operation) throw new Error('Aucune fusion ni rebase en cours')
  const label = OPERATION_LABEL[operation.kind]
  if (how === 'abort') {
    await gitOrThrow(repoRoot, [operation.kind, '--abort'])
    return { message: `${label} annulé${operation.kind === 'merge' ? 'e' : ''}` }
  }
  const unresolved = await unmergedPaths(repoRoot)
  if (unresolved.length) throw new Error(`Il reste ${plural(unresolved.length, 'conflit', 'conflits')} à résoudre`)
  // A merge is concluded by committing it, with the message git prepared.
  const args = operation.kind === 'merge' ? ['commit', '--no-edit'] : [operation.kind, '--continue']
  const result = await git(repoRoot, args, { timeout: HOOK_TIMEOUT })
  if (!result.ok) {
    const conflicts = await unmergedPaths(repoRoot)
    if (conflicts.length) return { message: `Étape suivante : ${plural(conflicts.length, 'conflit', 'conflits')} à résoudre`, conflicts: true }
    throw new Error(gitError(result, args))
  }
  const still = await operationInProgress(repoRoot)
  return { message: still ? `${label} : étape suivante` : `${label} terminé${operation.kind === 'merge' ? 'e' : ''}` }
}

/** Keeps one side of a conflict whole: "current" is HEAD (stage 2), "incoming" what is merged in (stage 3). */
export async function takeSide(repoRoot: string, path: string, side: 'current' | 'incoming'): Promise<void> {
  insideRepo(repoRoot, path)
  const stages = (await gitOrThrow(repoRoot, ['ls-files', '-u', '-z', '--', path]))
    .split('\0')
    .filter(Boolean)
    .map((entry) => entry.split(' ')[2]?.split('\t')[0])
  const stage = side === 'current' ? '2' : '3'
  if (!stages.includes(stage)) {
    // That side deleted the file: keeping it means deleting it.
    await gitOrThrow(repoRoot, ['rm', '-q', '--', path])
    return
  }
  await gitOrThrow(repoRoot, ['checkout', side === 'current' ? '--ours' : '--theirs', '--', path])
  await gitOrThrow(repoRoot, ['add', '--', path])
}

export async function writeResolution(repoRoot: string, path: string, content: string): Promise<void> {
  await writeFile(insideRepo(repoRoot, path), content, 'utf8')
  await gitOrThrow(repoRoot, ['add', '--', path])
}

export async function stashPush(repoRoot: string, options: StashOptions): Promise<GitActionResult> {
  const unresolved = await unmergedPaths(repoRoot)
  if (unresolved.length) throw new Error('Résous les conflits avant de stasher')
  const args = ['stash', 'push']
  if (options.stagedOnly) args.push('--staged')
  else if (options.includeUntracked) args.push('--include-untracked')
  const message = options.message.trim()
  if (message) args.push('-m', message)
  const paths = options.paths ?? []
  for (const path of paths) insideRepo(repoRoot, path)
  if (paths.length) args.push('--', ...paths)
  const stashTip = async () => (await git(repoRoot, ['rev-parse', '--verify', '--quiet', 'refs/stash'])).stdout.trim()
  const before = await stashTip()
  const result = await git(repoRoot, args)
  if (!result.ok) {
    if (options.stagedOnly && /unknown option|--staged/.test(result.stderr)) throw new Error('« Uniquement les fichiers indexés » demande git 2.35 ou plus récent')
    throw new Error(gitError(result, args))
  }
  // git exits 0 when there was nothing to save (in the user's language): look at the stash itself.
  if ((await stashTip()) === before) throw new Error('Rien à stasher')
  return { message: `Stash créé${message ? ` : ${message}` : ''}` }
}

/**
 * `stash@{n}` indexes shift whenever a stash is added or dropped: act only if the ref still
 * points at the stash the user clicked.
 */
async function checkStash(repoRoot: string, ref: string, hash: string): Promise<void> {
  if (!/^stash@\{\d+\}$/.test(ref)) throw new Error('Stash invalide')
  const current = await git(repoRoot, ['rev-parse', '--verify', '--quiet', ref])
  if (current.stdout.trim() !== hash) throw new Error('La liste des stash a changé entre-temps : réessaie')
}

/** Applies a stash onto the working tree; `drop` also removes it (pop) when it applied cleanly. */
export async function stashApply(repoRoot: string, ref: string, hash: string, drop: boolean): Promise<GitActionResult> {
  await checkStash(repoRoot, ref, hash)
  const args = ['stash', drop ? 'pop' : 'apply', ref]
  const result = await git(repoRoot, args)
  if (!result.ok) {
    const conflicts = await unmergedPaths(repoRoot)
    if (!conflicts.length) {
      const blocking = await dirtyFilesTouchedBy(repoRoot, ref)
      if (blocking.length) {
        const names = blocking.slice(0, 3).join(', ') + (blocking.length > 3 ? ` et ${blocking.length - 3} autre(s)` : '')
        throw new Error(`Le stash modifie des fichiers que tu as changés depuis : ${names}. Commite-les ou stashe-les avant de l’appliquer.`)
      }
    }
    if (conflicts.length) {
      return { message: `Stash appliqué avec ${plural(conflicts.length, 'conflit', 'conflits')} à résoudre${drop ? ' (il est conservé)' : ''}`, conflicts: true }
    }
    throw new Error(gitError(result, args))
  }
  return { message: drop ? 'Stash appliqué et supprimé' : 'Stash appliqué (toujours dans la liste)' }
}

/** Files the stash changes that also have uncommitted changes (git refuses to apply over them). */
async function dirtyFilesTouchedBy(repoRoot: string, ref: string): Promise<string[]> {
  const [tracked, untracked, dirty] = await Promise.all([
    git(repoRoot, ['diff', '--name-only', '-z', `${ref}^1`, ref]),
    git(repoRoot, ['ls-tree', '-r', '--name-only', '-z', `${ref}^3`]),
    git(repoRoot, ['status', '--porcelain=v1', '-z', '--untracked-files=all'])
  ])
  const touched = new Set([...tracked.stdout.split('\0'), ...(untracked.ok ? untracked.stdout.split('\0') : [])].filter(Boolean))
  const changed = dirty.stdout
    .split('\0')
    .filter((entry) => entry.length > 3)
    .map((entry) => entry.slice(3))
  return changed.filter((path) => touched.has(path))
}

export async function stashDrop(repoRoot: string, ref: string, hash: string): Promise<GitActionResult> {
  await checkStash(repoRoot, ref, hash)
  await gitOrThrow(repoRoot, ['stash', 'drop', ref])
  return { message: `Stash supprimé (${hash.slice(0, 7)})` }
}
