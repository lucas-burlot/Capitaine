/**
 * Moving a Claude conversation between the chat and a terminal. Both run the same session (its
 * transcript on disk): one side stops, the other resumes it with `--resume <id>`.
 */
import type { SavedAgent } from '@shared/types'
import { setTerminalStartup } from '@/features/terminals/terminal-startup'
import { snapshotTerminal } from '@/features/terminals/terminal-registry'
import { useApp } from '@/features/workspace/workspace-store'
import { chatAgent, chatOf } from './chat-store'

export interface ChatStartup {
  agent: SavedAgent
  /** Don't start Claude before this time: the terminal's Claude must be gone first. */
  notBefore: number
}

// Time for the terminal's Claude to die once its shell is killed, before the chat resumes it.
const HANDOVER_DELAY_MS = 1200

const chatStartups = new Map<string, ChatStartup>()

/** Read once, when the chat pane mounts. */
export function takeChatStartup(chatId: string): ChatStartup | undefined {
  const startup = chatStartups.get(chatId)
  chatStartups.delete(chatId)
  return startup
}

/** Why the pane can't switch right now, or null. */
export function switchBlocker(terminalId: string): string | null {
  const app = useApp.getState()
  const pane = app.terminals[terminalId]
  if (!pane) return 'Panneau introuvable.'
  if (pane.view === 'chat') {
    const chat = chatOf(terminalId)
    if (chat?.status === 'working' || chat?.status === 'starting') return 'Claude travaille : attends la fin de son tour (ou interromps-le) avant de basculer.'
    if (chat?.permissions.length) return 'Claude attend ta réponse : réponds-lui avant de basculer.'
    return null
  }
  const agent = app.agents[terminalId]
  if (agent?.state === 'working') return 'Claude travaille dans ce terminal : attends la fin de son tour avant de basculer.'
  return null
}

/** Shows the pane the other way (chat ↔ terminal), carrying the Claude conversation over. */
export async function togglePaneView(terminalId: string): Promise<string | null> {
  const blocker = switchBlocker(terminalId)
  if (blocker) return blocker
  const app = useApp.getState()
  const pane = app.terminals[terminalId]
  const project = app.projects.find((p) => p.id === pane?.projectId)
  if (!pane || !project) return 'Projet introuvable.'

  if (pane.view === 'chat') {
    const agent = chatAgent(terminalId) ?? { sessionId: null, cwd: project.path, args: [] }
    setTerminalStartup(terminalId, { resumeAgent: agent })
    // The chat pane unmounts: its Claude stops, and the terminal resumes the conversation.
    app.setPaneView(terminalId, 'shell')
    return null
  }

  const ptyId = snapshotTerminal(terminalId)?.ptyId ?? null
  let agent = ptyId ? await window.capitaine.chat.agentInTerminal(ptyId).catch(() => null) : null
  if (!agent) {
    const cwd = ptyId ? await window.capitaine.chat.terminalCwd(ptyId).catch(() => null) : null
    agent = { sessionId: null, cwd: cwd ?? project.path, args: [] }
  }
  chatStartups.set(terminalId, { agent, notBefore: agent.sessionId ? Date.now() + HANDOVER_DELAY_MS : 0 })
  // The terminal pane unmounts: its shell (and the Claude in it) is killed.
  useApp.getState().setPaneView(terminalId, 'chat')
  return null
}
