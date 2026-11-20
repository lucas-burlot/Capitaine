import {
  Bot,
  ClipboardList,
  FilePen,
  FilePlus,
  FileText,
  FolderSearch,
  Globe,
  ListChecks,
  MessageCircleQuestionMark,
  Plug,
  Search,
  Sparkles,
  SquareTerminal,
  Wrench,
  type LucideIcon
} from 'lucide-react'

export interface ToolDisplay {
  icon: LucideIcon
  /** What the tool does, in a word or two. */
  title: string
  /** What it acts on: the command, the file, the pattern… */
  detail: string
}

const str = (value: unknown): string => (typeof value === 'string' ? value : '')

/** A path shown relative to the chat's folder when it's inside it. */
export function shortPath(path: string, cwd: string): string {
  if (!path) return ''
  const base = cwd.replace(/[\\/]+$/, '')
  if (base && (path === base || path.startsWith(`${base}/`) || path.startsWith(`${base}\\`))) return path.slice(base.length + 1) || '.'
  return path
}

export function toolDisplay(name: string, input: Record<string, unknown>, cwd: string): ToolDisplay {
  const path = shortPath(str(input.file_path) || str(input.notebook_path) || str(input.path), cwd)
  switch (name) {
    case 'Bash':
      return { icon: SquareTerminal, title: str(input.description) || 'Commande', detail: firstLine(str(input.command)) }
    case 'BashOutput':
    case 'Monitor':
      return { icon: SquareTerminal, title: 'Sortie de commande', detail: str(input.bash_id) || str(input.description) }
    case 'Read': {
      const offset = typeof input.offset === 'number' ? input.offset : null
      const limit = typeof input.limit === 'number' ? input.limit : null
      const range = offset !== null ? ` · lignes ${offset}–${limit !== null ? offset + limit : '…'}` : ''
      return { icon: FileText, title: 'Lecture', detail: path + range }
    }
    case 'Write':
      return { icon: FilePlus, title: 'Écriture', detail: path }
    case 'Edit':
    case 'MultiEdit':
    case 'NotebookEdit':
      return { icon: FilePen, title: 'Modification', detail: path }
    case 'Grep':
      return { icon: Search, title: 'Recherche', detail: `${str(input.pattern)}${path ? `  dans ${path}` : ''}` }
    case 'Glob':
      return { icon: FolderSearch, title: 'Fichiers', detail: `${str(input.pattern)}${path ? `  dans ${path}` : ''}` }
    case 'WebFetch':
      return { icon: Globe, title: 'Page web', detail: str(input.url) }
    case 'WebSearch':
      return { icon: Globe, title: 'Recherche web', detail: str(input.query) }
    case 'Task':
    case 'Agent':
      return { icon: Bot, title: str(input.subagent_type) || 'Sous-agent', detail: str(input.description) }
    case 'TodoWrite':
      return { icon: ListChecks, title: 'Tâches', detail: '' }
    case 'AskUserQuestion':
      return { icon: MessageCircleQuestionMark, title: 'Question', detail: '' }
    case 'ExitPlanMode':
      return { icon: ClipboardList, title: 'Plan', detail: '' }
    case 'Skill':
      return { icon: Sparkles, title: 'Skill', detail: str(input.skill) || str(input.command) }
  }
  if (name.startsWith('mcp__')) {
    const [, server, ...tool] = name.split('__')
    return { icon: Plug, title: `${server} · ${tool.join('__')}`, detail: summarizeInput(input) }
  }
  return { icon: Wrench, title: name, detail: summarizeInput(input) }
}

function firstLine(text: string): string {
  const line = text.split('\n')[0] ?? ''
  return text.includes('\n') ? `${line} …` : line
}

function summarizeInput(input: Record<string, unknown>): string {
  for (const value of Object.values(input)) if (typeof value === 'string' && value.trim()) return firstLine(value).slice(0, 160)
  return ''
}

/** Permission prompt wording: "Claude veut …". */
export function permissionTitle(name: string): string {
  switch (name) {
    case 'Bash':
      return 'Claude veut lancer une commande'
    case 'Write':
      return 'Claude veut créer un fichier'
    case 'Edit':
    case 'MultiEdit':
    case 'NotebookEdit':
      return 'Claude veut modifier un fichier'
    case 'WebFetch':
      return 'Claude veut ouvrir une page web'
    case 'WebSearch':
      return 'Claude veut faire une recherche web'
    case 'Read':
      return 'Claude veut lire un fichier'
    default:
      return `Claude veut utiliser ${name.startsWith('mcp__') ? name.split('__').slice(1).join(' · ') : name}`
  }
}

/** Tool calls that stay on their own row instead of folding into a group: they're moments, not steps. */
export const STANDALONE_TOOLS = new Set(['TodoWrite', 'AskUserQuestion', 'ExitPlanMode'])

const TOOL_KINDS: { names: (name: string) => boolean; one: string; many: string }[] = [
  { names: (n) => n === 'Read', one: 'fichier lu', many: 'fichiers lus' },
  { names: (n) => ['Edit', 'MultiEdit', 'NotebookEdit', 'Write'].includes(n), one: 'modification', many: 'modifications' },
  { names: (n) => ['Bash', 'BashOutput', 'Monitor', 'KillShell'].includes(n), one: 'commande', many: 'commandes' },
  { names: (n) => n === 'Grep' || n === 'Glob', one: 'recherche', many: 'recherches' },
  { names: (n) => n === 'WebSearch', one: 'recherche web', many: 'recherches web' },
  { names: (n) => n === 'WebFetch', one: 'page web', many: 'pages web' },
  { names: (n) => n === 'Task' || n === 'Agent', one: 'sous-agent', many: 'sous-agents' },
  { names: (n) => n === 'Skill', one: 'skill', many: 'skills' }
]

/** "3 fichiers lus, 2 commandes, 1 modification": what a run of tool calls did, in order of first use. */
export function summarizeTools(names: string[]): string {
  const counts = new Map<string, { one: string; many: string; count: number }>()
  for (const name of names) {
    const kind = TOOL_KINDS.find((k) => k.names(name)) ?? { one: 'autre outil', many: 'autres outils' }
    const entry = counts.get(kind.one) ?? { ...kind, count: 0 }
    entry.count++
    counts.set(kind.one, entry)
  }
  return [...counts.values()].map((k) => `${k.count} ${k.count > 1 ? k.many : k.one}`).join(', ')
}
