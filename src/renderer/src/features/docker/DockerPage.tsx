import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Container, ExternalLink, LoaderCircle, Play, RotateCw, Square, TriangleAlert, X } from 'lucide-react'
import type { DockerContainer, Project } from '@shared/types'
import { usePanels } from '@/app/panels-store'
import { PageListRow, PageMessage, PageShell, PageSplit, PrimaryButton, Property, TextButton, useListKeys } from '@/ui/Page'
import { SectionHeader } from '@/ui/SectionHeader'
import { belongsTo, cleanIpcError, useDocker } from './docker-store'

const POLL_MS = 3000
const LOG_LINES = 500

interface Group {
  key: string
  title: string
  tooltip: string
  containers: DockerContainer[]
  /** The group tied to the open project. */
  current: boolean
}

/** Every container on the machine (the open project's first) with its details and live logs. */
export function DockerPage({ project }: { project: Project }) {
  const result = useDocker((s) => s.result)
  const refreshing = useDocker((s) => s.refreshing)
  const actionError = useDocker((s) => s.actionError)
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  useDockerPolling()

  const containers = result?.ok ? result.containers : null
  const groups = useMemo(() => groupContainers(filterContainers(containers ?? [], query), project.path), [containers, query, project.path])
  const visible = groups.flatMap((g) => g.containers)
  const selected = visible.find((c) => c.id === selectedId) ?? visible[0] ?? null
  const close = useCallback(() => usePanels.getState().setPage(null), [])
  useListKeys(
    visible.map((c) => c.id),
    selected?.id ?? null,
    setSelectedId
  )

  const running = containers?.filter((c) => c.state === 'running').length ?? 0
  const subtitle = containers ? (containers.length === 0 ? 'aucun conteneur' : `${running} en cours sur ${containers.length}`) : undefined

  return (
    <PageShell
      label="Conteneurs Docker"
      icon={<Container size={14} />}
      title="Docker"
      subtitle={subtitle}
      query={query}
      onQueryChange={setQuery}
      placeholder="Filtrer les conteneurs"
      refreshing={refreshing}
      onRefresh={() => void useDocker.getState().refresh()}
      onClose={close}
      toolbar={actionError ? <ErrorBand message={actionError} /> : undefined}
    >
      {result === undefined ? (
        <p className="px-4 py-3 text-[12px] text-muted">Lecture de Docker…</p>
      ) : !result.ok ? (
        result.reason === 'missing' ? (
          <PageMessage title="Docker n’est pas installé">
            <p className="mt-2 text-[13px] leading-relaxed text-muted">
              La commande <code className="rounded bg-panel-2 px-1.5 py-0.5 font-mono text-[11.5px] text-fg/90">docker</code> est introuvable sur cette machine.
            </p>
          </PageMessage>
        ) : (
          <PageMessage title="Docker ne répond pas">
            <p className="mt-2 text-[13px] leading-relaxed text-muted">Le moteur est-il démarré ?</p>
            <p className="mt-3 text-[12px] leading-relaxed break-words whitespace-pre-wrap text-muted/80 select-text">{result.message}</p>
          </PageMessage>
        )
      ) : result.containers.length === 0 ? (
        <PageMessage title="Aucun conteneur sur cette machine">
          <p className="mt-2 text-[13px] leading-relaxed text-muted">
            Ceux que tu lances (par exemple avec <code className="rounded bg-panel-2 px-1.5 py-0.5 font-mono text-[11.5px] text-fg/90">docker compose up</code>) apparaissent ici.
          </p>
        </PageMessage>
      ) : groups.length === 0 ? (
        <PageMessage title="Aucun résultat">
          <p className="mt-2 text-[13px] text-muted">
            Aucun conteneur ne correspond à « <span className="text-fg">{query}</span> ».
          </p>
          <button onClick={() => setQuery('')} className="mt-3 rounded-md px-2.5 py-1.5 text-[12.5px] text-accent hover:bg-panel-2">
            Effacer le filtre
          </button>
        </PageMessage>
      ) : (
        <PageSplit
          storageKey="capitaine.dockerListWidth"
          listLabel="Conteneurs"
          list={groups.map((group) => (
            <GroupSection key={group.key} group={group} selectedId={selected?.id ?? null} onSelect={setSelectedId} />
          ))}
          detail={selected ? <ContainerDetail key={selected.id} container={selected} projectPath={project.path} /> : null}
        />
      )}
    </PageShell>
  )
}

