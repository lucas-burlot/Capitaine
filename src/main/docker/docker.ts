import { execFile, spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { delimiter, join } from 'node:path'
import type { DockerAction, DockerContainer, DockerHealth, DockerListResult, DockerPort, DockerState } from '../../shared/types'
import { loginShellPath } from '../system/shell'

/**
 * Read-mostly view of the local Docker engine through the `docker` CLI: it already knows the
 * user's context (Docker Desktop, Colima, rootless socket…), which talking to the socket would not.
 */

interface DockerCli {
  file: string
  env: NodeJS.ProcessEnv
}

let resolved: Promise<DockerCli | null> | null = null

/** Where installers put the CLI when the PATH a GUI app gets doesn't include it. */
const FALLBACK_DIRS =
  process.platform === 'win32'
    ? [join(process.env.ProgramFiles ?? 'C:\\Program Files', 'Docker', 'Docker', 'resources', 'bin')]
    : ['/usr/local/bin', '/opt/homebrew/bin', '/usr/bin', '/Applications/Docker.app/Contents/Resources/bin']

function resolveDocker(): Promise<DockerCli | null> {
  resolved ??= (async () => {
    const login = await loginShellPath()
    const pathValue = [login, process.env.PATH ?? process.env.Path ?? ''].filter(Boolean).join(delimiter)
    const name = process.platform === 'win32' ? 'docker.exe' : 'docker'
    const file = [...pathValue.split(delimiter), ...FALLBACK_DIRS].map((dir) => dir && join(dir, name)).find((p) => p && existsSync(p))
    if (!file) return null
    const env: NodeJS.ProcessEnv = {}
    for (const [key, value] of Object.entries(process.env)) if (value !== undefined && !key.startsWith('ELECTRON_')) env[key] = value
    // Credential helpers and compose plugins are looked up on PATH.
    env.PATH = pathValue
    return { file, env }
  })()
  return resolved.then((value) => {
    if (!value) resolved = null // installed later: look again next time
    return value
  })
}

interface RunResult {
  ok: boolean
  stdout: string
  stderr: string
}

function run(cli: DockerCli, args: string[], timeout = 10_000): Promise<RunResult> {
  return new Promise((resolve) => {
    execFile(cli.file, args, { env: cli.env, timeout, windowsHide: true, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) =>
      resolve({ ok: !error, stdout: String(stdout), stderr: String(stderr || (error && !stdout ? error.message : '')) })
    )
  })
}

function errorText(result: RunResult, fallback: string): string {
  const text = result.stderr.trim().split('\n').slice(0, 4).join('\n')
  return text || fallback
}

// One JSON object per container. Labels are read one by one: the `.Labels` string can't be split
// reliably (values contain commas).
const PS_FORMAT = `{${[
  '"id":{{json .ID}}',
  '"name":{{json .Names}}',
  '"image":{{json .Image}}',
  '"state":{{json .State}}',
  '"status":{{json .Status}}',
  '"ports":{{json .Ports}}',
  '"createdAt":{{json .CreatedAt}}',
  '"composeProject":{{json (.Label "com.docker.compose.project")}}',
  '"composeService":{{json (.Label "com.docker.compose.service")}}',
  '"composeDir":{{json (.Label "com.docker.compose.project.working_dir")}}'
].join(',')}}`

const STATES: DockerState[] = ['running', 'paused', 'restarting', 'created', 'exited', 'dead', 'removing']

function stateOf(state: unknown, status: string): DockerState {
  if (typeof state === 'string' && (STATES as string[]).includes(state)) return state as DockerState
  // Old engines don't report `.State`: read it from the status text.
  if (/^Up\b/.test(status)) return /\(Paused\)/.test(status) ? 'paused' : 'running'
  if (/^Restarting\b/.test(status)) return 'restarting'
  if (/^Created\b/.test(status)) return 'created'
  if (/^Dead\b/.test(status)) return 'dead'
  return 'exited'
}

function healthOf(status: string): DockerHealth {
  if (/\(healthy\)/.test(status)) return 'healthy'
  if (/\(unhealthy\)/.test(status)) return 'unhealthy'
  if (/\(health: starting\)/.test(status)) return 'starting'
  return null
}

/** `0.0.0.0:3003->3000/tcp, [::]:3003->3000/tcp, 9000/tcp` → one entry per distinct mapping. */
export function parsePorts(text: string): DockerPort[] {
  const ports: DockerPort[] = []
  const seen = new Set<string>()
  for (const part of text.split(',')) {
    const match = /(?:^|:)(\d+)(?:-\d+)?->(\d+)(?:-\d+)?\/(\w+)$/.exec(part.trim()) ?? /^(\d+)(?:-\d+)?\/(\w+)$/.exec(part.trim())
    if (!match) continue
    const port: DockerPort =
      match.length === 4
        ? { host: Number(match[1]), container: Number(match[2]), protocol: match[3] }
        : { host: null, container: Number(match[1]), protocol: match[2] }
    const key = `${port.host}:${port.container}/${port.protocol}`
    if (seen.has(key)) continue
    seen.add(key)
    ports.push(port)
  }
  return ports
}

function toContainer(line: string): DockerContainer | null {
  try {
    const raw = JSON.parse(line) as Record<string, unknown>
    const text = (key: string) => (typeof raw[key] === 'string' ? (raw[key] as string) : '')
    const optional = (key: string) => text(key) || null
    const status = text('status')
    return {
      id: text('id'),
      name: text('name').split(',')[0],
      image: text('image'),
      state: stateOf(raw.state, status),
      health: healthOf(status),
      status,
      ports: parsePorts(text('ports')),
      composeProject: optional('composeProject'),
      composeService: optional('composeService'),
      composeDir: optional('composeDir'),
      createdAt: text('createdAt')
    }
  } catch {
    return null
  }
}

export async function listContainers(): Promise<DockerListResult> {
  const cli = await resolveDocker()
  if (!cli) return { ok: false, reason: 'missing', message: 'La commande docker est introuvable.' }
  const result = await run(cli, ['ps', '--all', '--no-trunc', '--format', PS_FORMAT])
  if (!result.ok) return { ok: false, reason: 'daemon', message: errorText(result, 'Docker ne répond pas.') }
  const containers = result.stdout
    .split('\n')
    .filter((line) => line.trim())
    .map(toContainer)
    .filter((c): c is DockerContainer => !!c && !!c.id)
  return { ok: true, containers }
}

const ID_PATTERN = /^[a-f0-9]{12,64}$/

export async function containerAction(id: string, action: DockerAction): Promise<void> {
  if (!ID_PATTERN.test(id)) throw new Error('Identifiant de conteneur invalide')
  if (action !== 'start' && action !== 'stop' && action !== 'restart') throw new Error('Action inconnue')
  const cli = await resolveDocker()
  if (!cli) throw new Error('La commande docker est introuvable.')
  // `stop` waits up to 10 s for the process before killing it.
  const result = await run(cli, [action, id], 60_000)
  if (!result.ok) throw new Error(errorText(result, `docker ${action} a échoué`))
}

const ANSI = /\x1b\[[0-9;?]*[ -/]*[@-~]/g

/** stdout and stderr merged in arrival order, colour codes stripped. */
export async function containerLogs(id: string, tail: number): Promise<string> {
  if (!ID_PATTERN.test(id)) throw new Error('Identifiant de conteneur invalide')
  const cli = await resolveDocker()
  if (!cli) throw new Error('La commande docker est introuvable.')
  const lines = Math.min(Math.max(Math.floor(tail) || 200, 1), 2000)
  return new Promise((resolve, reject) => {
    const child = spawn(cli.file, ['logs', '--tail', String(lines), id], { env: cli.env, windowsHide: true })
    const chunks: Buffer[] = []
    let size = 0
    const collect = (chunk: Buffer) => {
      if (size > 4 * 1024 * 1024) return
      size += chunk.length
      chunks.push(chunk)
    }
    child.stdout.on('data', collect)
    child.stderr.on('data', collect)
    const timer = setTimeout(() => child.kill(), 10_000)
    child.on('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
    child.on('close', (code) => {
      clearTimeout(timer)
      const text = Buffer.concat(chunks).toString('utf8').replace(ANSI, '')
      if (code === 0) resolve(text)
      else reject(new Error(text.trim().split('\n').slice(-3).join('\n') || 'docker logs a échoué'))
    })
  })
}
