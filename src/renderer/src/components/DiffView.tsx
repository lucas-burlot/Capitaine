import { useEffect, useRef, useState } from 'react'
import { Columns2, FilePen, Minus, Plus, Rows2 } from 'lucide-react'
import type { BlobContent, DiffSide } from '@shared/types'
import { repoAbsolutePath } from '../diff-targets'
import { monaco } from '../editor/monaco-setup'
import { useGit } from '../git-store'
import { useApp, type DiffTarget } from '../store'

interface Props {
  tabId: string
  projectId: string
  diff: DiffTarget
  visible: boolean
}

const AREA_LABEL: Record<DiffTarget['area'], string> = {
  unstaged: 'Modifications (index → fichier)',
  staged: 'Indexé (dernier commit → index)',
  conflict: 'Conflit (dernier commit → fichier)',
  stash: 'Stash'
}

const SIDE_BY_SIDE_KEY = 'capitaine.diffSideBySide'

type Loaded = { state: 'loading' } | { state: 'ready' } | { state: 'binary' } | { state: 'error'; message: string }

async function readSide(projectId: string, side: DiffSide): Promise<BlobContent> {
  return window.capitaine.git.show(projectId, side)
}

/** Read-only Monaco diff for a working-tree, staged or stashed change. Re-reads when git status moves. */
export default function DiffView({ tabId, projectId, diff, visible }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<monaco.editor.IStandaloneDiffEditor | null>(null)
  const modelsRef = useRef<{ original: monaco.editor.ITextModel; modified: monaco.editor.ITextModel } | null>(null)
  const [loaded, setLoaded] = useState<Loaded>({ state: 'loading' })
  const [sideBySide, setSideBySide] = useState(() => localStorage.getItem(SIDE_BY_SIDE_KEY) !== '0')
  // Stashes never change; working-tree and index diffs follow the repo's status.
  const version = useGit((s) => (diff.area === 'stash' ? 0 : (s.version[projectId] ?? 0)))

  useEffect(() => {
    const container = containerRef.current
    if (!container) return
    const uri = (side: string) => monaco.Uri.from({ scheme: 'capitaine-diff', path: `/${tabId}/${side}/${diff.path}` })
    // Language from the file name, as for regular editors.
    const original = monaco.editor.createModel('', undefined, uri('original'))
    const modified = monaco.editor.createModel('', undefined, uri('modified'))
    const editor = monaco.editor.createDiffEditor(container, {
      theme: 'capitaine',
      automaticLayout: true,
      readOnly: true,
      originalEditable: false,
      renderSideBySide: localStorage.getItem(SIDE_BY_SIDE_KEY) !== '0',
      useInlineViewWhenSpaceIsLimited: true,
      hideUnchangedRegions: { enabled: true },
      fontFamily: '"JetBrains Mono", "Cascadia Code", "SF Mono", Menlo, Consolas, "DejaVu Sans Mono", monospace',
      fontSize: 13,
      lineHeight: 20,
      minimap: { enabled: false },
      scrollBeyondLastLine: false,
      renderOverviewRuler: true,
      fixedOverflowWidgets: true
    })
    editor.setModel({ original, modified })
    editorRef.current = editor
    modelsRef.current = { original, modified }
    return () => {
      editor.dispose()
      original.dispose()
      modified.dispose()
      editorRef.current = null
      modelsRef.current = null
    }
  }, [tabId, diff.path])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        const [before, after] = await Promise.all([readSide(projectId, diff.original), readSide(projectId, diff.modified)])
        if (cancelled || !modelsRef.current) return
        if (before.kind === 'binary' || after.kind === 'binary') {
          setLoaded({ state: 'binary' })
          return
        }
        const text = (blob: BlobContent) => (blob.kind === 'text' ? blob.content : '')
        const { original, modified } = modelsRef.current
        // Only touch models that changed, so the scroll position survives refreshes.
        if (original.getValue() !== text(before)) original.setValue(text(before))
        if (modified.getValue() !== text(after)) modified.setValue(text(after))
        setLoaded({ state: 'ready' })
      } catch (error) {
        if (!cancelled) setLoaded({ state: 'error', message: error instanceof Error ? error.message : String(error) })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [projectId, diff, version])

  useEffect(() => {
    editorRef.current?.updateOptions({ renderSideBySide: sideBySide })
    localStorage.setItem(SIDE_BY_SIDE_KEY, sideBySide ? '1' : '0')
  }, [sideBySide])

  useEffect(() => {
    if (visible) requestAnimationFrame(() => editorRef.current?.layout())
  }, [visible])

  return (
    <div className={`absolute inset-0 flex-col ${visible ? 'flex' : 'hidden'}`} data-diff-tab={tabId}
      // display:none, not visibility: Monaco forces `visibility: visible` on some layers, which would bleed through.
    >
      <DiffHeader projectId={projectId} diff={diff} sideBySide={sideBySide} onToggleLayout={() => setSideBySide(!sideBySide)} />
      <div ref={containerRef} className={`min-h-0 flex-1 ${loaded.state === 'ready' || loaded.state === 'loading' ? '' : 'hidden'}`} />
      {loaded.state === 'binary' && (
        <p className="flex flex-1 items-center justify-center text-[13px] text-muted">Fichier binaire : pas de diff texte.</p>
      )}
      {loaded.state === 'error' && (
        <p className="flex flex-1 items-center justify-center text-[13px] text-red-400">Diff impossible : {loaded.message}</p>
      )}
    </div>
  )
}

