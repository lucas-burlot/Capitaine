import { useCallback, useEffect, useMemo, useState } from 'react'
import { Sparkles, TriangleAlert } from 'lucide-react'
import type { ClaudeConfig, ClaudeConfigItem, ClaudeConfigKind, Project } from '@shared/types'
import { usePanels } from '@/app/panels-store'
import { useApp } from '@/features/workspace/workspace-store'
import { PageListRow, PageMessage, PageShell, PageSplit, PrimaryButton, Property, TextButton, useListKeys } from '@/ui/Page'
import { SectionHeader } from '@/ui/SectionHeader'
import { useClaudeConfig } from './claude-config-store'

const POLL_MS = 5000
/** Beyond this the preview stops; the editor shows the rest. */
const PREVIEW_LINES = 600

const KINDS: { kind: ClaudeConfigKind; label: string; none: string; where: string; how: string }[] = [
  { kind: 'skill', label: 'Skills', none: 'Aucun skill', where: 'skills/<nom>/SKILL.md', how: 'Un skill est un dossier avec un SKILL.md, qui porte name et description en en-tête.' },
  { kind: 'agent', label: 'Agents', none: 'Aucun agent', where: 'agents/<nom>.md', how: 'Un agent est un fichier Markdown, avec name et description en en-tête (tools et model en option).' },
  { kind: 'command', label: 'Commands', none: 'Aucune command', where: 'commands/<nom>.md', how: 'Une command est un fichier Markdown, appelé ensuite avec /nom.' },
  { kind: 'rule', label: 'Rules', none: 'Aucune rule', where: 'rules/<nom>.md', how: 'Une rule est chargée à chaque session, ou seulement pour certains fichiers avec paths en en-tête.' },
  { kind: 'memory', label: 'Mémoire', none: 'Aucun CLAUDE.md', where: 'CLAUDE.md', how: 'Les instructions que Claude lit à chaque session, à la racine du projet ou dans ~/.claude/.' }
]

interface Group {
  key: string
  title: string
  tooltip: string
  items: ClaudeConfigItem[]
}

/**
 * Everything Claude Code loads for the project (skills, agents, commands, rules, CLAUDE.md), as a
 * page over the terminals: the list on the left, the selected file on the right.
 */
