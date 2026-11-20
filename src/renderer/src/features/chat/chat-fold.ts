/**
 * Folds Claude Code's stream-json output (live, or transcript records read back) into the rows
 * the chat shows. Pure bookkeeping, no React: `ChatFold` keeps the indexes that let a delta find
 * its row, and hands out a new `items` array whenever something changed.
 *
 * Streaming: text and thinking arrive as deltas under `block:<message id>:<index>`; the matching
 * `assistant` frame (one per content block, sent before the block's stop) then overwrites that row
 * with the final content, so nothing is drawn twice. Tool calls are keyed by their `tool_use` id and
 * completed by the `tool_result` in a later `user` frame. Rows from a subagent carry the id of the
 * Task call that started it (`parentId`).
 */
import type { ChatWireMessage } from '@shared/types'

export interface ToolResult {
  text: string
  isError: boolean
  images: number
}

interface RowBase {
  id: string
  /** Task / Agent call this row belongs to (subagent), or null for the main conversation. */
  parentId: string | null
}

export type ChatItem =
  | (RowBase & { kind: 'user'; text: string; images: number; uuid: string | null; state: 'queued' | 'sent' | 'cancelled' })
  | (RowBase & { kind: 'command'; name: string; args: string; output: string | null })
  | (RowBase & { kind: 'text'; text: string; streaming: boolean })
  | (RowBase & { kind: 'thinking'; text: string; streaming: boolean })
  | (RowBase & { kind: 'tool'; name: string; input: Record<string, unknown>; streaming: boolean; result: ToolResult | null })
  | (RowBase & { kind: 'notice'; tone: 'info' | 'warning' | 'error'; text: string })
  | (RowBase & { kind: 'turn'; durationMs: number | null; costUsd: number | null; outcome: 'success' | 'error' | 'cancelled'; error: string | null })

export type ChatItemOf<K extends ChatItem['kind']> = Extract<ChatItem, { kind: K }>

/** Side effects of a batch the store cares about (status, session id…). */
export interface FoldSignals {
  sessionId?: string
  model?: string
  permissionMode?: string
  /** `running` / `requires_action` / `idle` (session state frames), or a turn's end. */
  state?: 'running' | 'idle' | 'requires_action'
  turnEnded?: boolean
  /** The latest root assistant message's usage: what the context holds now. */
  contextTokens?: number
  contextWindow?: number
  costUsd?: number
  activity?: string | null
  slashCommands?: string[]
  authFailed?: boolean
  /** `/clear`: the conversation started over. */
  reset?: boolean
  /** A permission prompt was withdrawn by Claude. */
  cancelledRequests?: string[]
  permissionRequests?: ChatWireMessage[]
}

const INTERRUPTED_RE = /^\[Request interrupted by user[^\]]*\]$/
const INJECTED_RE = /^<([a-z][\w-]*)>[\s\S]*<\/\1>$/

export class ChatFold {
  items: ChatItem[] = []
  private index = new Map<string, number>()
  /** Per scope (subagent or root): streamed rows of each message waiting for their `assistant` frame. */
  private pendingBlocks = new Map<string, string[]>()
  /** Message id currently streaming, per scope. */
  private streamingMessage = new Map<string, string>()
  /** `<scope>:<block index>` → row id, while a block streams. */
  private blockIds = new Map<string, string>()
  /** Tool input JSON received so far, per tool call. */
  private partialJson = new Map<string, string>()
  private changed = false
  private localCounter = 0
  private replaySeen = false

  /** Folds a batch; returns what the store should apply besides the rows. */
  apply(messages: ChatWireMessage[]): FoldSignals {
    const signals: FoldSignals = {}
    for (const message of messages) {
      try {
        this.one(message, signals)
      } catch (error) {
        console.warn('[capitaine] chat frame skipped', error, message)
      }
    }
    return signals
  }

  /** Rebuilds the id index after `items` was replaced from outside (history prepended). */
  reindex(): void {
    this.index = new Map(this.items.map((item, i) => [item.id, i]))
    this.changed = true
  }

  /** True once since the last call when rows changed. */
  takeChanged(): boolean {
    const changed = this.changed
    this.changed = false
    return changed
  }

  /** A message the user just sent, shown before Claude takes it. */
  addUser(text: string, images: number, uuid: string): void {
    this.push({ kind: 'user', id: `user:${uuid}`, parentId: null, text, images, uuid, state: 'queued' })
  }

  addNotice(tone: 'info' | 'warning' | 'error', text: string): void {
    this.push({ kind: 'notice', id: `notice:${++this.localCounter}`, parentId: null, tone, text })
  }

