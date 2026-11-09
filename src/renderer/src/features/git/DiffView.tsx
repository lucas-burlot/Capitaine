import { useEffect, useRef, useState } from 'react'
import { Check, Columns2, FilePen, LoaderCircle, Minus, Plus, RotateCw, Rows2, Sparkles, X } from 'lucide-react'
import type { BlobContent, DiffSide } from '@shared/types'
import { repoAbsolutePath } from './diff-targets'
import { monaco } from '@/features/editor/monaco-setup'
import { resolutionKey, useGit } from './git-store'
import { aiResolvable } from './GitOperationBanner'
import { useApp, type DiffTarget } from '@/features/workspace/workspace-store'

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
  stash: 'Stash',
  resolution: 'Proposition de Claude (fichier en conflit → résolu)'
}

const SIDE_BY_SIDE_KEY = 'capitaine.diffSideBySide'

type Loaded = { state: 'loading' } | { state: 'ready' } | { state: 'binary' } | { state: 'error'; message: string }

async function readSide(projectId: string, side: DiffSide): Promise<BlobContent> {
  if (side.source === 'resolution') {
    const held = useGit.getState().resolutions[resolutionKey(projectId, side.path)]
    if (held?.state !== 'ready') throw new Error('Cette proposition n’existe plus : relance la résolution')
    return { kind: 'text', content: held.resolution.content }
  }
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
  // A proposal under review is editable, and re-read only when Claude writes a new one.
  const reviewing = diff.area === 'resolution'
  const proposal = useGit((s) => {
    const held = reviewing ? s.resolutions[resolutionKey(projectId, diff.path)] : undefined
    return held?.state === 'ready' ? held.resolution : null
  })

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
      readOnly: !reviewing,
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
  }, [tabId, diff.path, reviewing])

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
  }, [projectId, diff, reviewing ? 0 : version, proposal]) // a review must not lose the user's edits on every poll

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
      {reviewing && (
        <ResolutionBar
          projectId={projectId}
          path={diff.path}
          explanation={proposal?.explanation ?? ''}
          content={() => modelsRef.current?.modified.getValue() ?? proposal?.content ?? ''}
        />
      )}
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
    const list = diff.area === 'staged' ? status.staged : diff.area === 'conflict' || diff.area === 'resolution' ? status.conflicts : status.unstaged
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
      {diff.area === 'conflict' && stillThere && <ConflictActions projectId={projectId} path={diff.path} />}
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

/** Conflict diff header: hand it to Claude, keep one side whole, or mark it resolved as it is. */
function ConflictActions({ projectId, path }: { projectId: string; path: string }) {
  const code = useGit((s) => s.status[projectId]?.conflicts.find((c) => c.path === path)?.conflictCode)
  const resolution = useGit((s) => s.resolutions[resolutionKey(projectId, path)])
  const busy = useGit((s) => !!s.busy[`${projectId}:${path}`])
  const git = useGit.getState()
  return (
    <>
      {aiResolvable(code) && (
        <button
          disabled={resolution?.state === 'pending'}
          onClick={() => void git.resolveWithAi(projectId, path)}
          title="Claude propose une version fusionnée, que tu relis avant de l’appliquer"
          className="flex shrink-0 items-center gap-1 rounded-md bg-accent/15 px-2 py-0.5 text-[11.5px] font-medium text-accent hover:bg-accent/25 disabled:opacity-70"
        >
          {resolution?.state === 'pending' ? <LoaderCircle size={12} className="animate-spin" /> : <Sparkles size={12} />}
          {resolution?.state === 'pending' ? 'Claude résout…' : 'Résoudre avec l’IA'}
        </button>
      )}
      <HeaderButton title="Garder la version courante (HEAD) en entier" onClick={() => !busy && void git.takeSide(projectId, path, 'current')}>
        Garder la courante
      </HeaderButton>
      <HeaderButton title="Garder la version entrante en entier" onClick={() => !busy && void git.takeSide(projectId, path, 'incoming')}>
        Garder l’entrante
      </HeaderButton>
      <HeaderButton title="Le fichier est résolu tel qu’il est sur le disque : l’indexer" onClick={() => !busy && void git.stage(projectId, [path])}>
        <Check size={13} /> Résolu
      </HeaderButton>
    </>
  )
}

/** Under the header of a proposal under review: Claude's explanation, then accept / retry / reject. */
function ResolutionBar(props: { projectId: string; path: string; explanation: string; content(): string }) {
  const { projectId, path } = props
  const state = useGit((s) => s.resolutions[resolutionKey(projectId, path)]?.state)
  const busy = useGit((s) => !!s.busy[`${projectId}:${path}`])
  const git = useGit.getState()
  return (
    <div className="flex shrink-0 items-start gap-2 border-b border-accent/20 bg-accent/[0.06] px-3 py-2 text-[12px]">
      <Sparkles size={14} className="mt-0.5 shrink-0 text-accent" />
      <p className="min-w-0 flex-1 leading-relaxed text-muted">
        {state === 'pending'
          ? 'Claude réécrit sa proposition…'
          : state === 'ready'
            ? props.explanation || 'Proposition prête.'
            : 'Cette proposition n’existe plus.'}
        {state === 'ready' && <span className="text-faint"> Tu peux la retoucher à droite avant de l’accepter.</span>}
      </p>
      <button
        disabled={state === 'pending'}
        onClick={() => void git.resolveWithAi(projectId, path, { review: false })}
        title="Demander une autre proposition"
        className="flex shrink-0 items-center gap-1 rounded-md px-2 py-0.5 text-[11.5px] text-muted hover:bg-line hover:text-fg disabled:opacity-50"
      >
        <RotateCw size={12} className={state === 'pending' ? 'animate-spin' : ''} /> Régénérer
      </button>
      <button
        onClick={() => git.discardResolution(projectId, path)}
        className="flex shrink-0 items-center gap-1 rounded-md px-2 py-0.5 text-[11.5px] text-muted hover:bg-line hover:text-fg"
      >
        <X size={12} /> Rejeter
      </button>
      <button
        disabled={state !== 'ready' || busy}
        onClick={() => void git.acceptResolution(projectId, path, props.content())}
        title="Écrire cette version dans le fichier et l’indexer"
        className="flex shrink-0 items-center gap-1 rounded-md bg-accent px-2.5 py-0.5 text-[11.5px] font-medium text-bg hover:brightness-110 disabled:bg-line disabled:text-faint"
      >
        {busy ? <LoaderCircle size={12} className="animate-spin" /> : <Check size={12} />} Accepter et indexer
      </button>
    </div>
  )
}
