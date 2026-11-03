import { useEffect, useState } from 'react'
import { ArrowDownToLine, CircleCheck, LoaderCircle, RefreshCcw, TriangleAlert } from 'lucide-react'
import type { UpdateState } from '@shared/types'

/** How long the answer to a manual "check for updates" stays visible. */
const MANUAL_RESULT_MS = 6000

/** Footer, right end: app version, update progress, and the restart button once an update is ready. */
export function UpdateStatus() {
  const [state, setState] = useState<UpdateState | null>(null)
  const [showResult, setShowResult] = useState(false)

  useEffect(() => {
    void window.capitaine.updater.state().then(setState)
    return window.capitaine.updater.onState((next) => {
      setState(next)
      if (next.manual && ['up-to-date', 'error', 'unsupported'].includes(next.status)) setShowResult(true)
    })
  }, [])

  useEffect(() => {
    if (!showResult) return
    const timer = setTimeout(() => setShowResult(false), MANUAL_RESULT_MS)
    return () => clearTimeout(timer)
  }, [showResult, state])

  if (!state) return null
  const check = () => window.capitaine.updater.check()
  const version = `v${state.currentVersion}`

  if (state.status === 'ready') {
    return (
      <button
        onClick={() => window.capitaine.updater.install()}
        title={`Capitaine ${state.version} est téléchargé. Redémarrer pour l’installer (il s’installera aussi en quittant).`}
        className="flex shrink-0 items-center gap-1.5 rounded bg-accent px-2 py-0.5 font-medium text-bg hover:brightness-110"
      >
        <RefreshCcw size={11} />
        Redémarrer pour passer à {state.version}
      </button>
    )
  }

  if (state.status === 'downloading') {
    return (
      <span className="flex shrink-0 items-center gap-1.5 text-sky-300" title={`Téléchargement de Capitaine ${state.version}`}>
        <ArrowDownToLine size={11} />
        Mise à jour {state.version} · {state.percent ?? 0} %
      </span>
    )
  }

  if (state.status === 'checking' && state.manual) {
    return (
      <span className="flex shrink-0 items-center gap-1.5 text-muted">
        <LoaderCircle size={11} className="animate-spin" />
        Recherche de mises à jour…
      </span>
    )
  }

  if (showResult && state.status === 'up-to-date') {
    return (
      <span className="flex shrink-0 items-center gap-1.5 text-emerald-300">
        <CircleCheck size={11} />
        Capitaine est à jour ({version})
      </span>
    )
  }

  if (showResult && (state.status === 'error' || state.status === 'unsupported')) {
    const text =
      state.status === 'unsupported'
        ? state.error === 'Mode développement'
          ? 'Mises à jour indisponibles en mode développement'
          : 'Cette installation ne se met pas à jour toute seule'
        : `Mises à jour : ${state.error}`
    return (
      <span className="flex min-w-0 shrink items-center gap-1.5 text-amber-300/90" title={text}>
        <TriangleAlert size={11} className="shrink-0" />
        <span className="truncate">{text}</span>
        <button onClick={() => window.capitaine.updater.openReleases()} className="shrink-0 underline hover:text-amber-200">
          Voir les versions
        </button>
      </span>
    )
  }

  return (
    <button
      onClick={check}
      title={`Capitaine ${version}${state.status === 'error' ? `\nDernière recherche : ${state.error}` : ''}\nCliquer pour rechercher les mises à jour`}
      aria-label="Rechercher les mises à jour"
      className="flex shrink-0 items-center gap-1 rounded px-1 text-faint hover:bg-panel-2 hover:text-muted"
    >
      {state.status === 'error' && <TriangleAlert size={10} className="text-amber-300/70" />}
      {version}
    </button>
  )
}
