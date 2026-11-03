import { ArrowDownToLine, CircleArrowUp, CircleCheck, LoaderCircle, RefreshCcw, TriangleAlert } from 'lucide-react'
import { offersUpdate, useUpdates } from '../update-store'

function checkedLabel(checkedAt: number | null): string {
  if (!checkedAt) return ''
  const minutes = Math.floor((Date.now() - checkedAt) / 60000)
  return minutes < 1 ? 'à l’instant' : minutes < 60 ? `il y a ${minutes} min` : `il y a ${Math.floor(minutes / 60)} h`
}

/** Footer, right end: the running version, and whether a newer one is available. */
export function UpdateStatus() {
  const state = useUpdates((s) => s.state)
  const result = useUpdates((s) => s.result)
  const openCard = useUpdates((s) => s.openCard)
  if (!state) return null

  const api = window.capitaine.updater
  const current = `v${state.currentVersion}`
  const versionLabel = (
    <span className="shrink-0 text-faint" title={`Capitaine ${state.currentVersion}`}>
      {current}
    </span>
  )

  // A newer version exists: always visible, and a click brings the update card back.
  if (offersUpdate(state)) {
    const label =
      state.status === 'available'
        ? `${state.version} disponible`
        : state.status === 'downloading'
          ? `${state.version} · ${state.percent ?? 0} %`
          : state.status === 'ready'
            ? `Redémarrer pour ${state.version}`
            : `${state.version} : échec`
    const Icon = state.status === 'downloading' ? ArrowDownToLine : state.status === 'ready' ? RefreshCcw : state.status === 'error' ? TriangleAlert : CircleArrowUp
    return (
      <span className="flex shrink-0 items-center gap-2">
        {versionLabel}
        <button
          onClick={openCard}
          aria-label="Mise à jour disponible"
          title={`Capitaine ${state.version} est disponible (tu as la ${state.currentVersion})`}
          className={`flex items-center gap-1.5 rounded-full px-2 py-0.5 font-medium ${
            state.status === 'error' ? 'bg-amber-500/15 text-amber-300' : 'bg-accent/15 text-accent hover:bg-accent/25'
          }`}
        >
          <Icon size={11} />
          {label}
        </button>
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

  if (result === 'error' || result === 'unsupported') {
    const text =
      result === 'unsupported'
        ? state.error === 'Mode développement'
          ? 'Mises à jour indisponibles en mode développement'
          : 'Cette installation ne se met pas à jour toute seule'
        : `Mises à jour : ${state.error}`
    return (
      <span className="flex min-w-0 shrink items-center gap-1.5 text-amber-300/90" title={text}>
        <TriangleAlert size={11} className="shrink-0" />
        <span className="truncate">{text}</span>
        <button onClick={() => api.openReleases()} className="shrink-0 underline hover:text-amber-200">
          Voir les versions
        </button>
      </span>
    )
  }

  const upToDate = state.status === 'up-to-date'
  return (
    <button
      onClick={() => api.check()}
      aria-label="Rechercher les mises à jour"
      title={[
        `Capitaine ${state.currentVersion}`,
        upToDate ? `À jour (vérifié ${checkedLabel(state.checkedAt)})` : null,
        state.status === 'error' ? `Dernière recherche : ${state.error}` : null,
        state.status === 'unsupported' ? 'Pas de mise à jour automatique pour cette installation' : null,
        'Cliquer pour rechercher les mises à jour'
      ]
        .filter(Boolean)
        .join('\n')}
      className={`flex shrink-0 items-center gap-1.5 rounded px-1 hover:bg-panel-2 ${result === 'up-to-date' ? 'text-emerald-300' : 'text-faint hover:text-muted'}`}
    >
      {state.status === 'error' && <TriangleAlert size={10} className="text-amber-300/70" />}
      {current}
      {upToDate && (
        <span className="flex items-center gap-1">
          · <CircleCheck size={10} className="text-emerald-400/80" /> {result === 'up-to-date' ? 'Capitaine est à jour' : 'à jour'}
        </span>
      )}
    </button>
  )
}
