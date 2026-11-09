import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ChevronRight, LoaderCircle, Play, RotateCw, ScrollText, Square, TriangleAlert, X } from 'lucide-react'
import type { DockerContainer, Project } from '@shared/types'
import { belongsTo, cleanIpcError, useDocker } from './docker-store'

const POLL_MS = 3000
const LOG_LINES = 300

interface Group {
  key: string
  title: string
  containers: DockerContainer[]
  /** The group tied to the open project. */
  current: boolean
}

/** Every container on the machine: the open project's first, then by compose project. */
export function DockerPanel({ project }: { project: Project }) {
  const result = useDocker((s) => s.result)
  const actionError = useDocker((s) => s.actionError)
  useDockerPolling()

  if (result === undefined) return <p className="px-3 py-3 text-[12px] text-faint">Lecture de Docker…</p>
  if (!result.ok) {
    return (
      <div className="px-3 py-3 text-[12px] leading-relaxed text-faint">
        {result.reason === 'missing' ? (
          <p>Docker n’est pas installé (commande <code className="text-muted">docker</code> introuvable).</p>
        ) : (
          <>
            <p className="mb-1.5 text-muted">Docker ne répond pas. Le moteur est-il démarré ?</p>
            <p className="break-words whitespace-pre-wrap">{result.message}</p>
          </>
        )}
      </div>
    )
  }

  const groups = groupContainers(result.containers, project.path)
  const running = result.containers.filter((c) => c.state === 'running').length
  return (
    <div className="min-h-0 flex-1 overflow-auto pb-2" aria-label="Conteneurs Docker">
      <p className="px-3 pt-2 pb-1 text-[11px] text-faint">
        {result.containers.length === 0
          ? 'Aucun conteneur sur cette machine.'
          : `${running} en cours · ${result.containers.length - running} arrêté${result.containers.length - running > 1 ? 's' : ''}`}
      </p>
      {actionError && (
        <div className="mx-2 mb-1 flex gap-1.5 rounded border border-red-500/30 bg-red-500/10 px-2 py-1.5 text-[11.5px] text-red-300">
          <TriangleAlert size={12} className="mt-0.5 shrink-0" />
          <span className="min-w-0 flex-1 break-words whitespace-pre-wrap">{actionError}</span>
          <button title="Fermer" onClick={() => useDocker.getState().dismissError()} className="shrink-0 self-start rounded hover:text-red-200">
            <X size={12} />
          </button>
        </div>
      )}
      {groups.map((group) => (
        <GroupSection key={group.key} group={group} defaultOpen={group.current || !groups.some((g) => g.current)} />
      ))}
    </div>
  )
}

function groupContainers(containers: DockerContainer[], projectPath: string): Group[] {
  const current: DockerContainer[] = []
  const byProject = new Map<string, DockerContainer[]>()
  const loose: DockerContainer[] = []
  for (const container of containers) {
    if (belongsTo(container, projectPath)) current.push(container)
    else if (container.composeProject) byProject.set(container.composeProject, [...(byProject.get(container.composeProject) ?? []), container])
    else loose.push(container)
  }
  const groups: Group[] = []
  if (current.length) groups.push({ key: ':current', title: 'Ce projet', containers: sortContainers(current), current: true })
  for (const name of [...byProject.keys()].sort((a, b) => a.localeCompare(b))) {
    groups.push({ key: `compose:${name}`, title: name, containers: sortContainers(byProject.get(name)!), current: false })
  }
  if (loose.length) groups.push({ key: ':loose', title: 'Autres conteneurs', containers: sortContainers(loose), current: false })
  return groups
}

/** Running ones first, then by name. */
function sortContainers(containers: DockerContainer[]): DockerContainer[] {
  const rank = (c: DockerContainer) => (c.state === 'running' ? 0 : c.state === 'restarting' || c.state === 'paused' ? 1 : 2)
  return [...containers].sort((a, b) => rank(a) - rank(b) || displayName(a).localeCompare(displayName(b)))
}

function displayName(container: DockerContainer): string {
  return container.composeService ?? container.name
}

