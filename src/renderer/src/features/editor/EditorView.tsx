import { useEffect, useRef, useState } from 'react'
import { ExternalLink, RotateCcw, TriangleAlert } from 'lucide-react'
import { useEditors } from './editor-store'
import { closeSession, openSession } from './editor-sessions'
import { monaco } from './monaco-setup'

interface Props {
  tabId: string
  projectId: string
  path: string
  visible: boolean
}

/** Monaco editor for one file tab. Loaded lazily: Monaco only ships once you open a file. */
export default function EditorView({ tabId, projectId, path, visible }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const editorRef = useRef<monaco.editor.IStandaloneCodeEditor | null>(null)
  const meta = useEditors((s) => s.meta[tabId])
  const visibleRef = useRef(visible)
  visibleRef.current = visible

  useEffect(() => {
    const session = openSession(tabId, projectId, path)
    let disposed = false
    void session.load().then(() => {
      const container = containerRef.current
      if (disposed || !container || !session.model) return
      const editor = monaco.editor.create(container, {
        model: session.model,
        theme: 'capitaine',
        automaticLayout: true,
        fontFamily: '"JetBrains Mono", "Cascadia Code", "SF Mono", Menlo, Consolas, "DejaVu Sans Mono", monospace',
        fontSize: 13,
        lineHeight: 20,
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        smoothScrolling: true,
        renderWhitespace: 'selection',
        bracketPairColorization: { enabled: true },
        padding: { top: 8 },
        fixedOverflowWidgets: true
      })
      // Only while the editor has focus, so Ctrl+S never reaches a terminal's flow control.
      editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => {
        void session.save().catch((error: unknown) =>
          useEditors.getState().setMeta(tabId, { error: `Enregistrement impossible : ${String(error)}` })
        )
      })
      editorRef.current = editor
      if (visibleRef.current) editor.focus()
    })
    return () => {
      disposed = true
      editorRef.current?.dispose()
      editorRef.current = null
      closeSession(tabId)
    }
  }, [tabId, projectId, path])

  // Back from the "save changes?" dialog (cancelled): hand the keyboard back to the editor.
  useEffect(
    () =>
      useEditors.subscribe((state, previous) => {
        if (previous.closeRequest && !state.closeRequest && visibleRef.current) editorRef.current?.focus()
      }),
    []
  )

  useEffect(() => {
    if (!visible) return
    const frame = requestAnimationFrame(() => {
      editorRef.current?.layout()
      editorRef.current?.focus()
    })
    return () => cancelAnimationFrame(frame)
  }, [visible])

  return (
    <div className={`absolute inset-0 flex-col ${visible ? 'flex' : 'hidden'}`} data-editor-tab={tabId}
      // display:none, not visibility: Monaco forces `visibility: visible` on some layers, which would bleed through.
    >
      <EditorBanner tabId={tabId} />
      {meta?.error && meta.status === 'ready' && (
        <div className="flex shrink-0 items-center gap-2 border-b border-red-500/30 bg-red-500/10 px-3 py-1.5 text-[12px] text-red-300">
          <TriangleAlert size={13} /> {meta.error}
        </div>
      )}
      <div ref={containerRef} className={`min-h-0 flex-1 ${meta?.status === 'ready' ? '' : 'hidden'}`} />
      {meta && meta.status !== 'ready' && <EditorPlaceholder projectId={projectId} path={path} status={meta.status} error={meta.error} />}
    </div>
  )
}

function EditorBanner({ tabId }: { tabId: string }) {
  const external = useEditors((s) => s.meta[tabId]?.external)
  const reloadedAt = useEditors((s) => s.meta[tabId]?.reloadedAt)
  const [flash, setFlash] = useState(false)

  // Brief notice when an outside change (an agent) was picked up silently.
  useEffect(() => {
    if (!reloadedAt) return
    setFlash(true)
    const timer = setTimeout(() => setFlash(false), 2500)
    return () => clearTimeout(timer)
  }, [reloadedAt])

  const act = async (fn: 'reloadFromDisk' | 'keepMine') => {
    const { getSession } = await import('./editor-sessions')
    await getSession(tabId)?.[fn]()
  }

  if (external === 'changed') {
    return (
      <div className="flex shrink-0 items-center gap-2 border-b border-amber-500/30 bg-amber-500/10 px-3 py-1.5 text-[12px] text-amber-200">
        <TriangleAlert size={13} className="shrink-0" />
        <span className="flex-1">Le fichier a été modifié sur le disque alors que tu as des modifications non enregistrées.</span>
        <BannerButton onClick={() => void act('reloadFromDisk')}>Prendre la version du disque</BannerButton>
        <BannerButton onClick={() => void act('keepMine')}>Garder la mienne</BannerButton>
      </div>
    )
  }
  if (external === 'deleted') {
    return (
      <div className="flex shrink-0 items-center gap-2 border-b border-red-500/30 bg-red-500/10 px-3 py-1.5 text-[12px] text-red-300">
        <TriangleAlert size={13} className="shrink-0" />
        <span className="flex-1">Le fichier a été supprimé du disque. Enregistrer le recréera.</span>
      </div>
    )
  }
  if (flash) {
    return (
      <div className="flex shrink-0 items-center gap-2 border-b border-sky-500/20 bg-sky-500/10 px-3 py-1 text-[11px] text-sky-200">
        <RotateCcw size={12} className="shrink-0" />
        Rechargé : le fichier a été modifié sur le disque.
      </div>
    )
  }
  return null
}

function BannerButton({ onClick, children }: { onClick(): void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className="shrink-0 rounded border border-current/30 px-2 py-0.5 hover:bg-white/10">
      {children}
    </button>
  )
}

const PLACEHOLDER_TEXT: Record<string, string> = {
  loading: 'Chargement…',
  binary: 'Ce fichier est binaire : il ne peut pas être édité ici.',
  'too-large': 'Ce fichier est trop volumineux pour l’éditeur (plus de 5 Mo).',
  missing: 'Ce fichier n’existe plus.'
}

function EditorPlaceholder(props: { projectId: string; path: string; status: string; error: string | null }) {
  const canOpenExternally = props.status === 'binary' || props.status === 'too-large'
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 text-center text-[13px] text-muted">
      <p>{props.status === 'error' ? `Lecture impossible : ${props.error}` : PLACEHOLDER_TEXT[props.status]}</p>
      {canOpenExternally && (
        <button
          onClick={() => void window.capitaine.files.open(props.projectId, props.path).catch(() => {})}
          className="flex items-center gap-2 rounded-md border border-line px-3 py-1.5 text-fg hover:bg-panel-2"
        >
          <ExternalLink size={13} /> Ouvrir avec l’application par défaut
        </button>
      )}
    </div>
  )
}
