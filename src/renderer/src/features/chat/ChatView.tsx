import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ArrowDown, LoaderCircle, RotateCcw, Sparkles } from 'lucide-react'
import type { ChatPermissionMode } from '@shared/types'
import type { Rect } from '@/features/workspace/layout'
import { forgetRestoredTerminal, restoredTerminal } from '@/features/workspace/session'
import { registerTerminal } from '@/features/terminals/terminal-registry'
import { PaneHeader } from '@/features/terminals/TerminalView'
import { useApp } from '@/features/workspace/workspace-store'
import { shortcutLabel } from '@/lib/platform'
import { PERMISSION_MODES } from './agent-settings'
import { takeChatStartup } from './agent-launch'
import { ChatComposer, insertIntoChat } from './ChatComposer'
import { ChatTranscript } from './ChatTranscript'
import { chatAgent, closeChat, ensureStarted, markSeen, openChat, setEffort, setModel, setPermissionMode, useChats, type ChatSession } from './chat-store'
import { onMarkdownClick, useChatPlace } from './chat-markdown'
import { ChatFind } from './ChatFind'
import { PermissionCard } from './PermissionCard'

interface Props {
  chatId: string
  /** Project folder: where a new conversation starts. */
  cwd: string
  rect: Rect
  visible: boolean
  focused: boolean
  showHeader: boolean
}

const FALLBACK_MODELS = [
  { value: 'default', displayName: 'Par défaut' },
  { value: 'opus', displayName: 'Opus' },
  { value: 'sonnet', displayName: 'Sonnet' },
  { value: 'haiku', displayName: 'Haiku' }
]

/** Claude Code as a chat: transcript, pending prompts and composer, in a pane of the workspace. */
export function ChatView({ chatId, cwd, rect, visible, focused, showHeader }: Props) {
  const chat = useChats((s) => s.chats[chatId])
  const notBefore = useRef(0)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [atBottom, setAtBottom] = useState(true)
  const [finding, setFinding] = useState(false)
  const stick = useRef(true)
  const place = useChatPlace(chatId, chat?.cwd ?? cwd)

  useEffect(() => {
    // Reopened after a restart, or carried over from a terminal: resume that conversation.
    const startup = takeChatStartup(chatId)
    const agent = startup?.agent ?? restoredTerminal(chatId)?.agent ?? null
    openChat(chatId, { cwd: agent?.cwd ?? cwd, sessionId: agent?.sessionId ?? null, args: agent?.args })
    forgetRestoredTerminal(chatId)
    notBefore.current = startup?.notBefore ?? 0
    const unregister = registerTerminal(chatId, {
      paste: (text) => void insertIntoChat(chatId, text),
      focus: () => useApp.getState().focusPane(chatId),
      snapshot: () => ({ ptyId: null, scrollback: '', agent: chatAgent(chatId) })
    })
    return () => {
      unregister()
      closeChat(chatId)
    }
  }, [chatId, cwd])

  // Claude starts when the chat is first shown (restored background tabs stay idle until then).
  const status = chat?.status
  useEffect(() => {
    if (!visible || status !== 'new') return
    const timer = setTimeout(() => void ensureStarted(chatId), Math.max(0, notBefore.current - Date.now()))
    return () => clearTimeout(timer)
  }, [visible, status, chatId])

  useEffect(() => {
    if (visible && chat?.unseenDone) markSeen(chatId)
  }, [visible, chat?.unseenDone, chatId])

  // Follows the conversation while scrolled to the bottom.
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (el && stick.current) el.scrollTop = el.scrollHeight
  }, [chat?.items, chat?.permissions, chat?.activity, visible])

  const onScroll = () => {
    const el = scrollRef.current
    if (!el) return
    const bottom = el.scrollHeight - el.scrollTop - el.clientHeight < 60
    stick.current = bottom
    if (bottom !== atBottom) setAtBottom(bottom)
  }

  const scrollToBottom = () => {
    const el = scrollRef.current
    if (!el) return
    stick.current = true
    el.scrollTo({ top: el.scrollHeight, behavior: 'smooth' })
  }

  return (
    <div
      className={`absolute flex flex-col bg-bg ${visible ? '' : 'invisible pointer-events-none'}`}
      style={{ left: `${rect.left * 100}%`, top: `${rect.top * 100}%`, width: `${rect.width * 100}%`, height: `${rect.height * 100}%` }}
      aria-hidden={!visible}
      data-terminal-id={chatId}
      data-chat-root={chatId}
      onMouseDown={() => useApp.getState().focusPane(chatId)}
      onKeyDown={(event) => {
        if ((event.ctrlKey || event.metaKey) && !event.shiftKey && !event.altKey && event.key.toLowerCase() === 'f') {
          event.preventDefault()
          setFinding(true)
        }
      }}
    >
      {showHeader && <PaneHeader terminalId={chatId} focused={focused} />}
      {chat && <StatusBar chat={chat} />}
      <div className="relative min-h-0 flex-1">
        {finding && <ChatFind scrollRef={scrollRef} content={chat?.items} onClose={() => setFinding(false)} />}
        <div ref={scrollRef} onScroll={onScroll} onClick={(event) => onMarkdownClick(event, place)} className="scrollbar-sleek h-full overflow-y-auto">
          <div className="mx-auto flex max-w-[820px] flex-col gap-3 px-5 pt-4 pb-6">
            {chat?.historyTruncated && <div className="text-center text-[11.5px] text-faint">Les messages les plus anciens ne sont pas affichés.</div>}
            {chat?.historyLoading && (
              <div className="flex items-center justify-center gap-2 py-6 text-[12.5px] text-muted">
                <LoaderCircle size={13} className="animate-spin" /> Chargement de la conversation…
              </div>
            )}
            {chat && !chat.historyLoading && chat.items.length === 0 && <EmptyChat cwd={chat.cwd} />}
            {chat && <ChatTranscript chatId={chatId} items={chat.items} cwd={chat.cwd} working={chat.status === 'working'} scrollRef={scrollRef} />}
            {chat?.status === 'working' && chat.permissions.length === 0 && <Working activity={chat.activity} />}
          </div>
        </div>
        {!atBottom && (
          <button
            onClick={scrollToBottom}
            className="absolute bottom-3 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-full border border-line bg-panel px-2.5 py-1 text-[11.5px] text-muted shadow-lg hover:text-fg"
          >
            <ArrowDown size={12} /> Bas de la conversation
          </button>
        )}
      </div>
      {chat && (
        <div className="mx-auto flex w-full max-w-[820px] flex-col gap-2 px-5 pb-4">
          {chat.permissions.map((permission, i) => (
            <PermissionCard key={permission.requestId} chatId={chatId} permission={permission} cwd={chat.cwd} active={i === 0 && focused} />
          ))}
          {chat.status === 'exited' && <ExitedBanner chat={chat} />}
          <ChatComposer chat={chat} focused={focused && chat.permissions.length === 0} blocked={chat.permissions.length > 0} toolbar={<Toolbar chat={chat} />} />
        </div>
      )}
    </div>
  )
}

