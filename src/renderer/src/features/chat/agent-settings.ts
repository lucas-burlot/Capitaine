import { create } from 'zustand'
import type { ChatPermissionMode } from '@shared/types'

/** How new Claude agents open, and the chat's starting options. Remembered across launches. */

export type AgentView = 'shell' | 'chat'

const VIEW_KEY = 'capitaine.agentView'
const MODEL_KEY = 'capitaine.chatModel'
const PERMISSION_KEY = 'capitaine.chatPermissionMode'
const EFFORT_KEY = 'capitaine.chatEffort'

export const PERMISSION_MODES: { value: ChatPermissionMode; label: string; hint: string }[] = [
  { value: 'default', label: 'Demander', hint: 'Claude demande avant de modifier un fichier ou de lancer une commande' },
  { value: 'acceptEdits', label: 'Accepter les modifs', hint: 'Les modifications de fichiers passent sans demander ; les commandes demandent encore' },
  { value: 'auto', label: 'Auto', hint: 'Claude approuve lui-même les actions courantes et ne demande que pour le reste' },
  { value: 'plan', label: 'Plan', hint: 'Claude explore et propose un plan, sans rien modifier' },
  { value: 'bypassPermissions', label: 'Tout autoriser', hint: 'Aucune confirmation : à réserver aux environnements jetables' }
]

function read(key: string): string | null {
  try {
    return localStorage.getItem(key)
  } catch {
    return null
  }
}

function write(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key)
    else localStorage.setItem(key, value)
  } catch {
    // Not remembered; still applies for this session.
  }
}

interface AgentSettings {
  /** Where `Nouvel agent` opens Claude. Terminal by default, like Orca. */
  view: AgentView
  /** Model for new chats; null: Claude's own default. */
  model: string | null
  /** Mode for new chats: the last one picked, except "Tout autoriser", which is never carried over. */
  permissionMode: ChatPermissionMode
  effort: string | null
  setView(view: AgentView): void
  setModel(model: string | null): void
  setPermissionMode(mode: ChatPermissionMode): void
  setEffort(effort: string | null): void
}

function initialPermissionMode(): ChatPermissionMode {
  const saved = read(PERMISSION_KEY)
  // Saved by an earlier version: "Tout autoriser" is never a default, new agents start by asking.
  if (saved === 'bypassPermissions') return 'default'
  return PERMISSION_MODES.some((m) => m.value === saved) ? (saved as ChatPermissionMode) : 'default'
}

export const useAgentSettings = create<AgentSettings>((set) => ({
  view: read(VIEW_KEY) === 'chat' ? 'chat' : 'shell',
  model: read(MODEL_KEY),
  permissionMode: initialPermissionMode(),
  effort: read(EFFORT_KEY),
  setView(view) {
    write(VIEW_KEY, view)
    set({ view })
  },
  setModel(model) {
    write(MODEL_KEY, model)
    set({ model })
  },
  setPermissionMode(permissionMode) {
    // "Tout autoriser" applies to the chat it was confirmed in, never to the agents that come next.
    if (permissionMode === 'bypassPermissions') return
    write(PERMISSION_KEY, permissionMode)
    set({ permissionMode })
  },
  setEffort(effort) {
    write(EFFORT_KEY, effort)
    set({ effort })
  }
}))

export function defaultAgentView(): AgentView {
  return useAgentSettings.getState().view
}
