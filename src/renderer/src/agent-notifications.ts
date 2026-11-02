import { agentDisplayName, agentMessageText, type AgentSession } from './agent-status'
import { isTerminalVisible, terminalLabel, useApp } from './store'

function needsNotice(prev: AgentSession | undefined, next: AgentSession): 'blocked' | 'done' | null {
  if (next.state === 'blocked' && (prev?.state !== 'blocked' || prev.kind !== next.kind || prev.msg !== next.msg)) {
    return 'blocked'
  }
  if (next.state === 'done' && prev?.state === 'working') return 'done'
  return null
}

/** OS notification when an agent needs you or finishes, unless you're already looking at it. */
export function startAgentNotifications(): () => void {
  return useApp.subscribe((state, previous) => {
    if (state.agents === previous.agents) return
    for (const [terminalId, session] of Object.entries(state.agents)) {
      const notice = needsNotice(previous.agents[terminalId], session)
      if (!notice) continue
      if (document.hasFocus() && isTerminalVisible(state, terminalId)) continue

      const tab = state.terminals[terminalId]
      const project = state.projects.find((p) => p.id === tab?.projectId)
      if (!tab || !project) continue
      const agent = agentDisplayName(session.app)
      const title = notice === 'blocked' ? `${agent} t’attend — ${project.name}` : `${agent} a terminé — ${project.name}`
      const body = [terminalLabel(tab), session.msg && agentMessageText(session.msg)].filter(Boolean).join('\n')

      const notification = new Notification(title, { body, silent: notice === 'done' })
      notification.onclick = () => {
        window.capitaine.focusWindow()
        useApp.getState().focusTerminal(terminalId)
      }
    }
  })
}
