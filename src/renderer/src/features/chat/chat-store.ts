/**
 * Claude chats: one entry per chat pane, fed by the main process's `claude -p` (stream-json). The
 * conversation rows come from `ChatFold`; this store adds the process state, pending permission
 * prompts, the pickers' options, and reports the agent's status like a terminal Claude would.
 */
import { create } from 'zustand'
import type { ChatPermissionMode, ChatPermissionResponse, ChatUserContent, ChatWireMessage, SavedAgent } from '@shared/types'
import type { AgentChild, AgentReport } from '@/features/claude/agent-status'
import { useApp } from '@/features/workspace/workspace-store'
import { useAgentSettings } from './agent-settings'
import { ChatFold, type ChatItem, type ChatItemOf, type FoldSignals } from './chat-fold'

export interface ChatCommandInfo {
  name: string
  description: string
  argumentHint: string
}

export interface ChatModelInfo {
  value: string
  displayName: string
  description: string
  effortLevels: string[]
}

export interface PendingPermission {
  requestId: string
  toolName: string
  input: Record<string, unknown>
  toolUseId: string | null
  /** Claude's "always allow" proposals (rules, directories, mode). */
  suggestions: unknown[]
  blockedPath: string | null
  description: string | null
  decisionReason: string | null
  /** Set when a subagent asks. */
  agentId: string | null
}

export type ChatStatus = 'new' | 'starting' | 'ready' | 'working' | 'exited'

export interface ChatSession {
  id: string
  cwd: string
  sessionId: string | null
  status: ChatStatus
  /** Why Claude stopped or couldn't start. */
  error: string | null
  items: ChatItem[]
  permissions: PendingPermission[]
  model: string | null
  /** Model Claude reports using (full id). */
  activeModel: string | null
  permissionMode: ChatPermissionMode
  effort: string | null
  commands: ChatCommandInfo[]
  models: ChatModelInfo[]
  costUsd: number | null
  contextTokens: number | null
  contextWindow: number | null
  /** Transient line under the transcript (compacting, retrying…). */
  activity: string | null
  historyLoading: boolean
  historyTruncated: boolean
  /** The last turn ended while the chat wasn't looked at. */
  unseenDone: boolean
  capabilities: string[]
}

interface ChatsState {
  chats: Record<string, ChatSession>
}

export const useChats = create<ChatsState>(() => ({ chats: {} }))

const folds = new Map<string, ChatFold>()
/** Claude said its turn is over, though queued messages kept the chat busy. */
const idleSeen = new Set<string>()
/** Process starts in flight, so concurrent callers share one. */
const starting = new Map<string, Promise<boolean>>()

function patch(chatId: string, update: Partial<ChatSession> | ((chat: ChatSession) => Partial<ChatSession>)): void {
  useChats.setState((state) => {
    const chat = state.chats[chatId]
    if (!chat) return state
    const changes = typeof update === 'function' ? update(chat) : update
    return { chats: { ...state.chats, [chatId]: { ...chat, ...changes } } }
  })
  reportStatus(chatId)
}

export function chatOf(chatId: string): ChatSession | undefined {
  return useChats.getState().chats[chatId]
}

/** Creates the chat's state (and loads its saved conversation). Idempotent. */
export function openChat(chatId: string, options: { cwd: string; sessionId: string | null; args?: string[] }): void {
  if (chatOf(chatId)) return
  const defaults = useAgentSettings.getState()
  const carried = carriedOptions(options.args ?? [])
  const fold = new ChatFold()
  folds.set(chatId, fold)
  useChats.setState((state) => ({
    chats: {
      ...state.chats,
      [chatId]: {
        id: chatId,
        cwd: options.cwd,
        sessionId: options.sessionId,
        status: 'new',
        error: null,
        items: [],
        permissions: [],
        model: carried.model ?? defaults.model,
        activeModel: null,
        permissionMode: (carried.permissionMode as ChatPermissionMode | undefined) ?? defaults.permissionMode,
        effort: carried.effort ?? defaults.effort,
        commands: [],
        models: [],
        costUsd: null,
        contextTokens: null,
        contextWindow: null,
        activity: null,
        historyLoading: !!options.sessionId,
        historyTruncated: false,
        unseenDone: false,
        capabilities: []
      }
    }
  }))
  if (options.sessionId) void loadHistory(chatId, options.sessionId)
}