function StatusBar({ chat }: { chat: ChatSession }) {
  const waiting = chat.permissions.length > 0
  const label = waiting
    ? 'Attend ta réponse'
    : chat.status === 'starting'
      ? 'Démarrage de Claude…'
      : chat.status === 'working'
        ? 'Claude travaille…'
        : chat.status === 'exited'
          ? 'Arrêté'
          : chat.status === 'new'
            ? 'En attente'
            : 'Prêt'
  const dot = waiting
    ? 'bg-amber-400'
    : chat.status === 'working' || chat.status === 'starting'
      ? 'bg-sky-400 animate-pulse'
      : chat.status === 'exited'
        ? 'bg-red-400'
        : chat.status === 'ready'
          ? 'bg-emerald-400'
          : 'bg-faint'
  const model = chat.activeModel ?? chat.model
  return (
    <div className="flex h-7 shrink-0 items-center gap-2 border-b border-line px-3 text-[11.5px]">
      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${dot}`} />
      <span className="shrink-0 text-muted">{label}</span>
      {model && <span className="shrink-0 text-faint">· {model}</span>}
      <div className="flex-1" />
      <span className="min-w-0 truncate font-mono text-[11px] text-faint" title={chat.cwd}>
        {chat.cwd}
      </span>
    </div>
  )
}

function Toolbar({ chat }: { chat: ChatSession }) {
  const models = chat.models.length ? chat.models : FALLBACK_MODELS.map((m) => ({ ...m, description: '', effortLevels: [] }))
  const modelValue = chat.model ?? 'default'
  const modelInfo = models.find((m) => m.value === modelValue)
  const effortLevels = modelInfo?.effortLevels ?? []
  const contextPercent = chat.contextTokens && chat.contextWindow ? Math.min(100, Math.round((chat.contextTokens / chat.contextWindow) * 100)) : null
  const turnRunning = chat.status === 'working'

  return (
    <div className="flex min-w-0 flex-wrap items-center gap-1">
      <Select
        value={modelValue}
        title={modelInfo?.description || 'Modèle'}
        disabled={turnRunning}
        onChange={(value) => void setModel(chat.id, value === 'default' ? null : value)}
        options={[
          ...models.map((m) => ({ value: m.value, label: m.displayName })),
          ...(models.some((m) => m.value === modelValue) ? [] : [{ value: modelValue, label: modelValue }])
        ]}
      />
      {effortLevels.length > 0 && (
        <Select
          value={chat.effort ?? ''}
          title="Effort de réflexion"
          disabled={turnRunning}
          onChange={(value) => void setEffort(chat.id, value || null)}
          options={[{ value: '', label: 'Effort auto' }, ...effortLevels.map((level) => ({ value: level, label: `Effort ${level}` }))]}
        />
      )}
      <Select
        value={chat.permissionMode}
        title={PERMISSION_MODES.find((m) => m.value === chat.permissionMode)?.hint ?? 'Autorisations'}
        onChange={(value) => void setPermissionMode(chat.id, value as ChatPermissionMode)}
        options={[
          ...PERMISSION_MODES.map((m) => ({ value: m.value, label: m.label })),
          ...(PERMISSION_MODES.some((m) => m.value === chat.permissionMode) ? [] : [{ value: chat.permissionMode, label: chat.permissionMode }])
        ]}
        tone={chat.permissionMode === 'bypassPermissions' ? 'danger' : chat.permissionMode === 'plan' ? 'accent' : undefined}
      />
      {contextPercent !== null && (
        <span
          className="ml-1 flex items-center gap-1.5 text-[11px] text-faint"
          title={`Contexte utilisé : ${formatTokens(chat.contextTokens!)} sur ${formatTokens(chat.contextWindow!)}`}
        >
          <span className="h-1 w-10 overflow-hidden rounded-full bg-line">
            <span className={`block h-full ${contextPercent > 80 ? 'bg-amber-400' : 'bg-faint'}`} style={{ width: `${contextPercent}%` }} />
          </span>
          {contextPercent} %
        </span>
      )}
      {chat.costUsd !== null && chat.costUsd > 0 && (
        <span className="ml-1 text-[11px] text-faint" title="Coût estimé de la session au tarif de l’API (couvert par ton abonnement si tu en as un)">
          {chat.costUsd.toLocaleString('fr-FR', { style: 'currency', currency: 'USD', maximumFractionDigits: 2 })}
        </span>
      )}
    </div>
  )
}

function Select(props: {
  value: string
  options: { value: string; label: string }[]
  onChange(value: string): void
  title?: string
  disabled?: boolean
  tone?: 'danger' | 'accent'
}) {
  const color = props.tone === 'danger' ? 'text-red-300' : props.tone === 'accent' ? 'text-accent' : 'text-muted'
  return (
    <select
      value={props.value}
      title={props.title}
      disabled={props.disabled}
      onChange={(e) => props.onChange(e.target.value)}
      className={`max-w-40 cursor-pointer truncate rounded border-0 bg-transparent px-1.5 py-1 text-[11.5px] outline-none hover:bg-panel-2 hover:text-fg disabled:cursor-default disabled:opacity-50 ${color}`}
    >
      {props.options.map((option) => (
        <option key={option.value} value={option.value} className="bg-panel text-fg">
          {option.label}
        </option>
      ))}
    </select>
  )
}

function Working({ activity }: { activity: string | null }) {
  return (
    <div className="flex items-center gap-2 text-[12px] text-muted">
      <LoaderCircle size={13} className="animate-spin text-sky-400" />
      {activity ?? 'Claude travaille…'}
    </div>
  )
}

function ExitedBanner({ chat }: { chat: ChatSession }) {
  return (
    <div className="flex items-center gap-3 rounded-lg border border-line bg-panel px-3 py-2 text-[12.5px]">
      <span className="min-w-0 flex-1 text-muted">
        {chat.error ? 'Claude s’est arrêté.' : 'Claude est arrêté.'} Ton prochain message le relancera sur cette conversation.
      </span>
      <button
        onClick={() => void ensureStarted(chat.id)}
        className="flex shrink-0 items-center gap-1.5 rounded-md border border-line px-2 py-1 text-fg hover:bg-panel-2"
      >
        <RotateCcw size={12} /> Relancer
      </button>
    </div>
  )
}

function EmptyChat({ cwd }: { cwd: string }) {
  return (
    <div className="flex flex-col items-center gap-2 py-16 text-center">
      <Sparkles size={22} className="text-accent" />
      <div className="text-[14px] font-medium text-fg">Nouvelle conversation avec Claude</div>
      <div className="max-w-md font-mono text-[11.5px] break-all text-faint">{cwd}</div>
      <div className="mt-2 max-w-md text-[12px] text-muted">
        <kbd className="rounded bg-panel-2 px-1">/</kbd> pour les commandes et skills, <kbd className="rounded bg-panel-2 px-1">@</kbd> pour citer un fichier, colle une image pour la montrer.{' '}
        {shortcutLabel('toggleAgentView')} pour passer la conversation dans un terminal.
      </div>
    </div>
  )
}

function formatTokens(tokens: number): string {
  return tokens >= 1000 ? `${Math.round(tokens / 1000)}k tokens` : `${tokens} tokens`
}