function ErrorBand({ message }: { message: string }) {
  return (
    <div className="flex shrink-0 gap-2 border-b border-red-500/25 bg-red-500/[0.08] px-4 py-2 text-[12px] text-red-200">
      <TriangleAlert size={13} className="mt-0.5 shrink-0" />
      <span className="min-w-0 flex-1 break-words whitespace-pre-wrap select-text">{message}</span>
      <button title="Fermer" onClick={() => useDocker.getState().dismissError()} className="shrink-0 self-start rounded text-red-300 hover:text-red-100">
        <X size={13} />
      </button>
    </div>
  )
}

function GroupSection({ group, selectedId, onSelect }: { group: Group; selectedId: string | null; onSelect(id: string): void }) {
  const [open, setOpen] = useState(true)
  const running = group.containers.filter((c) => c.state === 'running').length
  return (
    <section className="mb-2">
      <SectionHeader
        open={open}
        onToggle={() => setOpen(!open)}
        title={group.title}
        count={`${running}/${group.containers.length}`}
        highlight={group.current}
        tooltip={group.tooltip}
      />
      {open &&
        group.containers.map((container) => {
          const active = container.id === selectedId
          const look = statusLook(container)
          return (
            <PageListRow key={container.id} id={container.id} active={active} title={container.name} onSelect={() => onSelect(container.id)}>
              <div className="flex items-center gap-2">
                <span className={`size-2 shrink-0 rounded-full ${look.dot}`} aria-hidden />
                <span className={`min-w-0 flex-1 truncate text-[12.5px] leading-[18px] ${active ? 'font-medium text-fg' : 'text-fg/85'}`}>{displayName(container)}</span>
                <span className={`shrink-0 text-[11px] tabular-nums ${look.text}`}>{look.label}</span>
              </div>
              <div className="truncate pl-4 text-[11.5px] leading-4 text-muted">{container.image}</div>
            </PageListRow>
          )
        })}
    </section>
  )
}

function ContainerDetail({ container, projectPath }: { container: DockerContainer; projectPath: string }) {
  const busy = useDocker((s) => s.busy[container.id])
  const act = useDocker.getState().act
  const look = statusLook(container)
  const up = container.state === 'running' || container.state === 'restarting'
  const published = container.ports.filter((p) => p.host !== null && p.protocol === 'tcp')
  const code = 'rounded bg-panel-2 px-1.5 py-0.5 font-mono text-[11.5px] text-fg/90'

  return (
    <article className="flex min-h-full max-w-[1100px] flex-col px-8 pt-7 pb-8">
      <h2 className="text-[20px] leading-tight font-semibold tracking-[-0.01em] break-words text-fg select-text">{displayName(container)}</h2>
      <p className="mt-2 flex items-center gap-2 text-[13px] text-muted">
        <span className={`size-2 shrink-0 rounded-full ${look.dot}`} aria-hidden />
        <span className={look.text === 'text-faint' ? 'text-muted' : look.text}>{stateSentence(container)}</span>
      </p>

      <div className="mt-5 flex flex-wrap items-center gap-1.5">
        {busy ? (
          <PrimaryButton onClick={() => {}} disabled>
            <LoaderCircle size={13} className="animate-spin" />
            {BUSY_LABEL[busy]}
          </PrimaryButton>
        ) : up ? (
          <PrimaryButton onClick={() => void act(container.id, 'stop')}>
            <Square size={12} />
            Arrêter
          </PrimaryButton>
        ) : (
          <PrimaryButton onClick={() => void act(container.id, 'start')}>
            <Play size={12} />
            Démarrer
          </PrimaryButton>
        )}
        <TextButton onClick={() => void act(container.id, 'restart')} disabled={!!busy}>
          <RotateCw size={12} />
          Redémarrer
        </TextButton>
        {published.slice(0, 4).map((port) => (
          <TextButton key={`${port.host}:${port.container}`} onClick={() => window.open(`http://localhost:${port.host}`)}>
            <ExternalLink size={12} />
            localhost:{port.host}
          </TextButton>
        ))}
      </div>

      <dl className="mt-7 border-t border-line text-[12px]">
        <Property label="Image">
          <span className="font-mono text-[11.5px] break-all">{container.image}</span>
        </Property>
        {container.composeService && <Property label="Conteneur">{container.name}</Property>}
        {container.composeProject && (
          <Property label="Compose">
            {container.composeProject}
            {container.composeService && <span className="text-muted"> · service {container.composeService}</span>}
          </Property>
        )}
        {container.composeDir && (
          <Property label="Dossier">
            <span className="font-mono text-[11.5px] break-all">{relativeTo(container.composeDir, projectPath)}</span>
          </Property>
        )}
        <Property label="Ports">
          {container.ports.length === 0 ? (
            <span className="text-muted">Aucun</span>
          ) : (
            <span className="flex flex-wrap gap-1">
              {container.ports.map((port) => (
                <code key={`${port.host}:${port.container}/${port.protocol}`} className={code}>
                  {portLabel(port)}
                </code>
              ))}
            </span>
          )}
        </Property>
        <Property label="Statut Docker">{container.status}</Property>
        <Property label="Créé">{container.createdAt}</Property>
        <Property label="ID">
          <span className="font-mono text-[11.5px]">{container.id.slice(0, 12)}</span>
        </Property>
      </dl>

      <ContainerLogs id={container.id} live={container.state === 'running'} />
    </article>
  )
}