export function ClaudeConfigPage({ project }: { project: Project }) {
  const config = useClaudeConfig((s) => s.config[project.id])
  const error = useClaudeConfig((s) => s.error[project.id])
  const refreshing = useClaudeConfig((s) => !!s.refreshing[project.id])
  const [kind, setKind] = useState<ClaudeConfigKind>('skill')
  const [query, setQuery] = useState('')
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  useConfigPolling(project.id)

  const items = config?.items
  const counts = useMemo(() => countByKind(items ?? []), [items])
  const groups = useMemo(() => groupItems(filterItems(items ?? [], kind, query), project.name), [items, kind, query, project.name])
  const visible = groups.flatMap((g) => g.items)
  const selected = visible.find((item) => item.path === selectedPath) ?? visible[0] ?? null
  const kindInfo = KINDS.find((k) => k.kind === kind)!

  const close = useCallback(() => usePanels.getState().setPage(null), [])
  const openInEditor = (item: ClaudeConfigItem) => {
    close()
    useApp.getState().openFile(project.id, item.path)
  }
  useListKeys(
    visible.map((item) => item.path),
    selected?.path ?? null,
    setSelectedPath,
    selected ? () => openInEditor(selected) : undefined
  )

  const tabs = (
    <nav className="flex shrink-0 items-end gap-5 border-b border-line px-4" role="tablist" aria-label="Type de fichier">
      {KINDS.map((k) => {
        const active = kind === k.kind
        const empty = counts[k.kind] === 0
        return (
          <button
            key={k.kind}
            role="tab"
            aria-selected={active}
            onClick={() => setKind(k.kind)}
            className={`-mb-px flex h-9 items-center gap-1.5 border-b-2 text-[12.5px] transition-colors outline-none focus-visible:text-fg ${
              active ? 'border-accent text-fg' : `border-transparent hover:text-fg focus-visible:border-line ${empty ? 'text-muted/70' : 'text-muted'}`
            }`}
          >
            {k.label}
            <span className={`text-[11px] tabular-nums ${active ? 'text-accent' : 'text-muted/80'}`}>{counts[k.kind]}</span>
          </button>
        )
      })}
    </nav>
  )

  return (
    <PageShell
      label="Skills et agents Claude"
      icon={<Sparkles size={14} />}
      title="Skills et agents"
      subtitle={project.name}
      query={query}
      onQueryChange={setQuery}
      placeholder={`Filtrer les ${kindInfo.label.toLowerCase()}`}
      refreshing={refreshing}
      onRefresh={() => void useClaudeConfig.getState().refresh(project.id)}
      onClose={close}
      toolbar={tabs}
    >
      {!config ? (
        <p className="px-4 py-3 text-[12px] text-muted">{error ? `Lecture impossible : ${error}` : 'Lecture de la configuration Claude…'}</p>
      ) : counts[kind] === 0 ? (
        <EmptyKind info={kindInfo} />
      ) : groups.length === 0 ? (
        <NoMatch query={query} label={kindInfo.label.toLowerCase()} onClear={() => setQuery('')} />
      ) : (
        <PageSplit
          storageKey="capitaine.claudeListWidth"
          listLabel={kindInfo.label}
          list={groups.map((group) => (
            <GroupSection key={group.key} group={group} selected={selected} onSelect={(item) => setSelectedPath(item.path)} onOpen={openInEditor} />
          ))}
          detail={selected ? <ItemDetail key={selected.path} item={selected} config={config} project={project} onOpen={() => openInEditor(selected)} /> : null}
        />
      )}
    </PageShell>
  )
}

function GroupSection(props: {
  group: Group
  selected: ClaudeConfigItem | null
  onSelect(item: ClaudeConfigItem): void
  onOpen(item: ClaudeConfigItem): void
}) {
  const [open, setOpen] = useState(true)
  return (
    <section className="mb-2">
      <SectionHeader open={open} onToggle={() => setOpen(!open)} title={props.group.title} count={props.group.items.length} tooltip={props.group.tooltip} />
      {open &&
        props.group.items.map((item) => {
          const active = item.path === props.selected?.path
          return (
            <PageListRow
              key={item.path}
              id={item.path}
              active={active}
              dimmed={item.disabled}
              title="Double-clic : ouvrir dans l’éditeur"
              onSelect={() => props.onSelect(item)}
              onOpen={() => props.onOpen(item)}
            >
              <div className={`truncate text-[12.5px] leading-[18px] ${active ? 'font-medium text-fg' : 'text-fg/85'}`}>{shortName(item)}</div>
              {item.description && <div className="truncate text-[11.5px] leading-4 text-muted">{item.description}</div>}
            </PageListRow>
          )
        })}
    </section>
  )
}