  /** Queued messages Claude dropped (interrupt). */
  cancelQueued(uuids: string[]): void {
    for (const uuid of uuids) {
      const at = this.index.get(`user:${uuid}`)
      const item = at !== undefined ? this.items[at] : undefined
      if (item?.kind === 'user' && item.state === 'queued') this.replaceAt(at!, { ...item, state: 'cancelled' })
    }
  }

  hasQueued(): boolean {
    return this.items.some((item) => item.kind === 'user' && item.state === 'queued')
  }

  /** Rows still streaming are settled (Claude stopped mid-turn). */
  settleStreaming(): void {
    this.items.forEach((item, i) => {
      if ((item.kind === 'text' || item.kind === 'thinking' || item.kind === 'tool') && item.streaming) this.replaceAt(i, { ...item, streaming: false })
    })
    this.pendingBlocks.clear()
    this.streamingMessage.clear()
  }

  private one(message: ChatWireMessage, signals: FoldSignals): void {
    const parentId = typeof message.parent_tool_use_id === 'string' ? message.parent_tool_use_id : null
    switch (message.type) {
      case 'stream_event':
        return this.streamEvent(message.event as StreamEvent, parentId)
      case 'assistant':
        return this.assistant(message, parentId, signals)
      case 'user':
        return this.user(message, parentId)
      case 'attachment':
        return this.queuedPrompt(message)
      case 'result':
        return this.result(message, parentId, signals)
      case 'system':
        return this.system(message, signals)
      case 'conversation_reset':
        return this.reset(message, signals)
      case 'control_request': {
        const request = message.request as { subtype?: string } | undefined
        if (request?.subtype === 'can_use_tool') (signals.permissionRequests ??= []).push(message)
        return
      }
      case 'control_cancel_request':
        if (typeof message.request_id === 'string') (signals.cancelledRequests ??= []).push(message.request_id)
        return
    }
  }

  private streamEvent(event: StreamEvent | undefined, parentId: string | null): void {
    if (!event) return
    const scope = parentId ?? ''
    switch (event.type) {
      case 'message_start':
        if (event.message?.id) this.streamingMessage.set(scope, event.message.id)
        return
      case 'content_block_start': {
        const messageId = this.streamingMessage.get(scope)
        const block = event.content_block
        if (!messageId || !block || typeof event.index !== 'number') return
        let id: string
        if (block.type === 'text') {
          id = `block:${messageId}:${event.index}`
          this.upsert({ kind: 'text', id, parentId, text: block.text ?? '', streaming: true })
        } else if (block.type === 'thinking') {
          id = `block:${messageId}:${event.index}`
          this.upsert({ kind: 'thinking', id, parentId, text: block.thinking ?? '', streaming: true })
        } else if (block.type === 'tool_use' && block.id) {
          id = block.id
          this.upsert({ kind: 'tool', id, parentId, name: block.name ?? 'outil', input: {}, streaming: true, result: null })
          this.partialJson.set(id, '')
        } else {
          return
        }
        this.blockIds.set(`${scope}:${event.index}`, id)
        const pending = this.pendingBlocks.get(`${scope}|${messageId}`) ?? []
        pending.push(id)
        this.pendingBlocks.set(`${scope}|${messageId}`, pending)
        return
      }
      case 'content_block_delta': {
        if (typeof event.index !== 'number' || !event.delta) return
        const id = this.blockIds.get(`${scope}:${event.index}`)
        const at = id ? this.index.get(id) : undefined
        if (at === undefined) return
        const item = this.items[at]
        const delta = event.delta
        if (delta.type === 'text_delta' && item.kind === 'text' && item.streaming) this.replaceAt(at, { ...item, text: item.text + (delta.text ?? '') })
        else if (delta.type === 'thinking_delta' && item.kind === 'thinking' && item.streaming) this.replaceAt(at, { ...item, text: item.text + (delta.thinking ?? '') })
        else if (delta.type === 'input_json_delta' && item.kind === 'tool' && item.streaming) {
          const json = (this.partialJson.get(item.id) ?? '') + (delta.partial_json ?? '')
          this.partialJson.set(item.id, json)
          // Shows the command or path as it's being written, when the JSON so far parses.
          const input = parsePartialJson(json)
          if (input) this.replaceAt(at, { ...item, input })
        }
        return
      }
      case 'content_block_stop': {
        if (typeof event.index !== 'number') return
        const key = `${scope}:${event.index}`
        const id = this.blockIds.get(key)
        this.blockIds.delete(key)
        const at = id ? this.index.get(id) : undefined
        if (at === undefined) return
        const item = this.items[at]
        if ((item.kind === 'text' || item.kind === 'thinking') && item.streaming) this.replaceAt(at, { ...item, streaming: false })
        return
      }
      case 'message_stop':
        this.streamingMessage.delete(scope)
        return
    }
  }

