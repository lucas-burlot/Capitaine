import { ArrowDownToLine, ExternalLink, RefreshCcw, TriangleAlert, X } from 'lucide-react'
import logo from '../../../../resources/logo.svg'
import { offersUpdate, useUpdates } from '../update-store'

const MAX_NOTES = 4
/** Conventional-commit prefixes ("fix(linux): …") are noise in release highlights. */
const stripPrefix = (line: string) => line.replace(/^[a-z]+(\([^)]*\))?!?:\s*/i, '').replace(/^./, (c) => c.toUpperCase())

/** Bottom-right card, Orca-style: a new version is announced and only downloaded when asked. */
export function UpdateCard() {
  const state = useUpdates((s) => s.state)
  const open = useUpdates((s) => s.cardOpen)
  const dismiss = useUpdates((s) => s.dismiss)
  if (!open || !offersUpdate(state)) return null

  const { version, currentVersion, status } = state
  const api = window.capitaine.updater
  const notes = state.notes.map(stripPrefix)

  return (
    <div
      role="dialog"
      aria-label="Mise à jour de Capitaine"
      className="fixed right-3 bottom-10 z-40 w-[360px] max-w-[calc(100vw-24px)] rounded-lg border border-line bg-panel-2 p-4 shadow-2xl shadow-black/50"
    >
      <div className="flex items-start gap-3">
        <img src={logo} alt="" aria-hidden className="mt-0.5 h-5 w-auto shrink-0" />
        <div className="min-w-0 flex-1">
          <h3 className="text-[13px] font-semibold text-fg">
            {status === 'available' && 'Nouvelle version disponible'}
            {status === 'downloading' && `Téléchargement de la ${version}`}
            {status === 'ready' && 'Mise à jour prête'}
            {status === 'error' && 'La mise à jour a échoué'}
          </h3>
          <p className="mt-1 text-[12px] leading-relaxed text-muted">
            {status === 'available' && (
              <>
                Capitaine <span className="font-medium text-fg">{version}</span> est disponible. Tu utilises la {currentVersion}.
              </>
            )}
            {status === 'downloading' && 'Tu peux continuer à travailler pendant le téléchargement.'}
            {status === 'ready' && (
              <>
                Capitaine <span className="font-medium text-fg">{version}</span> est téléchargé. Redémarre pour l’installer : les
                terminaux ouverts seront fermés.
                {window.capitaine.platform === 'linux' && ' Le système peut te demander ton mot de passe.'}
              </>
            )}
            {status === 'error' && (state.error ?? 'Erreur inconnue')}
          </p>
        </div>
        <button
          onClick={dismiss}
          title="Plus tard"
          aria-label="Fermer"
          className="-mt-1 -mr-1 shrink-0 rounded p-1 text-faint hover:bg-line hover:text-fg"
        >
          <X size={14} />
        </button>
      </div>

      {status === 'available' && notes.length > 0 && (
        <ul className="mt-3 space-y-1 border-l border-line pl-3 text-[12px] text-fg">
          {notes.slice(0, MAX_NOTES).map((note) => (
            <li key={note} className="line-clamp-2 leading-snug">
              {note}
            </li>
          ))}
          {notes.length > MAX_NOTES && <li className="text-faint">et {notes.length - MAX_NOTES} autre(s)…</li>}
        </ul>
      )}

      {status === 'downloading' && (
        <div className="mt-3 flex items-center gap-2">
          <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-line" role="progressbar" aria-valuenow={state.percent ?? 0}>
            <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${state.percent ?? 0}%` }} />
          </div>
          <span className="text-[11px] text-muted tabular-nums">{state.percent ?? 0} %</span>
        </div>
      )}

      <div className="mt-4 flex items-center gap-2">
        {status === 'available' && (
          <>
            <PrimaryButton onClick={() => api.download()}>
              {state.canSelfInstall ? <ArrowDownToLine size={13} /> : <ExternalLink size={13} />}
              {state.canSelfInstall ? 'Télécharger' : 'Télécharger sur GitHub'}
            </PrimaryButton>
            <SecondaryButton onClick={dismiss}>Plus tard</SecondaryButton>
          </>
        )}
        {status === 'downloading' && <SecondaryButton onClick={dismiss}>Masquer</SecondaryButton>}
        {status === 'ready' && (
          <>
            <PrimaryButton onClick={() => api.install()}>
              <RefreshCcw size={13} />
              Redémarrer maintenant
            </PrimaryButton>
            <SecondaryButton onClick={dismiss} title="La mise à jour s’installera quand tu quitteras Capitaine">
              Au prochain lancement
            </SecondaryButton>
          </>
        )}
        {status === 'error' && (
          <>
            <PrimaryButton onClick={() => api.download()}>
              <TriangleAlert size={13} />
              Réessayer
            </PrimaryButton>
            <SecondaryButton onClick={() => api.openReleases(version)}>Télécharger sur GitHub</SecondaryButton>
          </>
        )}
        {status === 'available' && (
          <button
            onClick={() => api.openReleases(version)}
            className="ml-auto shrink-0 text-[11.5px] text-muted underline-offset-2 hover:text-fg hover:underline"
          >
            Notes de version
          </button>
        )}
      </div>
    </div>
  )
}

function PrimaryButton(props: { onClick(): void; children: React.ReactNode }) {
  return (
    <button
      onClick={props.onClick}
      className="flex shrink-0 items-center gap-1.5 rounded-md bg-accent px-3 py-1.5 text-[12.5px] font-medium whitespace-nowrap text-bg hover:brightness-110"
    >
      {props.children}
    </button>
  )
}

function SecondaryButton(props: { onClick(): void; title?: string; children: React.ReactNode }) {
  return (
    <button
      onClick={props.onClick}
      title={props.title}
      className="shrink-0 rounded-md px-2.5 py-1.5 text-[12.5px] whitespace-nowrap text-muted hover:bg-line hover:text-fg"
    >
      {props.children}
    </button>
  )
}