async function loadHistory(chatId: string, sessionId: string): Promise<void> {
  try {
    const history = await window.capitaine.chat.history(sessionId)
    const fold = folds.get(chatId)
    if (!fold || !chatOf(chatId)) return
    // Live frames may already be in: history goes first.
    const live = fold.items
    const replay = new ChatFold()
    replay.apply(history.records)
    replay.settleStreaming()
    fold.items = [...replay.items, ...live]
    fold.reindex()
    patch(chatId, { items: fold.items, historyLoading: false, historyTruncated: history.truncated })
    const firstUser = replay.items.find((item) => item.kind === 'user')
    if (firstUser?.kind === 'user') setTitleFrom(chatId, firstUser.text)
  } catch (error) {
    patch(chatId, { historyLoading: false })
    folds.get(chatId)?.addNotice('warning', `Historique illisible : ${String(error)}`)
    flushFold(chatId)
  }
}

/** Starts Claude for the chat if it isn't running. Resolves false when it couldn't start. */
export function ensureStarted(chatId: string): Promise<boolean> {
  const chat = chatOf(chatId)
  if (!chat) return Promise.resolve(false)
  if (chat.status === 'ready' || chat.status === 'working') return Promise.resolve(true)
  const inFlight = starting.get(chatId)
  if (inFlight) return inFlight
  const run = (async () => {
    patch(chatId, { status: 'starting', error: null })
    try {
      await window.capitaine.chat.start({
        chatId,
        cwd: chat.cwd,
        sessionId: chat.sessionId,
        model: chat.model,
        permissionMode: chat.permissionMode,
        effort: chat.effort
      })
      if (!chatOf(chatId)) return false
      const init = (await window.capitaine.chat.control(chatId, { subtype: 'initialize' })) as InitializeResponse | null
      if (!chatOf(chatId)) return false
      patch(chatId, {
        status: 'ready',
        commands: parseCommands(init?.commands),
        models: parseModels(init?.models),
        capabilities: Array.isArray(init?.capabilities) ? init.capabilities.filter((c): c is string => typeof c === 'string') : []
      })
      // Claude re-asks what was pending when it was restarted.
      for (const request of init?.pending_permission_requests ?? []) addPermission(chatId, request as ChatWireMessage)
      if (init?.account && (init.account as { tokenSource?: string }).tokenSource === 'none' && !(init.account as { apiKeySource?: string }).apiKeySource) {
        notice(chatId, 'error', 'Claude Code n’est pas connecté. Bascule ce chat en terminal et lance /login.')
      }
      return true
    } catch (error) {
      if (!chatOf(chatId)) return false
      window.capitaine.chat.stop(chatId)
      patch(chatId, { status: 'exited', error: messageOf(error) })
      return false
    } finally {
      starting.delete(chatId)
    }
  })()
  starting.set(chatId, run)
  return run
}

export async function sendMessage(chatId: string, text: string, images: ChatUserContent = []): Promise<void> {
  const trimmed = text.replace(/^\s+/, '')
  if (!trimmed.trim() && images.length === 0) return
  const fold = folds.get(chatId)
  if (!fold) return
  const modelCommand = images.length === 0 ? /^\/model\s+(\S+)\s*$/.exec(trimmed) : null
  if (modelCommand && chatOf(chatId)?.status !== 'working') return runModelCommand(chatId, modelCommand[1])
  const uuid = crypto.randomUUID()
  // Images first, then one text block: Claude reads slash commands from the last text block.
  const content: ChatUserContent = [...images, ...(trimmed.trim() ? [{ type: 'text' as const, text: trimmed }] : [])]
  fold.addUser(
    trimmed,
    images.map((image) => ({ src: image.type === 'image' ? `data:${image.source.media_type};base64,${image.source.data}` : null })),
    uuid
  )
  flushFold(chatId)
  setTitleFrom(chatId, trimmed)
  idleSeen.delete(chatId)
  patch(chatId, (chat) => ({ status: chat.status === 'ready' ? 'working' : chat.status, unseenDone: false }))
  if (!(await ensureStarted(chatId))) {
    notice(chatId, 'error', 'Message non envoyé : Claude n’a pas pu démarrer.')
    return
  }
  patch(chatId, { status: 'working' })
  window.capitaine.chat.send(chatId, uuid, content)
}

