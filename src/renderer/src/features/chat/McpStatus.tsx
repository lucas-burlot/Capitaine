import { useEffect, useRef, useState } from 'react'
import { LoaderCircle, Plug, RotateCcw } from 'lucide-react'
import { reconnectMcp, refreshMcp, toggleMcp, type ChatSession, type McpServer, type McpServerStatus } from './chat-store'

const LABELS: Record<McpServerStatus, string> = {
  connected: 'Connecté',
  pending: 'Connexion…',
  failed: 'En échec',
  'needs-auth': 'Connexion requise',
  disabled: 'Désactivé'
}

const DOTS: Record<McpServerStatus, string> = {
  connected: 'bg-emerald-400',
  pending: 'bg-amber-400 animate-pulse',
  failed: 'bg-red-400',
  'needs-auth': 'bg-amber-400',
  disabled: 'bg-faint'
}

/** The chat's MCP servers in the composer's toolbar: how many are up, and a list to fix the others. */
export function McpStatus({ chat }: { chat: ChatSession }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const servers = chat.mcpServers ?? []

  // Read again on opening: a server may have dropped since the last turn.
  useEffect(() => {
    if (open) void refreshMcp(chat.id)
  }, [open, chat.id])

  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false)
    }
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return
      event.preventDefault()
      event.stopPropagation()
      setOpen(false)
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [open])

  if (servers.length === 0) return null
  const active = servers.filter((server) => server.status !== 'disabled')
  const connected = active.filter((server) => server.status === 'connected').length
  const worst: McpServerStatus = active.some((s) => s.status === 'failed')
    ? 'failed'
    : active.some((s) => s.status === 'needs-auth')
      ? 'needs-auth'
      : active.some((s) => s.status === 'pending')
        ? 'pending'
        : active.length
          ? 'connected'
          : 'disabled'

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        title={`Serveurs MCP : ${connected} connecté${connected > 1 ? 's' : ''} sur ${active.length}`}
        className="flex items-center gap-1.5 rounded px-1.5 py-1 text-[11.5px] text-muted hover:bg-panel-2 hover:text-fg"
      >
        <span className={`h-1.5 w-1.5 rounded-full ${DOTS[worst]}`} />
        MCP {connected}/{active.length}
      </button>
      {open && (
        <div
          role="dialog"
          aria-label="Serveurs MCP"
          className="scrollbar-sleek absolute bottom-full left-0 z-30 mb-1.5 max-h-80 w-80 overflow-y-auto rounded-lg border border-line bg-panel py-1 shadow-xl shadow-black/40"
        >
          <div className="px-3 pt-1 pb-1.5 text-[11px] font-medium tracking-wide text-faint uppercase">Serveurs MCP</div>
          {servers.map((server) => (
            <ServerRow key={server.name} chatId={chat.id} server={server} />
          ))}
        </div>
      )}
    </div>
  )
}

function ServerRow({ chatId, server }: { chatId: string; server: McpServer }) {
  const busy = server.status === 'pending'
  return (
    <div className="flex flex-col gap-0.5 px-3 py-1.5 text-[12.5px]" data-mcp-server={server.name}>
      <div className="flex min-w-0 items-center gap-2">
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${DOTS[server.status]}`} />
        <Plug size={12} className="shrink-0 text-faint" />
        <span className="min-w-0 truncate text-fg" title={server.name}>
          {server.name}
        </span>
        {server.version && <span className="shrink-0 font-mono text-[10.5px] text-faint">{server.version}</span>}
        <span className="ml-auto shrink-0 text-[11px] text-muted">{LABELS[server.status]}</span>
      </div>
      {server.error && <div className="ml-[26px] text-[11px] break-words text-red-300/90">{server.error}</div>}
      {server.status === 'needs-auth' && <div className="ml-[26px] text-[11px] text-faint">Pour te connecter, passe la conversation en terminal et lance /mcp.</div>}
      <div className="ml-[22px] flex gap-1">
        {(server.status === 'failed' || server.status === 'needs-auth') && (
          <RowButton onClick={() => void reconnectMcp(chatId, server.name)}>
            <RotateCcw size={11} /> Relancer
          </RowButton>
        )}
        {busy ? (
          <span className="flex items-center gap-1 px-1.5 py-0.5 text-[11px] text-faint">
            <LoaderCircle size={11} className="animate-spin" /> En cours…
          </span>
        ) : (
          <RowButton onClick={() => void toggleMcp(chatId, server.name, server.status === 'disabled')}>
            {server.status === 'disabled' ? 'Activer' : 'Désactiver'}
          </RowButton>
        )}
      </div>
    </div>
  )
}

function RowButton({ onClick, children }: { onClick(): void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className="flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-muted hover:bg-panel-2 hover:text-fg">
      {children}
    </button>
  )
}
