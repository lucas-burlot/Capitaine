import { readFile, stat } from 'node:fs/promises'
import type { ConflictResolution } from '../../shared/types'
import { askClaude } from '../claude/claude-cli'
import { git, insideRepo, operationInProgress } from './git-repo'

const COMMIT_MODEL = 'sonnet'
const RESOLVE_MODEL = 'sonnet'

/** What the model sees of a diff: enough to understand it, bounded so a huge change stays fast. */
const MAX_DIFF_CHARS = 60_000
const MAX_FILE_DIFF_CHARS = 8_000
const LOCKFILE = /(^|\/)(package-lock\.json|yarn\.lock|pnpm-lock\.yaml|bun\.lockb?|Cargo\.lock|poetry\.lock|composer\.lock|Gemfile\.lock|go\.sum|uv\.lock)$/

function boundDiff(diff: string): string {
  const files = diff.split(/(?=^diff --git )/m).filter(Boolean)
  let out = ''
  for (const file of files) {
    const header = /^diff --git a\/(.*?) b\//.exec(file)
    const path = header?.[1] ?? ''
    let chunk = LOCKFILE.test(path) ? `${file.split('\n')[0]}\n(lockfile mis à jour, contenu omis)\n` : file
    if (chunk.length > MAX_FILE_DIFF_CHARS) chunk = `${chunk.slice(0, MAX_FILE_DIFF_CHARS)}\n… (diff de ce fichier tronqué)\n`
    if (out.length + chunk.length > MAX_DIFF_CHARS) {
      out += `\n… (${files.length - files.indexOf(file)} autre(s) fichier(s) non montré(s))\n`
      break
    }
    out += chunk
  }
  return out
}

async function untrackedPreview(repoRoot: string): Promise<string> {
  const list = await git(repoRoot, ['ls-files', '--others', '--exclude-standard', '-z'])
  const paths = list.stdout.split('\0').filter(Boolean)
  let out = ''
  for (const path of paths.slice(0, 30)) {
    let body = ''
    try {
      const abs = insideRepo(repoRoot, path)
      const info = await stat(abs)
      if (info.isFile() && info.size < 200_000) {
        const text = await readFile(abs, 'utf8')
        body = text.includes('\0') ? '(binaire)' : text.slice(0, 3000)
      }
    } catch {
      body = ''
    }
    out += `\n--- nouveau fichier : ${path}\n${body}\n`
    if (out.length > 20_000) break
  }
  if (paths.length > 30) out += `\n… et ${paths.length - 30} autre(s) nouveau(x) fichier(s)\n`
  return out
}

const COMMIT_SYSTEM = [
  'You write git commit messages.',
  'Output ONLY the commit message: a subject line, optionally followed by a blank line and a short body.',
  'No code fences, no quotes, no preamble, no explanation of your choices.'
].join(' ')

/** A commit message for what is staged (or for every change when `all`), in the repo's own style. */
export async function generateCommitMessage(repoRoot: string, all: boolean): Promise<string> {
  const hasHead = (await git(repoRoot, ['rev-parse', '--verify', '--quiet', 'HEAD'])).ok
  const diffArgs = ['diff', '--no-color', '--no-ext-diff', '--find-renames', ...(all ? (hasHead ? ['HEAD'] : []) : ['--cached'])]
  const statArgs = [...diffArgs, '--stat=120']
  const [diff, diffStat, log, branch, untracked] = await Promise.all([
    git(repoRoot, diffArgs),
    git(repoRoot, statArgs),
    hasHead ? git(repoRoot, ['log', '-n', '20', '--format=%s']) : Promise.resolve({ ok: true, stdout: '', stderr: '' }),
    git(repoRoot, ['rev-parse', '--abbrev-ref', 'HEAD']),
    all ? untrackedPreview(repoRoot) : Promise.resolve('')
  ])
  if (!diff.stdout.trim() && !untracked.trim()) throw new Error(all ? 'Aucun changement à décrire' : 'Aucun fichier indexé à décrire')

  const recent = log.stdout.trim()
  const prompt = [
    'Write the commit message for the change below.',
    '',
    'Rules:',
    recent
      ? '- Match the conventions of the recent commits listed below: same format (e.g. Conventional Commits `type(scope): …` if they use it), same language, same casing, similar scopes.'
      : '- There is no history yet: use the Conventional Commits format, in English.',
    '- Subject line: at most 72 characters, imperative mood, says what the change does for the project (not a file list). No trailing period.',
    '- Add a body only when the subject cannot carry the "why" alone: a few short lines, wrapped at 72 characters.',
    '- Never invent facts that the diff does not show.',
    '',
    `Branch: ${branch.stdout.trim() || 'unknown'}`,
    recent ? `\nRecent commit subjects (newest first):\n${recent}` : '',
    `\nFiles changed:\n${diffStat.stdout.trim()}`,
    `\nDiff:\n${boundDiff(diff.stdout)}`,
    untracked ? `\nNew files (untracked, will be added):\n${untracked}` : ''
  ].join('\n')

  const answer = await askClaude({ prompt, system: COMMIT_SYSTEM, model: COMMIT_MODEL, cwd: repoRoot, timeoutMs: 120_000 })
  return cleanCommitMessage(answer)
}

