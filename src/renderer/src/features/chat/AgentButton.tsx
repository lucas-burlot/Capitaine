import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown, MessageSquare, Sparkles, SquareTerminal } from 'lucide-react'
import { useApp } from '@/features/workspace/workspace-store'
import { shortcutLabel } from '@/lib/platform'
import { useAgentSettings, type AgentView } from './agent-settings'
import { switchBlocker, togglePaneView } from './agent-launch'
import { useChats } from './chat-store'

const VIEW_LABEL: Record<AgentView, string> = { chat: 'en chat', shell: 'dans un terminal' }

/** "Nouvel agent" in the tab bar: opens Claude the default way; the arrow picks the other way or changes the default. */
export function AgentButton({ projectId }: { projectId: string }) {
  const view = useAgentSettings((s) => s.view)
  const setView = useAgentSettings((s) => s.setView)
  const newAgent = useApp((s) => s.newAgent)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const anchor = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menu) return
    const close = () => setMenu(null)
    window.addEventListener('mousedown', close)
    window.addEventListener('blur', close)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('blur', close)
    }
  }, [menu])

  const open = () => {
    const rect = anchor.current?.getBoundingClientRect()
    if (rect) setMenu({ x: rect.right, y: rect.bottom + 4 })
  }

  return (
    <div ref={anchor} className="flex items-center rounded hover:bg-panel-2">
      <button
        className="flex items-center gap-1.5 rounded-l py-1 pr-1 pl-1.5 text-small text-muted hover:text-fg"
        title={`Nouvel agent Claude ${VIEW_LABEL[view]} (${shortcutLabel('newAgent')})`}
        onClick={() => newAgent(projectId)}
      >
        <Sparkles size={14} className="text-accent" />
        <span className="hidden @3xl:inline">Agent</span>
      </button>
      <button className="rounded-r py-1 pr-1 pl-0.5 text-faint hover:text-fg" title="Chat ou terminal" onClick={open}>
        <ChevronDown size={12} />
      </button>
      {menu &&
        createPortal(
          <div
            onMouseDown={(e) => e.stopPropagation()}
            className="fixed z-50 w-64 -translate-x-full rounded-lg border border-line bg-panel py-1 text-ui shadow-xl shadow-black/40"
            style={{ left: menu.x, top: menu.y }}
          >
            <MenuItem icon={<MessageSquare size={13} />} label="Nouvel agent en chat" onClick={() => (setMenu(null), newAgent(projectId, 'chat'))} />
            <MenuItem icon={<SquareTerminal size={13} />} label="Nouvel agent dans un terminal" onClick={() => (setMenu(null), newAgent(projectId, 'shell'))} />
            <div className="my-1 h-px bg-line" />
            <div className="px-3 pt-1 pb-0.5 text-caption font-medium tracking-wide text-faint uppercase">Par défaut ({shortcutLabel('newAgent')})</div>
            {(['chat', 'shell'] as const).map((option) => (
              <MenuItem
                key={option}
                icon={view === option ? <Check size={13} className="text-accent" /> : <span className="w-[13px]" />}
                label={option === 'chat' ? 'Chat' : 'Terminal'}
                onClick={() => setView(option)}
              />
            ))}
          </div>,
          document.body
        )}
    </div>
  )
}

function MenuItem({ icon, label, onClick }: { icon: React.ReactNode; label: string; onClick(): void }) {
  return (
    <button onClick={onClick} className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-fg hover:bg-panel-2">
      <span className="text-muted">{icon}</span>
      {label}
    </button>
  )
}

/** Switches the focused pane between chat and terminal, carrying the Claude conversation. */
export function ViewToggleButton({ terminalId }: { terminalId: string }) {
  const view = useApp((s) => s.terminals[terminalId]?.view)
  // Subscriptions so the blocker below follows the agent's state.
  useApp((s) => s.agents[terminalId]?.state)
  useChats((s) => `${s.chats[terminalId]?.status}:${s.chats[terminalId]?.permissions.length}`)
  const [message, setMessage] = useState<string | null>(null)
  if (!view) return null
  const toChat = view === 'shell'
  const blocker = switchBlocker(terminalId)

  const toggle = async () => {
    const blocked = await togglePaneView(terminalId)
    setMessage(blocked)
    if (blocked) setTimeout(() => setMessage(null), 4000)
  }

  return (
    <button
      onClick={() => void toggle()}
      className={`flex items-center gap-1.5 rounded px-1.5 py-1 text-small hover:bg-panel-2 hover:text-fg ${blocker || message ? 'text-faint' : 'text-muted'}`}
      title={
        message ??
        blocker ??
        `${toChat ? 'Passer ce terminal en chat (reprend la conversation Claude qui y tourne)' : 'Continuer cette conversation dans un terminal'} (${shortcutLabel('toggleAgentView')})`
      }
    >
      {toChat ? <MessageSquare size={14} /> : <SquareTerminal size={14} />}
      <span className="hidden @3xl:inline">{toChat ? 'Chat' : 'Terminal'}</span>
    </button>
  )
}
