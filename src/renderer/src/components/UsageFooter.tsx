import { useCallback, useEffect, useState } from 'react'
import { Gauge, RotateCw, TriangleAlert } from 'lucide-react'
import type { ClaudeUsage, ClaudeUsageWindow } from '@shared/types'

/** The usage endpoint is rate limited: refresh rarely on our own, the button is there for "now". */
const AUTO_REFRESH_MS = 5 * 60_000

/** Footer: Claude subscription usage (5-hour session, week, per-model week) with a refresh button. */
export function UsageFooter() {
  const [usage, setUsage] = useState<ClaudeUsage | null>(null)
  const [loading, setLoading] = useState(false)
  const [, tick] = useState(0)

  const load = useCallback(async (force: boolean) => {
    setLoading(true)
    try {
      setUsage(await window.capitaine.claude.usage(force))
    } catch (error) {
      setUsage((u) => ({
        ...(u ?? { session: null, weekly: null, weeklyByModel: [], extraUsagePercent: null }),
        status: 'error',
        error: error instanceof Error ? error.message : String(error),
        fetchedAt: Date.now()
      }))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load(false)
    const timer = setInterval(() => document.hasFocus() && void load(false), AUTO_REFRESH_MS)
    // Keeps "il y a … min" and reset countdowns current.
    const clock = setInterval(() => tick((n) => n + 1), 30_000)
    const onFocus = () => void load(false)
    window.addEventListener('focus', onFocus)
    return () => {
      clearInterval(timer)
      clearInterval(clock)
      window.removeEventListener('focus', onFocus)
    }
  }, [load])

  const windows = usage ? [usage.session, usage.weekly, ...usage.weeklyByModel].filter((w): w is ClaudeUsageWindow => !!w) : []
  const stale = usage?.status !== 'ok'

  return (
    <footer className="flex h-7 shrink-0 items-center gap-3 border-t border-line bg-panel px-3 text-[11px] text-muted" aria-label="Quota Claude">
      <span className="flex shrink-0 items-center gap-1.5 font-medium text-fg">
        <Gauge size={12} className="text-accent" />
        Claude
      </span>
      <div className={`flex min-w-0 flex-1 items-center gap-4 overflow-hidden ${stale && windows.length ? 'opacity-60' : ''}`}>
        {windows.map((limit) => (
          <UsageMeter key={limit.label} limit={limit} />
        ))}
        {usage?.extraUsagePercent != null && (
          <span className="shrink-0" title="Crédits d’utilisation supplémentaire consommés ce mois-ci">
            Crédits supp. <span className="text-fg tabular-nums">{Math.round(usage.extraUsagePercent)} %</span>
          </span>
        )}
        {usage && <StatusNote usage={usage} hasNumbers={windows.length > 0} />}
        {!usage && <span className="text-faint">Lecture du quota…</span>}
      </div>
      {usage && (
        <span className="shrink-0 text-faint" title={new Date(usage.fetchedAt).toLocaleString()}>
          {sinceLabel(usage.fetchedAt)}
        </span>
      )}
      <button
        onClick={() => void load(true)}
        disabled={loading}
        title="Rafraîchir le quota"
        aria-label="Rafraîchir le quota"
        className="shrink-0 rounded p-1 text-muted hover:bg-panel-2 hover:text-fg disabled:opacity-60"
      >
        <RotateCw size={12} className={loading ? 'animate-spin' : ''} />
      </button>
    </footer>
  )
}

function UsageMeter({ limit }: { limit: ClaudeUsageWindow }) {
  const percent = Math.round(limit.usedPercent)
  const color = percent >= 90 ? 'bg-red-400' : percent >= 70 ? 'bg-amber-400' : 'bg-sky-400'
  const reset = limit.resetsAt ? resetLabel(limit.resetsAt) : null
  return (
    <span
      className="flex shrink-0 items-center gap-1.5"
      title={`${limit.label} : ${percent} % utilisé${limit.resetsAt ? `\nRemise à zéro : ${new Date(limit.resetsAt).toLocaleString()}` : ''}`}
      data-usage-window={limit.label}
    >
      <span>{limit.label}</span>
      <span className="h-1.5 w-14 overflow-hidden rounded-full bg-line">
        <span className={`block h-full rounded-full ${color}`} style={{ width: `${percent}%` }} />
      </span>
      <span className={`tabular-nums ${percent >= 90 ? 'text-red-300' : 'text-fg'}`}>{percent} %</span>
      {reset && <span className="text-faint">· reset {reset}</span>}
    </span>
  )
}

function StatusNote({ usage, hasNumbers }: { usage: ClaudeUsage; hasNumbers: boolean }) {
  const text =
    usage.status === 'no-credentials'
      ? 'Non connecté : lance `claude` puis /login'
      : usage.status === 'expired'
        ? 'Connexion expirée : lance `claude` pour la renouveler'
        : usage.status === 'rate-limited'
          ? 'Trop de requêtes, réessaie dans un moment'
          : usage.status === 'error'
            ? `Quota indisponible${usage.error ? ` (${usage.error})` : ''}`
            : !hasNumbers
              ? 'Aucune limite renvoyée pour ce compte'
              : null
  if (!text) return null
  return (
    <span className="flex min-w-0 items-center gap-1 text-amber-300/90" title={text}>
      {usage.status !== 'ok' && <TriangleAlert size={11} className="shrink-0" />}
      <span className="truncate">{text}</span>
    </span>
  )
}

/** "16:30 (dans 2 h 10)" today, "lun. 09:00 (dans 3 j)" later. */
function resetLabel(timestamp: number): string {
  const date = new Date(timestamp)
  const now = new Date()
  const time = date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })
  const when = date.toDateString() === now.toDateString() ? time : `${date.toLocaleDateString(undefined, { weekday: 'short' })} ${time}`
  const minutes = Math.max(0, Math.round((timestamp - now.getTime()) / 60000))
  const left =
    minutes < 60
      ? `${minutes} min`
      : minutes < 48 * 60
        ? `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')}`
        : `${Math.round(minutes / 1440)} j`
  return `${when} (dans ${left})`
}

function sinceLabel(timestamp: number): string {
  const minutes = Math.floor((Date.now() - timestamp) / 60000)
  if (minutes < 1) return 'à l’instant'
  if (minutes < 60) return `il y a ${minutes} min`
  return `il y a ${Math.floor(minutes / 60)} h`
}
