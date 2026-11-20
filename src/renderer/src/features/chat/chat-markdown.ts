import { useMemo } from 'react'
import { Marked } from 'marked'
import DOMPurify from 'dompurify'
import { isWindows } from '@/lib/platform'
import { useApp } from '@/features/workspace/workspace-store'
import { loadProjectFiles } from '@/features/files/project-files'

const marked = new Marked({ gfm: true, breaks: false })

// Claude's answers repeat across renders while streaming: the last ones are cached.
const cache = new Map<string, string>()
const CACHE_SIZE = 200

/** Claude's Markdown as sanitized HTML. */
export function renderMarkdown(source: string): string {
  const hit = cache.get(source)
  if (hit !== undefined) return hit
  const html = DOMPurify.sanitize(marked.parse(source, { async: false }), { ADD_ATTR: ['target'] })
  cache.set(source, html)
  if (cache.size > CACHE_SIZE) cache.delete(cache.keys().next().value!)
  return html
}

/** Where a chat's relative paths point: its folder, inside a project. */
export interface ChatPlace {
  projectId: string | null
  projectRoot: string | null
  cwd: string
}

export function useChatPlace(chatId: string, cwd: string): ChatPlace {
  const projectId = useApp((s) => s.terminals[chatId]?.projectId ?? null)
  const projectRoot = useApp((s) => s.projects.find((p) => p.id === projectId)?.path ?? null)
  return useMemo(() => ({ projectId, projectRoot, cwd }), [projectId, projectRoot, cwd])
}

/**
 * Web links open in the browser; links to files and file paths in `code` open in the editor; code
 * blocks get a copy button (event delegation on the transcript).
 */
export function onMarkdownClick(event: React.MouseEvent, place: ChatPlace): void {
  const target = event.target as HTMLElement
  const copy = target.closest<HTMLElement>('[data-copy-code]')
  if (copy) {
    const code = copy.parentElement?.querySelector('code')?.textContent ?? ''
    window.capitaine.files.copyText(code)
    copy.textContent = 'Copié'
    setTimeout(() => (copy.textContent = 'Copier'), 1200)
    return
  }
  const fileCode = target.closest<HTMLElement>('[data-file-path]')
  if (fileCode && place.projectId) {
    useApp.getState().openFile(place.projectId, fileCode.dataset.filePath!)
    return
  }
  const anchor = target.closest('a')
  const href = anchor?.getAttribute('href')
  if (!href) return
  event.preventDefault()
  if (/^https?:\/\//i.test(href)) window.open(href)
  else if (place.projectId && !href.startsWith('#') && !/^[a-z][a-z0-9+.-]*:(?![\\/])/i.test(href)) {
    const [file] = locate(safeDecode(href), place)
    if (file) useApp.getState().openFile(place.projectId, file.absolute)
  }
}

/** Marks the inline `code` naming a file of the project, so a click opens it. */
export async function linkFilePaths(root: HTMLElement, place: ChatPlace): Promise<void> {
  const candidates = [...root.querySelectorAll<HTMLElement>('code')].filter((code) => !code.closest('pre') && code.dataset.filePath === undefined && looksLikePath(code.textContent ?? ''))
  if (candidates.length === 0 || !place.projectId) return
  const files = projectFileSet(await loadProjectFiles(place.projectId))
  for (const code of candidates) {
    const file = locate(code.textContent!.trim(), place).find((candidate) => candidate.projectPath !== null && files.has(candidate.projectPath))
    if (!file) continue
    code.dataset.filePath = file.absolute
    code.classList.add('chat-file-link')
    code.title = 'Ouvrir dans l’éditeur'
  }
}

const fileSets = new WeakMap<string[], Set<string>>()
function projectFileSet(files: string[]): Set<string> {
  let set = fileSets.get(files)
  if (!set) fileSets.set(files, (set = new Set(files)))
  return set
}

function looksLikePath(text: string): boolean {
  const t = text.trim()
  return t.length > 2 && t.length < 300 && /^[\w@.~/\\:+-]+$/.test(t) && /[./\\]/.test(t) && !/^\.+$/.test(t)
}

function safeDecode(text: string): string {
  try {
    return decodeURIComponent(text)
  } catch {
    return text
  }
}

/**
 * Where a path as Claude writes it (`src/a.ts`, `./a.ts:12`, `/abs/a.ts#L3`) may point, most likely
 * first: against the chat's folder, then the project's root. Its line suffix is dropped.
 */
function locate(raw: string, place: ChatPlace): { absolute: string; projectPath: string | null }[] {
  const path = raw.replace(/#L\d+(-L?\d+)?$/, '').replace(/(:\d+){1,2}$/, '').replace(/\\/g, '/')
  if (!path || path.startsWith('~')) return []
  const root = place.projectRoot ? place.projectRoot.replace(/\\/g, '/').replace(/\/+$/, '') : null
  const inProject = (absolute: string) => (root && absolute.startsWith(`${root}/`) ? absolute.slice(root.length + 1) : null)
  const absolute = /^(\/|[A-Za-z]:\/)/.test(path) ? normalize(path) : normalize(`${place.cwd.replace(/\\/g, '/')}/${path}`)
  const candidates = [{ absolute, projectPath: inProject(absolute) }]
  // Claude sometimes writes paths from the project's root while the chat runs in a subfolder.
  if (root && !/^(\/|[A-Za-z]:\/)/.test(path)) candidates.push({ absolute: normalize(`${root}/${path}`), projectPath: normalize(path) })
  return candidates.map((c) => ({ ...c, absolute: isWindows ? c.absolute.replace(/\//g, '\\') : c.absolute }))
}

/** Drops `.` and resolves `..` in a `/`-separated path. */
function normalize(path: string): string {
  const out: string[] = []
  for (const segment of path.split('/')) {
    if (segment === '.' || (segment === '' && out.length > 0)) continue
    if (segment === '..') {
      if (out.length > 1) out.pop()
    } else out.push(segment)
  }
  return out.join('/')
}

// Monaco is heavy: it loads with the first code block, not with the chat.
const colorize = () => import('@/features/editor/colorize')

/** Adds the copy buttons to a rendered block's `<pre>`s and colours their code. */
export function decorateCodeBlocks(root: HTMLElement): void {
  if (root.querySelector('pre > code[class*="language-"]')) void colorize().then((m) => m.colorizeCodeBlocks(root), () => {})
  for (const pre of root.querySelectorAll('pre')) {
    if (pre.querySelector('[data-copy-code]')) continue
    const button = document.createElement('button')
    button.type = 'button'
    button.dataset.copyCode = ''
    button.className = 'chat-copy-code'
    button.textContent = 'Copier'
    pre.appendChild(button)
  }
}
