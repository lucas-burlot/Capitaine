import { useEffect } from 'react'
import { editorFileLabel, useEditors } from '../editor-store'

/** "Save changes?" before closing a dirty editor tab, or the window with dirty tabs. */
export function CloseEditorDialog() {
  const request = useEditors((s) => s.closeRequest)
  const resolve = useEditors((s) => s.resolveClose)

  useEffect(() => {
    if (!request) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') void resolve('cancel')
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [request, resolve])

  if (!request) return null
  const names = request.tabIds.map(editorFileLabel)
  const single = names.length === 1
  const title = single
    ? `Enregistrer les modifications de « ${names[0]} » ?`
    : `Enregistrer les modifications de ${names.length} fichiers ?`

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50" role="dialog" aria-modal="true">
      <div className="w-[420px] max-w-[calc(100vw-32px)] rounded-lg border border-line bg-panel-2 p-5 shadow-2xl shadow-black/60">
        <h2 className="text-[14px] font-medium text-fg">{title}</h2>
        <p className="mt-2 text-[12.5px] leading-relaxed text-muted">
          {request.reason === 'window'
            ? 'La fenêtre va se fermer. Les modifications non enregistrées seront perdues si tu ne les enregistres pas.'
            : 'Tes modifications seront perdues si tu ne les enregistres pas.'}
        </p>
        {!single && (
          <ul className="mt-2 max-h-32 overflow-auto text-[12px] text-fg">
            {names.map((name, i) => (
              <li key={request.tabIds[i]} className="truncate">
                • {name}
              </li>
            ))}
          </ul>
        )}
        {request.error && <p className="mt-2 text-[12px] text-red-400">{request.error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button
            onClick={() => void resolve('cancel')}
            className="rounded-md px-3 py-1.5 text-[12.5px] text-muted hover:bg-line hover:text-fg"
          >
            Annuler
          </button>
          <button
            onClick={() => void resolve('discard')}
            className="rounded-md border border-line px-3 py-1.5 text-[12.5px] text-fg hover:bg-line"
          >
            Ne pas enregistrer
          </button>
          <button
            autoFocus
            disabled={request.saving}
            onClick={() => void resolve('save')}
            className="rounded-md bg-accent px-3 py-1.5 text-[12.5px] font-medium text-bg hover:brightness-110 disabled:opacity-60"
          >
            {request.saving ? 'Enregistrement…' : single ? 'Enregistrer' : 'Tout enregistrer'}
          </button>
        </div>
      </div>
    </div>
  )
}