function GroupSection({ group, defaultOpen }: { group: Group; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen)
  const running = group.containers.filter((c) => c.state === 'running').length
  return (
    <section className="mb-1">
      <div
        role="button"
        onClick={() => setOpen(!open)}
        title={group.current ? 'Conteneurs lancés depuis le dossier de ce projet (docker compose)' : undefined}
        className="flex h-6 cursor-pointer items-center gap-1 pr-2 pl-2 text-[11px] font-semibold tracking-wider text-muted uppercase hover:text-fg"
      >
        <ChevronRight size={12} className={`shrink-0 transition-transform ${open ? 'rotate-90' : ''}`} />
        <span className={`flex-1 truncate ${group.current ? 'text-accent' : ''}`}>{group.title}</span>
        <span
          className="ml-1 rounded-full bg-line px-1.5 text-[10px] font-medium tracking-normal text-muted tabular-nums"
          title={`${running} en cours sur ${group.containers.length}`}
        >
          {running}/{group.containers.length}
        </span>
      </div>
      {open && group.containers.map((container) => <ContainerRow key={container.id} container={container} />)}
    </section>
  )
}

function ContainerRow({ container }: { container: DockerContainer }) {
  const busy = useDocker((s) => s.busy[container.id])
  const [logsOpen, setLogsOpen] = useState(false)
  const act = useDocker.getState().act
  const look = statusLook(container)
  const published = container.ports.filter((p) => p.host !== null && p.protocol === 'tcp')
  const tooltip = [
    container.name,
    `Image : ${container.image}`,
    `Statut : ${container.status}`,
    container.ports.length ? `Ports : ${container.ports.map(portLabel).join(', ')}` : null
  ]
    .filter(Boolean)
    .join('\n')

  return (
    <>
      <div
        role="button"
        onClick={() => setLogsOpen(!logsOpen)}
        title={`${tooltip}\nClic : afficher les logs`}
        className={`group flex h-[24px] cursor-pointer items-center gap-1.5 pr-2 pl-5 text-[12.5px] ${
          logsOpen ? 'bg-panel-2 text-fg' : 'text-muted hover:bg-panel-2/60 hover:text-fg'
        } ${busy ? 'opacity-60' : ''}`}
      >
        <span className={`size-2 shrink-0 rounded-full ${look.dot}`} aria-label={look.label} />
        <span className={`min-w-0 shrink truncate ${container.state === 'running' ? 'text-fg' : ''}`}>{displayName(container)}</span>
        <span className="min-w-0 flex-1 truncate text-[11px] text-faint">{container.image}</span>
        {busy ? (
          <span className="flex shrink-0 items-center gap-1 text-[11px] text-faint">
            <LoaderCircle size={12} className="animate-spin" />
            {BUSY_LABEL[busy]}
          </span>
        ) : (
          <>
            <span className="flex shrink-0 items-center gap-1 group-hover:hidden">
              {published.slice(0, 2).map((port) => (
                <span key={`${port.host}:${port.container}`} className="rounded bg-line px-1 text-[10px] text-muted tabular-nums">
                  :{port.host}
                </span>
              ))}
              {published.length > 2 && <span className="text-[10px] text-faint">+{published.length - 2}</span>}
              <span className={`text-[11px] tabular-nums ${look.text}`}>{look.label}</span>
            </span>
            <span className="hidden shrink-0 items-center gap-0.5 group-hover:flex">
              {published.slice(0, 3).map((port) => (
                <RowAction key={`${port.host}:${port.container}`} title={`Ouvrir http://localhost:${port.host}`} onClick={() => window.open(`http://localhost:${port.host}`)}>
                  <span className="px-0.5 text-[10px] tabular-nums">:{port.host}</span>
                </RowAction>
              ))}
              {container.state === 'running' || container.state === 'restarting' ? (
                <RowAction title="Arrêter" onClick={() => void act(container.id, 'stop')}>
                  <Square size={12} />
                </RowAction>
              ) : (
                <RowAction title="Démarrer" onClick={() => void act(container.id, 'start')}>
                  <Play size={12} />
                </RowAction>
              )}
              <RowAction title="Redémarrer" onClick={() => void act(container.id, 'restart')}>
                <RotateCw size={12} />
              </RowAction>
              <RowAction title={logsOpen ? 'Masquer les logs' : 'Afficher les logs'} onClick={() => setLogsOpen(!logsOpen)}>
                <ScrollText size={12} />
              </RowAction>
            </span>
          </>
        )}
      </div>
      {logsOpen && <ContainerLogs id={container.id} live={container.state === 'running'} />}
    </>
  )
}

const BUSY_LABEL = { start: 'démarrage', stop: 'arrêt', restart: 'redémarrage' } as const

function RowAction(props: { title: string; onClick(): void; children: React.ReactNode }) {
  return (
    <button
      title={props.title}
      onClick={(e) => {
        e.stopPropagation()
        props.onClick()
      }}
      className="rounded p-0.5 text-muted hover:bg-line hover:text-fg"
    >
      {props.children}
    </button>
  )
}

