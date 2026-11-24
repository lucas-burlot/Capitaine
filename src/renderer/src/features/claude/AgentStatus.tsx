import { useEffect, useState } from 'react'
import {
  Circle,
  CircleCheck,
  CircleX,
  CornerDownRight,
  KeyRound,
  LoaderCircle,
  MessageCircleQuestionMark,
  Pencil,
  ShieldAlert
} from 'lucide-react'
import {
  agentDisplayName,
  agentMessageText,
  agentStateLabel,
  type AgentBlockKind,
  type AgentChild,
  type AgentSession,
  type AgentState
} from './agent-status'
import { agentLabel, isTerminalFocused, terminalLabel, useApp } from '@/features/workspace/workspace-store'
import { paneIds } from '@/features/workspace/layout'
import { ContextMenu, MenuItem } from '@/ui/ContextMenu'
import { RenameInput } from '@/ui/RenameInput'

export function AgentStatusIcon({ state, kind, size = 13 }: { state: AgentState; kind?: AgentBlockKind; size?: number }) {
  switch (state) {
    case 'working':
      return <LoaderCircle size={size} className="shrink-0 animate-spin text-sky-400" />
    case 'blocked': {
      const Icon = kind === 'permission' ? ShieldAlert : kind === 'auth' ? KeyRound : MessageCircleQuestionMark
      return <Icon size={size} className="shrink-0 animate-pulse text-waiting" />
    }
    case 'done':
      return <CircleCheck size={size} className="shrink-0 text-emerald-400" />
    case 'error':
      return <CircleX size={size} className="shrink-0 text-red-400" />
    default:
      return <Circle size={size} className="shrink-0 text-faint" />
  }
}

const stateText: Record<AgentState, string> = {
  working: 'text-sky-300',
  blocked: 'text-waiting',
  done: 'text-emerald-300',
  error: 'text-red-300',
  idle: 'text-faint'
}

/** Re-renders periodically so elapsed times stay fresh. */
function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(timer)
  }, [intervalMs])
  return now
}

function formatElapsed(ms: number): string {
  const minutes = Math.floor(ms / 60000)
  if (minutes < 1) return '< 1 min'
  if (minutes < 60) return `${minutes} min`
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')}`
}

/** A chat with nothing to signal has no agent entry (its tab shows the chat icon), but it's still an agent. */
const IDLE_CHAT: AgentSession = { app: 'claude-code', state: 'idle', since: 0, children: [] }

/** Agents running in a project's terminals and chats, shown under the project in the sidebar. */
export function ProjectAgentList({ projectId }: { projectId: string }) {
  const order = useApp((s) => s.terminalOrder[projectId])
  const agents = useApp((s) => s.agents)
  const terminals = useApp((s) => s.terminals)
  const terminalIds = (order ?? []).filter((id) => agents[id] || terminals[id]?.view === 'chat')
  if (terminalIds.length === 0) return null
  return (
    <ul className="mb-1 ml-4 border-l border-line pl-1.5">
      {terminalIds.map((id) => (
        <AgentSessionRow key={id} terminalId={id} session={agents[id] ?? IDLE_CHAT} />
      ))}
    </ul>
  )
}

function AgentSessionRow({ terminalId, session }: { terminalId: string; session: AgentSession }) {
  const tab = useApp((s) => s.terminals[terminalId])
  const name = useApp((s) => (s.terminals[terminalId] ? agentLabel(s, s.terminals[terminalId]) : ''))
  const active = useApp((s) => isTerminalFocused(s, terminalId))
  const focusTerminal = useApp((s) => s.focusTerminal)
  const now = useNow(15000)
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const [editing, setEditing] = useState(false)
  if (!tab) return null

  const live = session.state === 'working' || session.state === 'blocked'
  const status = agentStateLabel(session.state, session.kind)

  return (
    <li>
      {editing ? (
        <div className="flex w-full min-w-0 items-center gap-1.5 rounded-md bg-panel-2 px-1.5 py-1">
          <AgentStatusIcon state={session.state} kind={session.kind} />
          <RenameInput
            initial={renameTarget(terminalId).initial}
            className="text-small"
            onDone={(value) => {
              setEditing(false)
              if (value !== null) renameTarget(terminalId).rename(value)
            }}
          />
        </div>
      ) : (
        <button
          onClick={() => focusTerminal(terminalId)}
          onContextMenu={(e) => {
            e.preventDefault()
            setMenu({ x: e.clientX, y: e.clientY })
          }}
          title={`${agentDisplayName(session.app)} — ${name}\n${status}${session.msg ? `\n${session.msg}` : ''}`}
          className={`flex w-full flex-col gap-0.5 rounded-md px-1.5 py-1 text-left ${active ? 'bg-panel-2' : 'hover:bg-panel-2/60'}`}
        >
          <span className="flex w-full min-w-0 items-center gap-1.5">
            <AgentStatusIcon state={session.state} kind={session.kind} />
            <span className="min-w-0 flex-1 truncate text-small text-fg" onDoubleClick={() => setEditing(true)}>
              {name}
            </span>
          </span>
          <span className={`flex w-full min-w-0 gap-1 pl-[19px] text-caption ${stateText[session.state]}`}>
            <span className="shrink-0">{status}</span>
            {live && <span className="shrink-0 text-faint">· {formatElapsed(now - session.since)}</span>}
          </span>
          {session.state === 'blocked' && session.msg && (
            <span className="line-clamp-2 pl-[19px] text-caption leading-snug text-muted">{agentMessageText(session.msg)}</span>
          )}
        </button>
      )}
      {menu && (
        <ContextMenu x={menu.x} y={menu.y} onClose={() => setMenu(null)}>
          <MenuItem
            icon={<Pencil size={13} />}
            label="Renommer"
            onClick={() => {
              setMenu(null)
              setEditing(true)
            }}
          />
        </ContextMenu>
      )}
      {session.children.length > 0 && (
        <ul className="mb-0.5 ml-[19px]">
          {session.children.map((child) => (
            <SubagentRow key={child.id} child={child} />
          ))}
        </ul>
      )}
    </li>
  )
}

