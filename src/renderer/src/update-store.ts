import { create } from 'zustand'
import type { UpdateState } from '@shared/types'

const DISMISSED_KEY = 'capitaine.update.dismissed'
/** How long the answer to a manual "check for updates" stays in the footer. */
const RESULT_MS = 6000

/** States that come with a newer version, so the update card has something to say. */
export function offersUpdate(state: UpdateState | null): state is UpdateState & { version: string } {
  return !!state?.version && ['available', 'downloading', 'ready', 'error'].includes(state.status)
}

interface UpdateUi {
  state: UpdateState | null
  /** The update card is shown. */
  cardOpen: boolean
  /** Outcome of a manual check, shown briefly in the footer. */
  result: 'up-to-date' | 'error' | 'unsupported' | null
  dismiss(): void
  openCard(): void
}

function readDismissed(): string | null {
  try {
    return localStorage.getItem(DISMISSED_KEY)
  } catch {
    return null
  }
}

let resultTimer: ReturnType<typeof setTimeout> | undefined

export const useUpdates = create<UpdateUi>((set, get) => ({
  state: null,
  cardOpen: false,
  result: null,

  /** "Plus tard": hide the card for this version; the footer keeps showing it's available. */
  dismiss() {
    const version = get().state?.version
    if (version) {
      try {
        localStorage.setItem(DISMISSED_KEY, version)
      } catch {
        // Not remembered: the card may come back at next launch.
      }
    }
    set({ cardOpen: false })
  },

  openCard() {
    if (offersUpdate(get().state)) set({ cardOpen: true })
  }
}))

function receive(next: UpdateState) {
  const previous = useUpdates.getState()
  const patch: Partial<UpdateUi> = { state: next }
  if (offersUpdate(next)) {
    // A version just found (unless "Plus tard" was chosen for it), or the user explicitly checked again.
    const found = previous.state?.version !== next.version || previous.state?.status === 'checking'
    const askedNow = next.manual && !previous.state?.manual
    if (askedNow || (found && readDismissed() !== next.version)) patch.cardOpen = true
  } else {
    patch.cardOpen = false
  }
  if (next.manual && ['up-to-date', 'error', 'unsupported'].includes(next.status) && !offersUpdate(next)) {
    patch.result = next.status as UpdateUi['result']
    clearTimeout(resultTimer)
    resultTimer = setTimeout(() => useUpdates.setState({ result: null }), RESULT_MS)
  }
  useUpdates.setState(patch)
}

void window.capitaine.updater.state().then(receive)
window.capitaine.updater.onState(receive)