/**
 * `/model <name>` goes through `set_model`, like the picker: Claude then says which model it took
 * straight away (the command itself only shows on the next turn), and the picker follows. For this
 * conversation only, as in Claude Code: the default for new chats stays as it was.
 */
async function runModelCommand(chatId: string, name: string): Promise<void> {
  const fold = folds.get(chatId)
  if (!fold) return
  const row = fold.addCommand('model', name)
  flushFold(chatId)
  if (!(await ensureStarted(chatId))) {
    fold.setCommandOutput(row, 'Claude n’a pas pu démarrer.')
    flushFold(chatId)
    return
  }
  try {
    const answer = (await window.capitaine.chat.control(chatId, { subtype: 'set_model', model: name })) as { model?: unknown } | null
    const active = typeof answer?.model === 'string' ? answer.model : null
    const chat = chatOf(chatId)
    const label = chat?.models.find((m) => m.value === name)?.displayName ?? active ?? name
    patch(chatId, { model: name === 'default' ? null : name, ...(active ? { activeModel: active } : {}) })
    fold.setCommandOutput(row, `Modèle : ${label} (pour cette conversation)`)
  } catch (error) {
    fold.setCommandOutput(row, messageOf(error))
  }
  flushFold(chatId)
}

export async function interrupt(chatId: string): Promise<void> {
  const chat = chatOf(chatId)
  if (!chat || chat.status !== 'working') return
  const request = chat.capabilities.includes('interrupt_cancel_queued_v1') ? { subtype: 'interrupt', cancel_queued: true } : { subtype: 'interrupt' }
  try {
    const answer = (await window.capitaine.chat.control(chatId, request)) as { cancelled?: unknown } | null
    const cancelled = Array.isArray(answer?.cancelled) ? answer.cancelled.filter((id): id is string => typeof id === 'string') : []
    const fold = folds.get(chatId)
    if (!fold || cancelled.length === 0) return
    fold.cancelQueued(cancelled)
    flushFold(chatId)
    // The turn may already have ended: nothing is left to wait for.
    if (idleSeen.has(chatId) && !fold.hasQueued()) settleTurn(chatId)
  } catch (error) {
    notice(chatId, 'warning', `Interruption impossible : ${messageOf(error)}`)
  }
}

function settleTurn(chatId: string): void {
  patch(chatId, (chat) => (chat.status === 'working' ? { status: 'ready', activity: null, unseenDone: true } : {}))
}

export function answerPermission(chatId: string, requestId: string, response: ChatPermissionResponse): void {
  const chat = chatOf(chatId)
  const permission = chat?.permissions.find((p) => p.requestId === requestId)
  if (!chat || !permission) return
  const withId = permission.toolUseId ? { ...response, toolUseID: permission.toolUseId } : response
  window.capitaine.chat.respond(chatId, requestId, withId)
  patch(chatId, (c) => ({ permissions: c.permissions.filter((p) => p.requestId !== requestId) }))
}

export async function setModel(chatId: string, model: string | null): Promise<void> {
  useAgentSettings.getState().setModel(model)
  patch(chatId, { model })
  if (!isLive(chatId)) return
  try {
    await window.capitaine.chat.control(chatId, { subtype: 'set_model', model: model ?? 'default' })
  } catch (error) {
    notice(chatId, 'warning', `Changement de modèle impossible : ${messageOf(error)}`)
  }
}

export async function setPermissionMode(chatId: string, mode: ChatPermissionMode): Promise<void> {
  const previous = chatOf(chatId)?.permissionMode
  useAgentSettings.getState().setPermissionMode(mode)
  patch(chatId, { permissionMode: mode })
  if (!isLive(chatId)) return
  try {
    await window.capitaine.chat.control(chatId, { subtype: 'set_permission_mode', mode })
  } catch (error) {
    // Claude only bypasses permissions when launched that way: relaunch it on the same conversation.
    if (mode === 'bypassPermissions' && /dangerously-skip-permissions|bypass_not_launched/.test(messageOf(error))) {
      if (chatOf(chatId)?.status === 'working') {
        patch(chatId, { permissionMode: previous ?? 'default' })
        notice(chatId, 'warning', 'Attends la fin du tour pour passer en « Tout autoriser » : Claude doit être relancé.')
        return
      }
      window.capitaine.chat.stop(chatId)
      patch(chatId, { status: 'new' })
      if (await ensureStarted(chatId)) notice(chatId, 'info', 'Claude relancé en mode « Tout autoriser ».')
      return
    }
    notice(chatId, 'warning', `Changement de mode impossible : ${messageOf(error)}`)
  }
}