/** The container's last lines, re-read while it runs and the window has focus. */
function ContainerLogs({ id, live }: { id: string; live: boolean }) {
  const [text, setText] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const pre = useRef<HTMLPreElement>(null)
  // Follow the end unless the user scrolled up to read.
  const stick = useRef(true)

  useEffect(() => {
    let cancelled = false
    const load = () =>
      window.capitaine.docker.logs(id, LOG_LINES).then(
        (logs) => {
          if (cancelled) return
          setText(logs)
          setError(null)
        },
        (err) => !cancelled && setError(cleanIpcError(err))
      )
    void load()
    const timer = live ? setInterval(() => document.hasFocus() && void load(), POLL_MS) : undefined
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [id, live])

  useLayoutEffect(() => {
    const el = pre.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [text])

  return (
    <div className="mx-2 mt-0.5 mb-1.5 overflow-hidden rounded border border-line bg-bg">
      {error ? (
        <p className="px-2 py-1.5 text-[11px] break-words text-red-300">{error}</p>
      ) : text === null ? (
        <p className="px-2 py-1.5 text-[11px] text-faint">Lecture des logs…</p>
      ) : (
        <pre
          ref={pre}
          onScroll={(e) => {
            const el = e.currentTarget
            stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 8
          }}
          className="max-h-64 overflow-auto px-2 py-1.5 font-mono text-[10.5px] leading-[1.45] break-all whitespace-pre-wrap text-muted select-text"
        >
          {text.trim() || 'Aucun log.'}
        </pre>
      )}
    </div>
  )
}

function portLabel(port: DockerContainer['ports'][number]): string {
  return port.host === null ? `${port.container}/${port.protocol}` : `${port.host}→${port.container}/${port.protocol}`
}

/** Dot colour and a short French status (Docker's own wording stays in the tooltip). */
function statusLook(container: DockerContainer): { dot: string; text: string; label: string } {
  const since = shortDuration(container.status)
  switch (container.state) {
    case 'running':
      if (container.health === 'unhealthy') return { dot: 'bg-red-400', text: 'text-red-300', label: 'malsain' }
      if (container.health === 'starting') return { dot: 'bg-amber-400 animate-pulse', text: 'text-amber-300', label: 'démarre' }
      return { dot: 'bg-emerald-400', text: 'text-faint', label: since ?? 'actif' }
    case 'paused':
      return { dot: 'bg-amber-400', text: 'text-amber-300', label: 'en pause' }
    case 'restarting':
      return { dot: 'bg-amber-400 animate-pulse', text: 'text-amber-300', label: 'redémarre' }
    case 'created':
      return { dot: 'bg-faint', text: 'text-faint', label: 'créé' }
    case 'removing':
      return { dot: 'bg-faint animate-pulse', text: 'text-faint', label: 'suppression' }
    case 'dead':
      return { dot: 'bg-red-400', text: 'text-red-300', label: 'mort' }
    default: {
      const code = Number(/Exited \((-?\d+)\)/.exec(container.status)?.[1] ?? 0)
      // 0: clean exit; 130/143: stopped by a signal on purpose (Ctrl+C, docker stop).
      const clean = code === 0 || code === 130 || code === 143
      return clean
        ? { dot: 'bg-faint', text: 'text-faint', label: since ? `arrêté · ${since}` : 'arrêté' }
        : { dot: 'bg-red-400', text: 'text-red-300', label: `code ${code}` }
    }
  }
}

const UNITS: Record<string, string> = { second: 's', minute: 'min', hour: 'h', day: 'j', week: 'sem', month: 'mois', year: 'an' }

/** `Up 6 days (healthy)` → `6 j`, `Exited (0) About an hour ago` → `1 h`. */
function shortDuration(status: string): string | null {
  if (/Less than a second/i.test(status)) return '< 1 s'
  const about = /About an? (second|minute|hour|day|week|month|year)/i.exec(status)
  if (about) return `1 ${UNITS[about[1].toLowerCase()]}`
  const match = /(\d+) (second|minute|hour|day|week|month|year)s?/i.exec(status)
  return match ? `${match[1]} ${UNITS[match[2].toLowerCase()]}` : null
}

/** Re-reads the containers while the Docker view is on screen and the window has focus. */
function useDockerPolling() {
  useEffect(() => {
    const refresh = () => void useDocker.getState().refresh()
    refresh()
    const timer = setInterval(() => document.hasFocus() && refresh(), POLL_MS)
    window.addEventListener('focus', refresh)
    return () => {
      clearInterval(timer)
      window.removeEventListener('focus', refresh)
    }
  }, [])
}