const BUSY_LABEL = { start: 'Démarrage…', stop: 'Arrêt…', restart: 'Redémarrage…' } as const

/** The container's last lines, re-read while it runs and the window has focus. Follows the end unless you scroll up. */
function ContainerLogs({ id, live }: { id: string; live: boolean }) {
  const [text, setText] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const pre = useRef<HTMLPreElement>(null)
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
    <section className="mt-9 flex min-h-[280px] flex-1 flex-col">
      <h3 className="mb-2.5 flex items-center gap-2 text-[11px] font-semibold tracking-wider text-muted uppercase">
        Logs
        {live && (
          <span className="flex items-center gap-1.5 font-normal tracking-normal normal-case">
            <span className="size-1.5 rounded-full bg-emerald-400" aria-hidden />
            en direct
          </span>
        )}
        <span className="ml-auto font-normal tracking-normal normal-case">{LOG_LINES} dernières lignes</span>
      </h3>
      <div className="flex min-h-0 flex-1 overflow-hidden rounded-md border border-line bg-panel">
        {error ? (
          <p className="px-4 py-3 text-[12px] break-words text-red-300 select-text">{error}</p>
        ) : text === null ? (
          <p className="px-4 py-3 text-[12px] text-muted">Lecture des logs…</p>
        ) : (
          <pre
            ref={pre}
            onScroll={(e) => {
              const el = e.currentTarget
              stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 8
            }}
            className="scrollbar-sleek max-h-[70vh] min-h-0 flex-1 overflow-auto px-4 py-3 font-mono text-[11.5px] leading-[1.55] break-all whitespace-pre-wrap text-muted select-text"
          >
            {text.trim() || 'Aucun log.'}
          </pre>
        )}
      </div>
    </section>
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
  if (current.length) {
    groups.push({ key: ':current', title: 'Ce projet', tooltip: 'Conteneurs lancés depuis le dossier de ce projet (docker compose)', containers: sortContainers(current), current: true })
  }
  for (const name of [...byProject.keys()].sort((a, b) => a.localeCompare(b))) {
    groups.push({ key: `compose:${name}`, title: name, tooltip: `Projet compose ${name}`, containers: sortContainers(byProject.get(name)!), current: false })
  }
  if (loose.length) groups.push({ key: ':loose', title: 'Autres conteneurs', tooltip: 'Lancés hors docker compose', containers: sortContainers(loose), current: false })
  return groups
}