function cleanCommitMessage(answer: string): string {
  let text = answer.trim()
  const fenced = /^```[\w-]*\n([\s\S]*?)\n```$/.exec(text)
  if (fenced) text = fenced[1].trim()
  text = text.replace(/^(commit message|message de commit)\s*:\s*/i, '')
  if (/^["'`].*["'`]$/s.test(text)) text = text.slice(1, -1).trim()
  return text
}

const MAX_CONFLICT_BYTES = 200_000
const START_MARKER = /^<{7}( |$)/m
const END_MARKER = /^>{7}( |$)/m

/** The commit being merged / replayed into HEAD, when one is in progress. */
async function incomingRev(repoRoot: string): Promise<string | null> {
  for (const ref of ['MERGE_HEAD', 'REBASE_HEAD', 'CHERRY_PICK_HEAD', 'REVERT_HEAD']) {
    if ((await git(repoRoot, ['rev-parse', '--verify', '--quiet', ref])).ok) return ref
  }
  return null
}

const RESOLVE_SYSTEM = [
  'You resolve git merge conflicts.',
  'You receive one file containing conflict markers, and context on both sides.',
  'Produce the complete resolved file: keep the intent of both sides whenever they are compatible, and remove every conflict marker.',
  'Change nothing outside the conflicted regions.',
  'Answer in exactly this format and nothing else:',
  '<explanation>One or two sentences, in French, on what you kept from each side.</explanation>',
  '<resolved>',
  '…the whole resolved file…',
  '</resolved>'
].join('\n')

export async function resolveConflict(repoRoot: string, path: string): Promise<ConflictResolution> {
  const abs = insideRepo(repoRoot, path)
  const info = await stat(abs).catch(() => null)
  if (!info?.isFile()) throw new Error('Le fichier n’existe plus dans l’arbre de travail : garde une des deux versions.')
  if (info.size > MAX_CONFLICT_BYTES) throw new Error('Fichier trop volumineux pour une résolution par l’IA')
  const marked = await readFile(abs, 'utf8')
  if (marked.includes('\0')) throw new Error('Fichier binaire : garde une des deux versions.')
  if (!START_MARKER.test(marked)) throw new Error('Aucun marqueur de conflit dans ce fichier : il est peut-être déjà résolu (indexe-le).')

  const [operation, incoming, branch, base] = await Promise.all([
    operationInProgress(repoRoot),
    incomingRev(repoRoot),
    git(repoRoot, ['rev-parse', '--abbrev-ref', 'HEAD']),
    git(repoRoot, ['show', `:1:${path}`], { maxBuffer: MAX_CONFLICT_BYTES * 2 })
  ])
  const history = incoming
    ? await git(repoRoot, ['log', '--left-right', '-n', '12', '--format=%m %s', `HEAD...${incoming}`, '--', path])
    : null
  const sides = history?.stdout
    .split('\n')
    .filter(Boolean)
    .map((line) => (line.startsWith('<') ? `current (HEAD): ${line.slice(2)}` : `incoming: ${line.slice(2)}`))
    .join('\n')

  const prompt = [
    `File: ${path}`,
    operation ? `Operation: ${operation.label}` : '',
    `HEAD (the "current" side, between <<<<<<< and =======): ${branch.stdout.trim()}`,
    'The "incoming" side is between ======= and >>>>>>>.',
    sides ? `\nCommits touching this file on each side:\n${sides}` : '',
    base.ok && marked.length < 80_000 ? `\nCommon ancestor version of the file:\n<base>\n${base.stdout}\n</base>` : '',
    `\nFile with conflict markers:\n<conflicted>\n${marked}\n</conflicted>`
  ]
    .filter(Boolean)
    .join('\n')

  const answer = await askClaude({ prompt, system: RESOLVE_SYSTEM, model: RESOLVE_MODEL, cwd: repoRoot, timeoutMs: 300_000 })
  const start = answer.indexOf('<resolved>')
  const end = answer.lastIndexOf('</resolved>')
  if (start === -1 || end <= start) throw new Error('Réponse de Claude illisible : réessaie.')
  let content = answer.slice(start + '<resolved>'.length, end)
  if (content.startsWith('\r\n')) content = content.slice(2)
  else if (content.startsWith('\n')) content = content.slice(1)
  content = content.replace(/\r?\n$/, '')
  if (marked.endsWith('\n')) content += marked.includes('\r\n') ? '\r\n' : '\n'
  if (START_MARKER.test(content) || END_MARKER.test(content)) throw new Error('Claude a laissé des marqueurs de conflit : réessaie ou résous à la main.')
  const explanation = /<explanation>([\s\S]*?)<\/explanation>/.exec(answer)?.[1].trim() ?? ''
  return { path, content, explanation }
}
