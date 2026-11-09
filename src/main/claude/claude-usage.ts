import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { readFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join } from 'node:path'
import { net } from 'electron'
import type { ClaudeUsage, ClaudeUsageWindow } from '../../shared/types'

// Same endpoint and headers as Claude Code's /usage and Orca's rate-limit panel.
const USAGE_URL = 'https://api.anthropic.com/api/oauth/usage'
const TIMEOUT_MS = 10_000
/** Manual refreshes closer than this reuse the last answer (the endpoint is rate limited). */
const MIN_INTERVAL_MS = 15_000

const KEYCHAIN_SERVICE = 'Claude Code-credentials'

function configDir(): string | undefined {
  return process.env.CLAUDE_CONFIG_DIR || undefined
}

/** Claude 2.1+ suffixes its Keychain item with a hash of CLAUDE_CONFIG_DIR when that is set. */
function keychainService(dir: string | undefined): string {
  if (!dir) return KEYCHAIN_SERVICE
  return `${KEYCHAIN_SERVICE}-${createHash('sha256').update(dir.normalize('NFC')).digest('hex').slice(0, 8)}`
}

function readKeychain(service: string): Promise<string | null> {
  return new Promise((resolve) => {
    execFile('security', ['find-generic-password', '-s', service, '-w'], { timeout: 5000 }, (error, stdout) =>
      resolve(error ? null : String(stdout).trim() || null)
    )
  })
}

interface Credentials {
  token: string
  /** Epoch ms, when Claude Code recorded it. */
  expiresAt: number | null
}

function parseCredentials(raw: string | null): Credentials | null {
  if (!raw) return null
  try {
    const oauth = JSON.parse(raw)?.claudeAiOauth
    if (typeof oauth?.accessToken !== 'string' || !oauth.accessToken) return null
    return { token: oauth.accessToken, expiresAt: typeof oauth.expiresAt === 'number' ? oauth.expiresAt : null }
  } catch {
    return null
  }
}

/** Claude Code's OAuth login: macOS Keychain first, then the credentials file it uses elsewhere. */
async function readCredentials(): Promise<Credentials | null> {
  const dir = configDir()
  if (process.platform === 'darwin') {
    const fromKeychain =
      parseCredentials(await readKeychain(keychainService(dir))) ?? (dir ? parseCredentials(await readKeychain(KEYCHAIN_SERVICE)) : null)
    if (fromKeychain) return fromKeychain
  }
  const file = join(dir ?? join(homedir(), '.claude'), '.credentials.json')
  return parseCredentials(await readFile(file, 'utf8').catch(() => null))
}

type RawWindow = { utilization?: number; used_percentage?: number; resets_at?: string | number } | null | undefined

function resetTime(value: string | number | undefined): number | null {
  if (value === undefined || value === null || value === '') return null
  const numeric = Number(value)
  if (Number.isFinite(numeric)) return numeric > 10_000_000_000 ? numeric : numeric * 1000
  const parsed = new Date(value).getTime()
  return Number.isNaN(parsed) ? null : parsed
}

function toWindow(raw: RawWindow, label: string): ClaudeUsageWindow | null {
  const used = typeof raw?.utilization === 'number' ? raw.utilization : raw?.used_percentage
  if (typeof used !== 'number' || !Number.isFinite(used)) return null
  return { label, usedPercent: Math.min(100, Math.max(0, used)), resetsAt: resetTime(raw?.resets_at) }
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1)
}

interface RawUsage {
  five_hour?: RawWindow
  seven_day?: RawWindow
  limits?: { kind?: string; percent?: number; resets_at?: string | number; scope?: { model?: { display_name?: string } | null } | null }[] | null
  extra_usage?: { is_enabled?: boolean; utilization?: number | null } | null
  [key: string]: unknown
}