export async function setEffort(chatId: string, effort: string | null): Promise<void> {
  useAgentSettings.getState().setEffort(effort)
  patch(chatId, { effort })
  if (!isLive(chatId) || !effort) return
  try {
    await window.capitaine.chat.control(chatId, { subtype: 'apply_flag_settings', settings: { effortLevel: effort } })
  } catch (error) {
    notice(chatId, 'warning', `Changement d’effort impossible : ${messageOf(error)}`)
  }
}

/** The chat was looked at: its "done" badge goes. */
export function markSeen(chatId: string): void {
  if (chatOf(chatId)?.unseenDone) patch(chatId, { unseenDone: false })
}

/** Stops Claude and forgets the chat (pane closed or switched to a terminal). */
export function closeChat(chatId: string): void {
  window.capitaine.chat.stop(chatId)
  folds.delete(chatId)
  idleSeen.delete(chatId)
  starting.delete(chatId)
  useChats.setState((state) => {
    if (!state.chats[chatId]) return state
    const chats = { ...state.chats }
    delete chats[chatId]
    return { chats }
  })
}

/** What a terminal needs to carry on this conversation (also what the session file keeps). */
export function chatAgent(chatId: string): SavedAgent | null {
  const chat = chatOf(chatId)
  if (!chat) return null
  const args: string[] = []
  if (chat.model) args.push('--model', chat.model)
  if (chat.permissionMode !== 'default') args.push('--permission-mode', chat.permissionMode)
  if (chat.effort) args.push('--effort', chat.effort)
  return { sessionId: chat.sessionId, cwd: chat.cwd, args }
}

function isLive(chatId: string): boolean {
  const status = chatOf(chatId)?.status
  return status === 'ready' || status === 'working'
}

function notice(chatId: string, tone: 'info' | 'warning' | 'error', text: string): void {
  folds.get(chatId)?.addNotice(tone, text)
  flushFold(chatId)
}

function flushFold(chatId: string): void {
  const fold = folds.get(chatId)
  if (fold?.takeChanged()) patch(chatId, { items: fold.items })
}

function addPermission(chatId: string, message: ChatWireMessage): void {
  const request = message.request as Record<string, unknown> | undefined
  const requestId = typeof message.request_id === 'string' ? message.request_id : null
  if (!request || !requestId) return
  const permission: PendingPermission = {
    requestId,
    toolName: typeof request.tool_name === 'string' ? request.tool_name : 'outil',
    input: isRecord(request.input) ? request.input : {},
    toolUseId: typeof request.tool_use_id === 'string' ? request.tool_use_id : null,
    suggestions: Array.isArray(request.permission_suggestions) ? request.permission_suggestions : [],
    blockedPath: typeof request.blocked_path === 'string' ? request.blocked_path : null,
    description: typeof request.description === 'string' ? request.description : null,
    decisionReason: typeof request.decision_reason === 'string' ? request.decision_reason : null,
    agentId: typeof request.agent_id === 'string' ? request.agent_id : null
  }
  patch(chatId, (chat) => (chat.permissions.some((p) => p.requestId === requestId) ? {} : { permissions: [...chat.permissions, permission] }))
}