function filterContainers(containers: DockerContainer[], query: string): DockerContainer[] {
  const needle = query.trim().toLowerCase()
  if (!needle) return containers
  return containers.filter((c) =>
    [c.name, c.image, c.composeProject, c.composeService, ...c.ports.map((p) => String(p.host ?? p.container))].some((v) => v?.toLowerCase().includes(needle))
  )
}

/** Running ones first, then by name. */
function sortContainers(containers: DockerContainer[]): DockerContainer[] {
  const rank = (c: DockerContainer) => (c.state === 'running' ? 0 : c.state === 'restarting' || c.state === 'paused' ? 1 : 2)
  return [...containers].sort((a, b) => rank(a) - rank(b) || displayName(a).localeCompare(displayName(b)))
}

function displayName(container: DockerContainer): string {
  return container.composeService ?? container.name
}

function relativeTo(path: string, root: string): string {
  const clean = (p: string) => p.replace(/\\/g, '/').replace(/\/+$/, '')
  const [dir, base] = [clean(path), clean(root)]
  if (dir === base) return '. (dossier du projet)'
  return dir.startsWith(`${base}/`) ? dir.slice(base.length + 1) : path
}

function portLabel(port: DockerContainer['ports'][number]): string {
  return port.host === null ? `${port.container}/${port.protocol}` : `${port.host} → ${port.container}/${port.protocol}`
}

/** A sentence for the detail header, e.g. "Actif depuis 6 j". */
function stateSentence(container: DockerContainer): string {
  const since = shortDuration(container.status)
  switch (container.state) {
    case 'running':
      if (container.health === 'unhealthy') return 'Actif, mais le contrôle de santé échoue'
      if (container.health === 'starting') return 'En train de démarrer'
      return since ? `Actif depuis ${since}` : 'Actif'
    case 'paused':
      return 'En pause'
    case 'restarting':
      return 'En train de redémarrer'
    case 'created':
      return 'Créé, jamais démarré'
    case 'removing':
      return 'En cours de suppression'
    case 'dead':
      return 'Mort'
    default: {
      const code = Number(/Exited \((-?\d+)\)/.exec(container.status)?.[1] ?? 0)
      const clean = code === 0 || code === 130 || code === 143
      return `${clean ? 'Arrêté' : `Arrêté avec le code ${code}`}${since ? ` il y a ${since}` : ''}`
    }
  }
}

/** Dot colour and a short French status (Docker's own wording stays in the details). */
function statusLook(container: DockerContainer): { dot: string; text: string; label: string } {
  const since = shortDuration(container.status)
  switch (container.state) {
    case 'running':
      if (container.health === 'unhealthy') return { dot: 'bg-red-400', text: 'text-red-300', label: 'malsain' }
      if (container.health === 'starting') return { dot: 'bg-amber-400 animate-pulse', text: 'text-amber-300', label: 'démarre' }
      return { dot: 'bg-emerald-400', text: 'text-muted', label: since ?? 'actif' }
    case 'paused':
      return { dot: 'bg-amber-400', text: 'text-amber-300', label: 'en pause' }
    case 'restarting':
      return { dot: 'bg-amber-400 animate-pulse', text: 'text-amber-300', label: 'redémarre' }
    case 'created':
      return { dot: 'bg-faint', text: 'text-muted', label: 'créé' }
    case 'removing':
      return { dot: 'bg-faint animate-pulse', text: 'text-muted', label: 'suppression' }
    case 'dead':
      return { dot: 'bg-red-400', text: 'text-red-300', label: 'mort' }
    default: {
      const code = Number(/Exited \((-?\d+)\)/.exec(container.status)?.[1] ?? 0)
      // 0: clean exit; 130/143: stopped by a signal on purpose (Ctrl+C, docker stop).
      const clean = code === 0 || code === 130 || code === 143
      return clean ? { dot: 'bg-faint', text: 'text-muted', label: 'arrêté' } : { dot: 'bg-red-400', text: 'text-red-300', label: `code ${code}` }
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

/** Re-reads the containers while the page is on screen and the window has focus. */
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