function DiffHeader(props: { projectId: string; diff: DiffTarget; sideBySide: boolean; onToggleLayout(): void }) {
  const { projectId, diff } = props
  // Whether the change is still in the area the tab was opened from (it may have been staged since).
  const stillThere = useGit((s) => {
    const status = s.status[projectId]
    if (!status || diff.area === 'stash') return true
    const list = diff.area === 'staged' ? status.staged : diff.area === 'conflict' ? status.conflicts : status.unstaged
    return list.some((c) => c.path === diff.path)
  })
  const absolute = repoAbsolutePath(diff.repoRoot, diff.path)

  return (
    <div className="flex h-8 shrink-0 items-center gap-2 border-b border-line bg-panel px-3 text-[12px]">
      <span className="shrink-0 rounded bg-line px-1.5 py-0.5 text-[10.5px] text-muted">
        {diff.area === 'stash' ? `Stash ${diff.stashRef}` : AREA_LABEL[diff.area]}
      </span>
      <span className="min-w-0 flex-1 truncate text-fg" title={diff.path}>
        {diff.path}
      </span>
      {!stillThere && <span className="shrink-0 text-[11px] text-faint">plus dans cette zone</span>}
      {diff.area === 'unstaged' && stillThere && (
        <HeaderButton title="Indexer ce fichier" onClick={() => void useGit.getState().stage(projectId, [diff.path])}>
          <Plus size={13} /> Indexer
        </HeaderButton>
      )}
      {diff.area === 'staged' && stillThere && (
        <HeaderButton title="Désindexer ce fichier" onClick={() => void useGit.getState().unstage(projectId, [diff.path])}>
          <Minus size={13} /> Désindexer
        </HeaderButton>
      )}
      {diff.area !== 'stash' && (
        <HeaderButton title="Ouvrir le fichier dans l’éditeur" onClick={() => useApp.getState().openFile(projectId, absolute)}>
          <FilePen size={13} />
        </HeaderButton>
      )}
      <HeaderButton title={props.sideBySide ? 'Vue en ligne' : 'Vue côte à côte'} onClick={props.onToggleLayout}>
        {props.sideBySide ? <Rows2 size={13} /> : <Columns2 size={13} />}
      </HeaderButton>
    </div>
  )
}

function HeaderButton(props: { title: string; onClick(): void; children: React.ReactNode }) {
  return (
    <button
      title={props.title}
      onClick={props.onClick}
      className="flex shrink-0 items-center gap-1 rounded px-1.5 py-0.5 text-[11.5px] text-muted hover:bg-panel-2 hover:text-fg"
    >
      {props.children}
    </button>
  )
}