function applySignals(chatId: string, signals: FoldSignals): void {
  for (const request of signals.permissionRequests ?? []) addPermission(chatId, request)
  const update: Partial<ChatSession> = {}
  if (signals.sessionId) update.sessionId = signals.sessionId
  if (signals.model) update.activeModel = signals.model
  if (signals.permissionMode && isPermissionMode(signals.permissionMode)) update.permissionMode = signals.permissionMode
  if (signals.contextTokens !== undefined) update.contextTokens = signals.contextTokens
  if (signals.contextWindow !== undefined) update.contextWindow = signals.contextWindow
  if (signals.costUsd !== undefined) update.costUsd = signals.costUsd
  if (signals.activity !== undefined) update.activity = signals.activity
  if (signals.commands) update.commands = parseCommands(signals.commands)
  if (signals.reset) {
    update.contextTokens = signals.contextTokens ?? null
    update.historyTruncated = false
    // The next message names the new conversation.
    const pane = useApp.getState().terminals[chatId]
    if (pane?.view === 'chat' && pane.shellTitle) useApp.getState().setShellTitle(chatId, '')
  }
  patch(chatId, (chat) => {
    const next: Partial<ChatSession> = { ...update }
    if (signals.cancelledRequests?.length) next.permissions = chat.permissions.filter((p) => !signals.cancelledRequests!.includes(p.requestId))
    if (signals.state === 'running') {
      idleSeen.delete(chatId)
      if (chat.status === 'ready') next.status = 'working'
    }
    if (signals.turnEnded || (signals.state === 'idle' && chat.status === 'working')) {
      idleSeen.add(chatId)
      // Messages typed during the turn are still queued: Claude goes on with them.
      if (!folds.get(chatId)?.hasQueued()) {
        next.status = 'ready'
        next.activity = null
        if (chat.status === 'working') next.unseenDone = true
      }
    }
    return next
  })
  if (signals.authFailed) notice(chatId, 'error', 'Claude Code n’est pas connecté. Bascule ce chat en terminal et lance /login.')
}

/** Mirrors the chat into the agent status the sidebar, tab icons and notifications use. */
function reportStatus(chatId: string): void {
  const chat = chatOf(chatId)
  const app = useApp.getState()
  if (!chat || !app.terminals[chatId]) return
  let report: AgentReport
  const permission = chat.permissions[0]
  if (permission) {
    report = { id: null, state: 'blocked', kind: isQuestion(permission) ? 'question' : 'permission', app: 'claude-code', msg: permissionSummary(permission) }
  } else if (chat.status === 'working' || chat.status === 'starting') {
    report = { id: null, state: 'working', app: 'claude-code' }
  } else if (chat.status === 'exited' && chat.error) {
    report = { id: null, state: 'error', app: 'claude-code' }
  } else if (chat.unseenDone) {
    report = { id: null, state: 'done', app: 'claude-code' }
  } else {
    // Nothing to signal: the tab shows its chat icon.
    if (app.agents[chatId]) app.clearAgent(chatId)
    return
  }
  const current = app.agents[chatId]
  if (!current || current.state !== report.state || current.kind !== report.kind || current.msg !== report.msg) {
    app.applyAgentReport(chatId, report)
  }
  syncSubagents(chatId, runningSubagents(chat))
}

const SUBAGENT_TOOLS = new Set(['Task', 'Agent'])

/**
 * The subagents still at work, as a terminal Claude reports them: one child per Task / Agent call
 * without a result, its id the path of calls from the main conversation (`outer/inner`).
 */
function runningSubagents(chat: ChatSession): AgentChild[] {
  if (chat.status !== 'working' && chat.status !== 'starting') return []
  const calls = new Map<string, ChatItemOf<'tool'>>()
  for (const item of chat.items) {
    if (item.kind === 'tool' && SUBAGENT_TOOLS.has(item.name)) calls.set(item.id, item)
  }
  if (calls.size === 0) return []

  // A permission asked from inside a subagent blocks that subagent.
  const waiting = new Map<string, PendingPermission>()
  for (const permission of chat.permissions) {
    const asking = permission.toolUseId ? chat.items.find((item) => item.id === permission.toolUseId) : undefined
    if (asking?.parentId && !waiting.has(asking.parentId)) waiting.set(asking.parentId, permission)
  }

  const children: AgentChild[] = []
  for (const call of calls.values()) {
    if (call.result) continue
    const path = [call.id]
    for (let parent = call.parentId; parent && path.length < 8; parent = calls.get(parent)?.parentId ?? null) path.unshift(parent)
    const permission = waiting.get(call.id)
    const title = text(call.input.description) || text(call.input.subagent_type) || undefined
    children.push(
      permission
        ? { id: path.join('/'), state: 'blocked', kind: isQuestion(permission) ? 'question' : 'permission', title, msg: permissionSummary(permission) }
        : { id: path.join('/'), state: 'working', title }
    )
  }
  return children
}

