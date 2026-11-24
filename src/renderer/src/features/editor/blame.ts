import type { BlameCommit, FileBlame } from '@shared/types'
import { relativeTime } from '@/lib/relative-time'
import { useGit } from '@/features/git/git-store'
import { useEditors } from './editor-store'
import { monaco } from './monaco-setup'

const BLAME_KEY = 'capitaine.editorBlame'

function blameEnabled(): boolean {
  try {
    return localStorage.getItem(BLAME_KEY) !== 'off'
  } catch {
    return true
  }
}

function storeBlameEnabled(on: boolean) {
  try {
    localStorage.setItem(BLAME_KEY, on ? 'on' : 'off')
  } catch {
  }
  for (const listener of toggleListeners) listener(on)
}

const toggleListeners = new Set<(on: boolean) => void>()

const UNCOMMITTED = /^0+$/

function label(commit: BlameCommit): string {
  if (UNCOMMITTED.test(commit.hash)) return 'Pas encore commité'
  const who = commit.mine ? 'Toi' : commit.author
  return `${who}, ${relativeTime(commit.time)} · ${commit.summary}`
}

function tooltip(commit: BlameCommit): string {
  if (UNCOMMITTED.test(commit.hash)) return 'Modification pas encore commitée'
  const date = new Date(commit.time).toLocaleString(undefined, { dateStyle: 'long', timeStyle: 'short' })
  return `${commit.author}, ${date}\n${commit.summary}\n${commit.hash.slice(0, 8)}`
}

/**
 * GitLens-style blame: who last changed the cursor's line, greyed out at its end.
 * One `git blame` per file, kept until the file changes on disk or the repo moves (commit,
 * branch switch); moving the cursor only reads that result. Hidden while the buffer has unsaved
 * changes, since its lines no longer match the saved file's.
 */
export function attachBlame(editor: monaco.editor.IStandaloneCodeEditor, tabId: string, projectId: string, path: string): () => void {
  // A content widget rather than an `after` decoration: Monaco 0.55 keeps those out of its
  // injected-text index, so they never render.
  const node = document.createElement('div')
  node.className = 'editor-blame'
  node.style.lineHeight = `${editor.getOption(monaco.editor.EditorOption.lineHeight)}px`
  let at: monaco.IPosition | null = null
  const widget: monaco.editor.IContentWidget = {
    getId: () => `capitaine.blame.${tabId}`,
    getDomNode: () => node,
    getPosition: () => (at ? { position: at, preference: [monaco.editor.ContentWidgetPositionPreference.EXACT] } : null)
  }
  editor.addContentWidget(widget)
  let enabled = blameEnabled()
  let blame: FileBlame | null = null
  let request = 0
  let disposed = false

  const show = (position: monaco.IPosition | null) => {
    at = position
    node.hidden = !position
    editor.layoutContentWidget(widget)
  }

  const render = () => {
    const meta = useEditors.getState().meta[tabId]
    const position = editor.getPosition()
    const model = editor.getModel()
    const index = position ? blame?.lines[position.lineNumber - 1] : undefined
    const commit = index === undefined ? undefined : blame?.commits[index]
    if (!enabled || !commit || !position || !model || meta?.dirty) {
      show(null)
      return
    }
    node.textContent = label(commit)
    node.title = tooltip(commit)
    show({ lineNumber: position.lineNumber, column: model.getLineMaxColumn(position.lineNumber) })
  }

  const load = async () => {
    if (!enabled || disposed) return
    const id = ++request
    const result = await window.capitaine.git.blame(projectId, path).catch(() => null)
    if (disposed || id !== request) return
    blame = result
    render()
  }

  const cursor = editor.onDidChangeCursorPosition(render)
  // Saved, or reloaded after an outside change: blame the new disk content.
  const offEditors = useEditors.subscribe((state, previous) => {
    const now = state.meta[tabId]
    const before = previous.meta[tabId]
    if (now === before) return
    if (!now?.dirty && (before?.dirty || now?.reloadedAt !== before?.reloadedAt)) void load()
    else if (now?.dirty !== before?.dirty) render()
  })
  // The repo may have moved (commit, branch switch, pull): ask again, the main process only
  // re-runs `git blame` when HEAD or the file actually changed.
  const offGit = useGit.subscribe((state, previous) => {
    if (state.branches[projectId] !== previous.branches[projectId] || state.version[projectId] !== previous.version[projectId]) void load()
  })
  window.addEventListener('focus', load)
  const onToggle = (on: boolean) => {
    enabled = on
    if (on) void load()
    else show(null)
  }
  toggleListeners.add(onToggle)
  const action = editor.addAction({
    id: 'capitaine.toggleBlame',
    label: 'Afficher ou masquer l’auteur de la ligne (git blame)',
    contextMenuGroupId: 'navigation',
    contextMenuOrder: 10,
    run: () => storeBlameEnabled(!enabled)
  })

  void load()

  return () => {
    disposed = true
    cursor.dispose()
    action.dispose()
    offEditors()
    offGit()
    window.removeEventListener('focus', load)
    toggleListeners.delete(onToggle)
    editor.removeContentWidget(widget)
  }
}