/**
 * What renaming a session from the sidebar changes: its tab, like renaming the tab itself, so
 * both show the same name; in a split tab, the pane's own name (the tab's stays in front).
 */
function renameTarget(terminalId: string): { initial: string; rename(value: string): void } {
  const state = useApp.getState()
  const terminal = state.terminals[terminalId]
  const tab = terminal ? state.tabs[terminal.tabId] : undefined
  if (!terminal || !tab) return { initial: '', rename: () => {} }
  if (paneIds(tab.layout).length > 1) {
    return { initial: terminalLabel(terminal), rename: (value) => useApp.getState().renameTerminal(terminalId, value) }
  }
  return { initial: agentLabel(state, terminal), rename: (value) => useApp.getState().renameTab(tab.id, value) }
}

function SubagentRow({ child }: { child: AgentChild }) {
  const depth = child.id.split('/').length - 1
  const label = child.title || child.msg || 'Sous-agent'
  return (
    <li
      className="flex min-w-0 items-center gap-1 py-0.5 pr-1 text-caption text-muted"
      style={{ paddingLeft: depth * 10 }}
      title={`Sous-agent — ${label}\n${agentStateLabel(child.state, child.kind)}`}
    >
      <CornerDownRight size={11} className="shrink-0 text-faint" />
      <AgentStatusIcon state={child.state} kind={child.kind} size={11} />
      <span className="min-w-0 flex-1 truncate">{label}</span>
    </li>
  )
}

/** One-line overview of every agent across projects, pinned to the sidebar bottom. */
export function AgentSummary() {
  const agents = useApp((s) => s.agents)
  const terminals = useApp((s) => s.terminals)
  const idleChats = Object.entries(terminals).filter(([id, pane]) => pane.view === 'chat' && !agents[id]).length
  const sessions = [...Object.values(agents), ...Array<AgentSession>(idleChats).fill(IDLE_CHAT)]
  if (sessions.length === 0) return null
  const working = sessions.filter((s) => s.state === 'working').length
  const waiting = sessions.filter((s) => s.state === 'blocked').length
  const done = sessions.filter((s) => s.state === 'done').length
  const subagents = sessions.reduce((n, s) => n + s.children.length, 0)
  const parts = [
    waiting > 0 && <span key="w" className="font-medium text-waiting">{waiting} t’attend{waiting > 1 ? 'ent' : ''}</span>,
    working > 0 && <span key="r" className="text-sky-300">{working} travaille{working > 1 ? 'nt' : ''}</span>,
    done > 0 && <span key="d" className="text-emerald-300">{done} terminé{done > 1 ? 's' : ''}</span>,
    subagents > 0 && <span key="s">{subagents} sous-agent{subagents > 1 ? 's' : ''}</span>,
    waiting + working + done < sessions.length && <span key="i">{sessions.length - waiting - working - done} au repos</span>
  ].filter(Boolean)
  return (
    <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 border-t border-line px-3 py-2 text-caption text-faint">
      <span className="font-medium text-muted">Agents</span>
      {parts.map((part, i) => (
        <span key={i} className="flex items-center gap-2">
          {i > 0 && <span>·</span>}
          {part}
        </span>
      ))}
    </div>
  )
}