/** Brings the sidebar's subagent rows in line with `children`, touching only what changed. */
function syncSubagents(chatId: string, children: AgentChild[]): void {
  const app = useApp.getState()
  const current = app.agents[chatId]?.children ?? []
  const wanted = new Set(children.map((child) => child.id))
  for (const child of current) {
    if (!wanted.has(child.id)) app.applyAgentReport(chatId, { id: child.id, state: 'clear' })
  }
  for (const child of children) {
    const shown = current.find((c) => c.id === child.id)
    if (shown && shown.state === child.state && shown.kind === child.kind && shown.title === child.title && shown.msg === child.msg) continue
    app.applyAgentReport(chatId, { ...child, app: 'claude-code' })
  }
}

function isQuestion(permission: PendingPermission): boolean {
  return permission.toolName === 'AskUserQuestion' || permission.toolName === 'ExitPlanMode'
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/** One line for the sidebar and the notification: what Claude is waiting on. */
function permissionSummary(permission: PendingPermission): string {
  if (permission.toolName === 'AskUserQuestion') return 'Claude te pose une question'
  if (permission.toolName === 'ExitPlanMode') return 'Claude propose un plan'
  const command = typeof permission.input.command === 'string' ? permission.input.command : null
  const path = typeof permission.input.file_path === 'string' ? permission.input.file_path : null
  const text = `${permission.toolName}${command ? ` : ${command}` : path ? ` : ${path}` : ''}`
  return text.length > 200 ? `${text.slice(0, 199)}…` : text
}

function setTitleFrom(chatId: string, text: string): void {
  const app = useApp.getState()
  const pane = app.terminals[chatId]
  if (!pane || pane.shellTitle || pane.view !== 'chat') return
  const line = text.replace(/\s+/g, ' ').trim()
  if (!line || line.startsWith('/')) return
  app.setShellTitle(chatId, line.length > 48 ? `${line.slice(0, 47)}…` : line)
}

window.capitaine.chat.onMessages((chatId, messages) => {
  const fold = folds.get(chatId)
  if (!fold) return
  const signals = fold.apply(messages)
  flushFold(chatId)
  applySignals(chatId, signals)
})

window.capitaine.chat.onExit((chatId, _code, error) => {
  const fold = folds.get(chatId)
  if (!fold) return
  fold.settleStreaming()
  if (error) fold.addNotice('error', error)
  flushFold(chatId)
  patch(chatId, { status: 'exited', error, permissions: [], activity: null })
})

interface InitializeResponse {
  commands?: unknown[]
  models?: unknown[]
  account?: unknown
  capabilities?: unknown[]
  pending_permission_requests?: unknown[]
}

function parseCommands(raw: unknown[] | undefined): ChatCommandInfo[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((entry) => {
    if (!isRecord(entry) || typeof entry.name !== 'string') return []
    return [{ name: entry.name, description: typeof entry.description === 'string' ? entry.description : '', argumentHint: typeof entry.argumentHint === 'string' ? entry.argumentHint : '' }]
  })
}

function parseModels(raw: unknown[] | undefined): ChatModelInfo[] {
  if (!Array.isArray(raw)) return []
  return raw.flatMap((entry) => {
    if (!isRecord(entry) || typeof entry.value !== 'string' || entry.disabled === true) return []
    return [
      {
        value: entry.value,
        displayName: typeof entry.displayName === 'string' ? entry.displayName : entry.value,
        description: typeof entry.description === 'string' ? entry.description : '',
        effortLevels: Array.isArray(entry.supportedEffortLevels) ? entry.supportedEffortLevels.filter((l): l is string => typeof l === 'string') : []
      }
    ]
  })
}

/** Model, permission mode and effort carried over from a terminal's `claude` command line. */
function carriedOptions(args: string[]): { model?: string; permissionMode?: string; effort?: string } {
  const result: { model?: string; permissionMode?: string; effort?: string } = {}
  for (let i = 0; i < args.length; i++) {
    const value = args[i + 1]
    if (args[i] === '--model' && value) result.model = value
    if (args[i] === '--permission-mode' && value && isPermissionMode(value)) result.permissionMode = value
    if (args[i] === '--effort' && value) result.effort = value
    if (args[i] === '--dangerously-skip-permissions') result.permissionMode = 'bypassPermissions'
  }
  return result
}

function isPermissionMode(value: string): value is ChatPermissionMode {
  return ['default', 'acceptEdits', 'auto', 'plan', 'bypassPermissions', 'dontAsk'].includes(value)
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function messageOf(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error)
  // Electron prefixes errors thrown in the main process.
  return text.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
}