function ItemDetail({ item, config, project, onOpen }: { item: ClaudeConfigItem; config: ClaudeConfig; project: Project; onOpen(): void }) {
  const body = useFileBody(project.id, item.path)
  const twin = config.items.find(
    (other) =>
      other !== item &&
      other.scope !== item.scope &&
      item.scope !== 'plugin' &&
      other.scope !== 'plugin' &&
      other.kind === item.kind &&
      other.name.toLowerCase() === item.name.toLowerCase()
  )
  const command = invocation(item)

  return (
    <article className="max-w-[880px] px-8 pt-7 pb-12">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h2 className="text-[20px] leading-tight font-semibold tracking-[-0.01em] break-words text-fg select-text">{item.name}</h2>
        {item.disabled && <span className="rounded-full border border-line px-2 py-px text-[11px] text-muted">Plugin désactivé</span>}
      </div>
      {item.description && <p className="mt-2 max-w-[70ch] text-[13px] leading-relaxed text-muted select-text">{item.description}</p>}

      <div className="mt-5 flex flex-wrap items-center gap-1.5">
        <PrimaryButton onClick={onOpen}>
          Ouvrir dans l’éditeur
          <kbd className="rounded bg-bg/15 px-1.5 py-px font-sans text-[10.5px]">Entrée</kbd>
        </PrimaryButton>
        <TextButton onClick={() => window.capitaine.files.reveal(project.id, item.path)}>Afficher dans le dossier</TextButton>
        <TextButton onClick={() => window.capitaine.files.copyText(item.path)}>Copier le chemin</TextButton>
      </div>

      {twin && (
        <p className="mt-5 flex max-w-[70ch] gap-2 rounded-md border border-amber-400/25 bg-amber-400/[0.07] px-3 py-2 text-[12px] leading-relaxed text-amber-200">
          <TriangleAlert size={13} className="mt-0.5 shrink-0" />
          <span>
            Le même nom existe aussi {twin.scope === 'user' ? 'dans tes fichiers globaux' : 'dans le projet'} (
            <span className="font-mono text-[11px]">{displayPath(twin.path, project.path, config.homeDir)}</span>) : un des deux masque l’autre.
          </span>
        </p>
      )}

      <dl className="mt-7 border-t border-line text-[12px]">
        {command && (
          <Property label="Appel">
            <code className="rounded bg-panel-2 px-1.5 py-0.5 font-mono text-[11.5px] text-accent">{command}</code>
          </Property>
        )}
        <Property label="Chargement">{loading(item)}</Property>
        {item.paths && (
          <Property label="Fichiers">
            <span className="flex flex-wrap gap-1">
              {item.paths.map((glob) => (
                <code key={glob} className="rounded bg-panel-2 px-1.5 py-0.5 font-mono text-[11.5px] text-fg/90">
                  {glob}
                </code>
              ))}
            </span>
          </Property>
        )}
        <Property label="Provenance">{sourceLabel(item, project.name)}</Property>
        <Property label="Fichier">
          <span className="font-mono text-[11.5px] break-all" title={item.path}>
            {displayPath(item.path, project.path, config.homeDir)}
          </span>
        </Property>
        {Object.entries(item.meta).map(([key, value]) => (
          <Property key={key} label={key}>
            {Array.isArray(value) ? value.join(', ') : value}
          </Property>
        ))}
      </dl>

      <h3 className="mt-9 mb-2.5 text-[11px] font-semibold tracking-wider text-muted uppercase">Contenu</h3>
      <div className="scrollbar-sleek overflow-x-auto rounded-md border border-line bg-panel px-5 py-4">
        {body === null ? <p className="text-[12px] text-muted">Lecture…</p> : <MarkdownSource text={body} onOpen={onOpen} />}
      </div>
    </article>
  )
}

/** Shown in place of the list when the project has none of this kind. */
function EmptyKind({ info }: { info: (typeof KINDS)[number] }) {
  const code = 'rounded bg-panel-2 px-1.5 py-0.5 font-mono text-[11.5px] text-fg/90'
  return (
    <PageMessage title={`${info.none} pour ce projet`}>
      <p className="mt-2 text-[13px] leading-relaxed text-muted">{info.how}</p>
      <p className="mt-4 text-[12px] leading-loose text-muted">
        Dans le projet : <code className={code}>{info.kind === 'memory' ? info.where : `.claude/${info.where}`}</code>
        <br />
        Pour tous tes projets : <code className={code}>~/.claude/{info.where}</code>
      </p>
    </PageMessage>
  )
}

function NoMatch({ query, label, onClear }: { query: string; label: string; onClear(): void }) {
  return (
    <PageMessage title="Aucun résultat">
      <p className="mt-2 text-[13px] text-muted">
        Aucun élément parmi les {label} ne correspond à « <span className="text-fg">{query}</span> ».
      </p>
      <button onClick={onClear} className="mt-3 rounded-md px-2.5 py-1.5 text-[12.5px] text-accent hover:bg-panel-2">
        Effacer le filtre
      </button>
    </PageMessage>
  )
}