  private assistant(message: ChatWireMessage, parentId: string | null, signals: FoldSignals): void {
    const body = message.message as AssistantBody | undefined
    if (!body || !Array.isArray(body.content)) return
    if (message.error === 'authentication_failed') signals.authFailed = true
    if (body.model === '<synthetic>') {
      const text = body.content.map((b) => (b.type === 'text' ? b.text ?? '' : '')).join('\n').trim()
      if (text && text !== 'No response requested.') this.addNotice(message.error ? 'error' : 'info', text)
      return
    }
    if (!parentId && body.usage) {
      const u = body.usage
      const tokens = (u.input_tokens ?? 0) + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0) + (u.output_tokens ?? 0)
      if (tokens > 0) signals.contextTokens = tokens
    }
    const scope = parentId ?? ''
    const pendingKey = body.id ? `${scope}|${body.id}` : null
    body.content.forEach((block, i) => {
      // The frame's block replaces the oldest row streamed for this message.
      const pending = pendingKey ? this.pendingBlocks.get(pendingKey) : undefined
      const streamedId = pending?.shift()
      if (pending && pending.length === 0 && pendingKey) this.pendingBlocks.delete(pendingKey)
      const id = streamedId ?? (block.type === 'tool_use' && block.id ? block.id : `block:${body.id ?? message.uuid ?? ++this.localCounter}:h${i}:${this.localCounter++}`)
      if (block.type === 'text') {
        const text = block.text ?? ''
        if (!text.trim() && !streamedId) return
        this.upsert({ kind: 'text', id, parentId, text, streaming: false })
      } else if (block.type === 'thinking') {
        const text = block.thinking ?? ''
        const at = this.index.get(id)
        const streamed = at !== undefined ? this.items[at] : undefined
        // Thinking may be withheld (empty): keep whatever streamed, or show nothing.
        const finalText = text || (streamed?.kind === 'thinking' ? streamed.text : '')
        if (!finalText && at === undefined) return
        this.upsert({ kind: 'thinking', id, parentId, text: finalText, streaming: false })
      } else if (block.type === 'tool_use' && block.id) {
        const toolId = block.id
        const existing = this.index.get(toolId)
        const previous = existing !== undefined ? this.items[existing] : undefined
        this.partialJson.delete(toolId)
        this.upsert({
          kind: 'tool',
          id: toolId,
          parentId,
          name: block.name ?? 'outil',
          input: isRecord(block.input) ? block.input : {},
          streaming: false,
          result: previous?.kind === 'tool' ? previous.result : null
        })
      }
    })
  }

  private user(message: ChatWireMessage, parentId: string | null): void {
    const body = message.message as { content?: unknown } | undefined
    const content = body?.content
    const uuid = typeof message.uuid === 'string' ? message.uuid : null

    // Replay of a message sent from here: it's now with Claude.
    if (message.isReplay) this.replaySeen = true
    if (uuid && message.isReplay) {
      const at = this.index.get(`user:${uuid}`)
      const item = at !== undefined ? this.items[at] : undefined
      if (item?.kind === 'user') {
        if (item.state !== 'sent') this.replaceAt(at!, { ...item, state: 'sent' })
        return
      }
    }

    if (typeof content === 'string') return this.userText(content, uuid, parentId)
    if (!Array.isArray(content)) return
    const texts: string[] = []
    let images = 0
    for (const block of content as ContentBlock[]) {
      if (block?.type === 'tool_result' && block.tool_use_id) {
        const at = this.index.get(block.tool_use_id)
        const item = at !== undefined ? this.items[at] : undefined
        if (item?.kind === 'tool') this.replaceAt(at!, { ...item, streaming: false, result: toolResult(block) })
      } else if (block?.type === 'text' && typeof block.text === 'string') {
        texts.push(block.text)
      } else if (block?.type === 'image') {
        images++
      }
    }
    if (texts.length || images) this.userText(texts.join('\n'), uuid, parentId, images)
  }

  private userText(text: string, uuid: string | null, parentId: string | null, images = 0): void {
    // Subagent prompts are the Task call's input, already shown on its card.
    if (parentId) return
    const trimmed = text.trim()
    if (!trimmed && !images) return
    if (INTERRUPTED_RE.test(trimmed)) {
      this.addNotice('warning', 'Interrompu')
      return
    }
    const command = /<command-name>\s*\/?([^<]*)<\/command-name>/.exec(trimmed)
    if (command) {
      const args = /<command-args>([\s\S]*?)<\/command-args>/.exec(trimmed)?.[1]?.trim() ?? ''
      const id = `command:${uuid ?? ++this.localCounter}`
      if (!this.index.has(id)) this.push({ kind: 'command', id, parentId: null, name: command[1].trim(), args, output: null })
      return
    }
    const stdout = /<local-command-(?:stdout|stderr)>([\s\S]*?)<\/local-command-(?:stdout|stderr)>/.exec(trimmed)
    if (stdout) {
      const output = stripAnsi(stdout[1]).trim()
      // Attach to the command just above when there is one.
      const last = this.items[this.items.length - 1]
      if (last?.kind === 'command' && last.output === null) this.replaceAt(this.items.length - 1, { ...last, output })
      else if (output) this.addNotice('info', output)
      return
    }
    // Notes Claude Code injects as user turns (task notifications, reminders, caveats): not the user's words.
    if (INJECTED_RE.test(trimmed)) return
    const id = uuid ? `user:${uuid}` : `user:h${++this.localCounter}`
    if (this.index.has(id)) return
    this.push({ kind: 'user', id, parentId: null, text: trimmed, images, uuid, state: 'sent' })
  }

  /** Transcript: a prompt typed while Claude was busy. */
  private queuedPrompt(message: ChatWireMessage): void {
    const attachment = message.attachment as { prompt?: unknown; content?: unknown } | undefined
    const prompt = typeof attachment?.prompt === 'string' ? attachment.prompt : typeof attachment?.content === 'string' ? attachment.content : null
    if (prompt) this.userText(prompt, typeof message.uuid === 'string' ? message.uuid : null, null)
  }

  private result(message: ChatWireMessage, parentId: string | null, signals: FoldSignals): void {
    if (parentId) return
    this.settleStreaming()
    // A Claude that doesn't echo messages never confirms them: a finished turn took them all.
    if (!this.replaySeen) {
      this.items.forEach((item, i) => {
        if (item.kind === 'user' && item.state === 'queued') this.replaceAt(i, { ...item, state: 'sent' })
      })
    }
    const reason = message.terminal_reason
    const cancelled = reason === 'aborted_streaming' || reason === 'aborted_tools'
    const isError = !cancelled && message.is_error === true
    const errors = Array.isArray(message.errors) ? message.errors.filter((e): e is string => typeof e === 'string') : []
    const error = isError ? errors.join('\n') || (typeof message.result === 'string' ? message.result : null) || 'Claude a rencontré une erreur.' : null
    this.push({
      kind: 'turn',
      id: `turn:${typeof message.uuid === 'string' ? message.uuid : ++this.localCounter}`,
      parentId: null,
      durationMs: typeof message.duration_ms === 'number' ? message.duration_ms : null,
      costUsd: typeof message.total_cost_usd === 'number' ? message.total_cost_usd : null,
      outcome: cancelled ? 'cancelled' : isError ? 'error' : 'success',
      error
    })
    if (typeof message.total_cost_usd === 'number') signals.costUsd = message.total_cost_usd
    const usage = message.modelUsage as Record<string, { contextWindow?: number }> | undefined
    const window = usage && Object.values(usage).map((u) => u?.contextWindow).find((w): w is number => typeof w === 'number')
    if (window) signals.contextWindow = window
    signals.turnEnded = true
    signals.state = 'idle'
    signals.activity = null
  }

  private system(message: ChatWireMessage, signals: FoldSignals): void {
    switch (message.subtype) {
      case 'init':
        if (typeof message.session_id === 'string') signals.sessionId = message.session_id
        if (typeof message.model === 'string') signals.model = message.model
        if (typeof message.permissionMode === 'string') signals.permissionMode = message.permissionMode
        if (Array.isArray(message.slash_commands)) signals.slashCommands = message.slash_commands.filter((c): c is string => typeof c === 'string')
        return
      case 'status':
        if (typeof message.permissionMode === 'string') signals.permissionMode = message.permissionMode
        signals.activity = message.status === 'compacting' ? 'Compactage de la conversation…' : null
        return
      case 'compact_boundary': {
        const meta = message.compact_metadata as { trigger?: string; pre_tokens?: number } | undefined
        const before = typeof meta?.pre_tokens === 'number' ? ` (${Math.round(meta.pre_tokens / 1000)}k tokens résumés)` : ''
        this.addNotice('info', `Conversation compactée${before}`)
        return
      }
      case 'api_retry': {
        const attempt = typeof message.attempt === 'number' ? message.attempt : null
        const max = typeof message.max_retries === 'number' ? message.max_retries : null
        signals.activity = `Nouvelle tentative${attempt ? ` ${attempt}${max ? `/${max}` : ''}` : ''}…`
        return
      }
      case 'session_state_changed':
        if (message.state === 'idle' || message.state === 'running' || message.state === 'requires_action') signals.state = message.state
        return
      case 'local_command_output': {
        const text = typeof message.content === 'string' ? stripAnsi(message.content).trim() : ''
        const last = this.items[this.items.length - 1]
        if (last?.kind === 'command' && last.output === null) this.replaceAt(this.items.length - 1, { ...last, output: text })
        else if (text) this.addNotice('info', text)
        return
      }
      case 'informational':
      case 'notification': {
        const text = typeof message.content === 'string' ? message.content : typeof message.message === 'string' ? message.message : ''
        if (text.trim()) this.addNotice('info', stripAnsi(text).trim())
        return
      }
    }
  }

  /** `/clear`: the transcript starts over, keeping only messages still waiting for Claude. */
  private reset(message: ChatWireMessage, signals: FoldSignals): void {
    const trigger = typeof message.user_message_uuid === 'string' ? message.user_message_uuid : null
    const queued = this.items.filter((item) => item.kind === 'user' && item.state === 'queued' && item.uuid !== trigger)
    // The command's own row comes first; its replay, right after, finds it there.
    const command: ChatItem[] = trigger ? [{ kind: 'command', id: `command:${trigger}`, parentId: null, name: 'clear', args: '', output: null }] : []
    this.items = [...command, ...queued]
    this.index = new Map(this.items.map((item, i) => [item.id, i]))
    this.pendingBlocks.clear()
    this.streamingMessage.clear()
    this.blockIds.clear()
    this.partialJson.clear()
    this.changed = true
    delete signals.contextTokens
    signals.reset = true
  }

  private push(item: ChatItem): void {
    this.items = [...this.items, item]
    this.index.set(item.id, this.items.length - 1)
    this.changed = true
  }

  private upsert(item: ChatItem): void {
    const at = this.index.get(item.id)
    if (at === undefined) this.push(item)
    else this.replaceAt(at, item)
  }

  private replaceAt(at: number, item: ChatItem): void {
    const next = this.items.slice()
    next[at] = item
    this.items = next
    this.changed = true
  }
}