function mapUsage(data: RawUsage): Omit<ClaudeUsage, 'status' | 'fetchedAt' | 'error'> {
  const modelWeekly = new Map<string, ClaudeUsageWindow>()
  // Per-model weekly caps come either as `seven_day_<model>` fields or as scoped `limits`.
  for (const [key, value] of Object.entries(data)) {
    const match = /^seven_day_(\w+)$/.exec(key)
    if (!match || match[1] === 'oauth_apps') continue
    const window = toWindow(value as RawWindow, `${capitalize(match[1])} (sem.)`)
    if (window) modelWeekly.set(match[1].toLowerCase(), window)
  }
  for (const limit of data.limits ?? []) {
    const name = limit?.scope?.model?.display_name?.trim()
    if (limit?.kind !== 'weekly_scoped' || !name) continue
    const window = toWindow({ used_percentage: limit.percent, resets_at: limit.resets_at }, `${name} (sem.)`)
    if (window) modelWeekly.set(name.toLowerCase(), window)
  }
  const extra = data.extra_usage
  return {
    session: toWindow(data.five_hour, 'Session (5 h)'),
    weekly: toWindow(data.seven_day, 'Semaine'),
    weeklyByModel: [...modelWeekly.values()],
    extraUsagePercent: extra?.is_enabled && typeof extra.utilization === 'number' ? Math.min(100, Math.max(0, extra.utilization)) : null
  }
}

let last: ClaudeUsage | null = null
let inFlight: Promise<ClaudeUsage> | null = null

const empty = { session: null, weekly: null, weeklyByModel: [], extraUsagePercent: null }

async function fetchUsage(): Promise<ClaudeUsage> {
  // Screenshots and tests: a JSON file shaped like the API's answer, instead of the network.
  const fixture = process.env.CAPITAINE_USAGE_FIXTURE
  if (fixture) {
    const raw = await readFile(fixture, 'utf8').catch(() => null)
    if (raw) return { ...mapUsage(JSON.parse(raw) as RawUsage), status: 'ok', error: null, fetchedAt: Date.now() }
  }
  const credentials = await readCredentials()
  const fetchedAt = Date.now()
  if (!credentials) return { ...empty, status: 'no-credentials', error: null, fetchedAt }
  // The access token is only renewed by Claude Code itself; refreshing it here would rotate its login.
  if (credentials.expiresAt && credentials.expiresAt < fetchedAt) return { ...(last ?? empty), status: 'expired', error: null, fetchedAt }

  let response: Response
  try {
    response = await net.fetch(USAGE_URL, {
      headers: {
        Authorization: `Bearer ${credentials.token}`,
        'anthropic-beta': 'oauth-2025-04-20',
        'User-Agent': 'claude-code/2.1.0'
      },
      signal: AbortSignal.timeout(TIMEOUT_MS)
    })
  } catch (error) {
    return { ...(last ?? empty), status: 'error', error: error instanceof Error ? error.message : String(error), fetchedAt }
  }
  if (response.status === 401 || response.status === 403) return { ...(last ?? empty), status: 'expired', error: null, fetchedAt }
  if (response.status === 429) return { ...(last ?? empty), status: 'rate-limited', error: null, fetchedAt }
  if (!response.ok) return { ...(last ?? empty), status: 'error', error: `HTTP ${response.status}`, fetchedAt }
  try {
    return { ...mapUsage((await response.json()) as RawUsage), status: 'ok', error: null, fetchedAt }
  } catch {
    return { ...(last ?? empty), status: 'error', error: 'Réponse illisible', fetchedAt }
  }
}

/** Claude subscription usage (5-hour session, weekly, per-model weekly). Never exposes the token. */
export function claudeUsage(force: boolean): Promise<ClaudeUsage> {
  if (inFlight) return inFlight
  if (last && Date.now() - last.fetchedAt < (force ? MIN_INTERVAL_MS : 60_000)) return Promise.resolve(last)
  inFlight = fetchUsage().then((result) => {
    // Keep the last good numbers visible behind a transient failure.
    if (result.status === 'ok' || !last) last = result
    else last = { ...last, status: result.status, error: result.error, fetchedAt: result.fetchedAt }
    return last
  })
  return inFlight.finally(() => {
    inFlight = null
  })
}