/** The raw Markdown, lightly tinted: headings, code, lists and emphasis stand out. */
function MarkdownSource({ text, onOpen }: { text: string; onOpen(): void }) {
  const lines = text.split('\n')
  const shown = lines.slice(0, PREVIEW_LINES)
  let inFence = false
  return (
    <div className="font-mono text-[12px] leading-[1.65] whitespace-pre-wrap text-muted select-text">
      {shown.map((line, i) => {
        if (/^\s*(```|~~~)/.test(line)) {
          inFence = !inFence
          return (
            <div key={i} className="text-muted/70">
              {line}
            </div>
          )
        }
        if (inFence) {
          return (
            <div key={i} className="text-fg/80">
              {line || ' '}
            </div>
          )
        }
        const heading = /^(#{1,6})\s/.exec(line)
        if (heading) {
          return (
            <div key={i} className={`font-semibold text-fg ${i > 0 ? 'pt-1' : ''}`}>
              <span className="text-accent/60">{heading[1]}</span>
              {inline(line.slice(heading[1].length))}
            </div>
          )
        }
        const list = /^(\s*)([-*+]|\d+\.)(\s+)/.exec(line)
        if (list) {
          return (
            <div key={i}>
              {list[1]}
              <span className="text-accent/70">{list[2]}</span>
              {list[3]}
              {inline(line.slice(list[0].length))}
            </div>
          )
        }
        if (line.startsWith('>')) {
          return (
            <div key={i} className="text-muted/80 italic">
              {line}
            </div>
          )
        }
        return <div key={i}>{line ? inline(line) : ' '}</div>
      })}
      {lines.length > PREVIEW_LINES && (
        <button onClick={onOpen} className="mt-3 font-sans text-[12px] text-accent hover:underline">
          {lines.length - PREVIEW_LINES} lignes de plus : ouvrir dans l’éditeur
        </button>
      )}
    </div>
  )
}

/** `code` and **bold** inside a line. */
function inline(text: string): React.ReactNode[] {
  return text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g).map((part, i) => {
    if (part.startsWith('`') && part.endsWith('`') && part.length > 1) {
      return (
        <span key={i} className="text-accent/90">
          {part}
        </span>
      )
    }
    if (part.startsWith('**') && part.endsWith('**') && part.length > 3) {
      return (
        <span key={i} className="font-semibold text-fg">
          {part}
        </span>
      )
    }
    return part
  })
}

/** The file without its front matter (already shown above it). */
function useFileBody(projectId: string, path: string): string | null {
  const [body, setBody] = useState<string | null>(null)
  useEffect(() => {
    let cancelled = false
    window.capitaine.files
      .read(projectId, path)
      .then((file) => {
        if (cancelled) return
        if (file.kind !== 'text') return setBody(file.kind === 'missing' ? 'Fichier introuvable.' : 'Fichier illisible ici.')
        const text = file.content.replace(/^﻿?---\r?\n[\s\S]*?\r?\n---[ \t]*(\r?\n|$)/, '').trim()
        setBody(text || '(vide)')
      })
      .catch((error: unknown) => !cancelled && setBody(error instanceof Error ? error.message : String(error)))
    return () => {
      cancelled = true
    }
  }, [projectId, path])
  return body
}

/** What you type to run it, when it can be typed. */
function invocation(item: ClaudeConfigItem): string | null {
  if (item.kind === 'command') return `/${item.name}`
  if (item.kind === 'skill' && item.meta['user-invocable'] !== 'false') return `/${item.name}`
  return null
}

function loading(item: ClaudeConfigItem): string {
  switch (item.kind) {
    case 'skill':
      return 'Par Claude, quand la tâche s’y prête'
    case 'command':
      return 'À la demande'
    case 'agent':
      return 'Lancé par Claude pour une tâche dédiée'
    case 'rule':
      return item.paths ? 'Quand Claude touche ces fichiers' : 'À chaque session'
    case 'memory':
      return 'À chaque session'
  }
}

function sourceLabel(item: ClaudeConfigItem, projectName: string): string {
  if (item.scope === 'project') return `Ce projet (${projectName})`
  if (item.scope === 'user') return 'Global, pour tous tes projets'
  return `Plugin ${pluginName(item)}${item.disabled ? ' (désactivé)' : ''}`
}

function pluginName(item: ClaudeConfigItem): string {
  return (item.plugin ?? '').split('@')[0]
}

/** Inside a plugin group the plugin prefix is redundant. */
function shortName(item: ClaudeConfigItem): string {
  const prefix = `${pluginName(item)}:`
  return item.scope === 'plugin' && item.name.startsWith(prefix) ? item.name.slice(prefix.length) : item.name
}

function displayPath(path: string, projectPath: string, homeDir: string): string {
  if (path.startsWith(projectPath + '/') || path.startsWith(projectPath + '\\')) return path.slice(projectPath.length + 1)
  if (homeDir && path.startsWith(homeDir)) return `~${path.slice(homeDir.length)}`
  return path
}

function countByKind(items: ClaudeConfigItem[]): Record<ClaudeConfigKind, number> {
  const counts: Record<ClaudeConfigKind, number> = { skill: 0, agent: 0, command: 0, rule: 0, memory: 0 }
  for (const item of items) counts[item.kind]++
  return counts
}

function filterItems(items: ClaudeConfigItem[], kind: ClaudeConfigKind, query: string): ClaudeConfigItem[] {
  const needle = query.trim().toLowerCase()
  return items.filter(
    (item) => item.kind === kind && (!needle || item.name.toLowerCase().includes(needle) || !!item.description?.toLowerCase().includes(needle))
  )
}

/** The project's own files first, then the user's, then one group per plugin. */
function groupItems(items: ClaudeConfigItem[], projectName: string): Group[] {
  const byName = (a: ClaudeConfigItem, b: ClaudeConfigItem) => a.name.localeCompare(b.name)
  const groups: Group[] = []
  const project = items.filter((i) => i.scope === 'project').sort(byName)
  const user = items.filter((i) => i.scope === 'user').sort(byName)
  if (project.length) groups.push({ key: 'project', title: projectName, tooltip: 'Fichiers du projet (.claude/, CLAUDE.md)', items: project })
  if (user.length) groups.push({ key: 'user', title: 'Global', tooltip: 'Tes fichiers, pour tous les projets (~/.claude/)', items: user })
  const plugins = new Map<string, ClaudeConfigItem[]>()
  for (const item of items) if (item.scope === 'plugin') plugins.set(item.plugin ?? '', [...(plugins.get(item.plugin ?? '') ?? []), item])
  for (const [id, list] of [...plugins].sort(([a], [b]) => a.localeCompare(b))) {
    const disabled = list.some((i) => i.disabled)
    groups.push({
      key: `plugin:${id}`,
      title: `${id.split('@')[0]}${disabled ? ' · désactivé' : ''}`,
      tooltip: `Plugin ${id}${disabled ? ' (désactivé dans enabledPlugins)' : ''}`,
      items: list.sort(byName)
    })
  }
  return groups
}

/** Re-reads while the page is shown: on a timer, and when the window regains focus. */
function useConfigPolling(projectId: string) {
  useEffect(() => {
    const refresh = () => void useClaudeConfig.getState().refresh(projectId)
    refresh()
    const timer = setInterval(() => document.hasFocus() && refresh(), POLL_MS)
    window.addEventListener('focus', refresh)
    return () => {
      clearInterval(timer)
      window.removeEventListener('focus', refresh)
    }
  }, [projectId])
}