interface StreamEvent {
  type?: string
  index?: number
  message?: { id?: string }
  content_block?: { type?: string; id?: string; name?: string; text?: string; thinking?: string }
  delta?: { type?: string; text?: string; thinking?: string; partial_json?: string }
}

interface ContentBlock {
  type?: string
  text?: string
  thinking?: string
  id?: string
  name?: string
  input?: unknown
  tool_use_id?: string
  content?: unknown
  is_error?: boolean
}

interface AssistantBody {
  id?: string
  model?: string
  content: ContentBlock[]
  usage?: { input_tokens?: number; cache_read_input_tokens?: number; cache_creation_input_tokens?: number; output_tokens?: number }
}

function toolResult(block: ContentBlock): ToolResult {
  let text = ''
  let images = 0
  if (typeof block.content === 'string') text = block.content
  else if (Array.isArray(block.content)) {
    const parts: string[] = []
    for (const part of block.content as ContentBlock[]) {
      if (part?.type === 'text' && typeof part.text === 'string') parts.push(part.text)
      else if (part?.type === 'image') images++
    }
    text = parts.join('\n')
  }
  return { text: stripAnsi(text), isError: block.is_error === true, images }
}

/** Best-effort parse of a JSON object still being written: closes open strings and braces. */
export function parsePartialJson(json: string): Record<string, unknown> | null {
  if (!json.trim()) return null
  try {
    const value: unknown = JSON.parse(json)
    return isRecord(value) ? value : null
  } catch {
    // Complete it below.
  }
  let inString = false
  let escaped = false
  const stack: string[] = []
  for (const char of json) {
    if (escaped) {
      escaped = false
      continue
    }
    if (char === '\\') {
      escaped = inString
      continue
    }
    if (char === '"') inString = !inString
    else if (!inString && (char === '{' || char === '[')) stack.push(char === '{' ? '}' : ']')
    else if (!inString && (char === '}' || char === ']')) stack.pop()
  }
  let completed = json + (inString ? '"' : '')
  completed = completed.replace(/[,:]\s*$/, '')
  completed += stack.reverse().join('')
  try {
    const value: unknown = JSON.parse(completed)
    return isRecord(value) ? value : null
  } catch {
    return null
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g

export function stripAnsi(text: string): string {
  return text.replace(ANSI_RE, '')
}
