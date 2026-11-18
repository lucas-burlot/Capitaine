import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { statSync } from 'node:fs'
import { homedir } from 'node:os'
import type { WebContents } from 'electron'
import type { ChatControlRequest, ChatPermissionMode, ChatPermissionResponse, ChatStartOptions, ChatUserContent, ChatWireMessage } from '../../shared/types'
import { resolveClaude } from './claude-cli'
import { isSessionId } from './claude-sessions'

/**
 * Claude Code driven as a structured chat: one long-lived `claude -p` per chat, speaking
 * stream-json both ways. Messages and control requests go in on stdin; the conversation, live
 * deltas and permission prompts (`--permission-prompt-tool stdio`) come out on stdout. The
 * conversation is the same one an interactive `claude` writes, so it can be resumed in a terminal.
 */

interface PendingControl {
  resolve(value: unknown): void
  reject(error: Error): void
  timer: NodeJS.Timeout
}

interface ChatProcess {
  child: ChildProcessWithoutNullStreams
  owner: WebContents
  /** Unterminated end of stdout. */
  partial: string
  outbox: ChatWireMessage[]
  flushTimer: NodeJS.Timeout | null
  pending: Map<string, PendingControl>
  /** Last lines of stderr, to explain an early exit. */
  stderr: string
  stopped: boolean
}

// Deltas arrive many per second: batch them into fewer IPC messages.
const FLUSH_INTERVAL_MS = 16
const CONTROL_TIMEOUT_MS = 60_000
const STDERR_KEPT_CHARS = 4000
const PERMISSION_MODES = new Set<ChatPermissionMode>(['default', 'acceptEdits', 'auto', 'plan', 'bypassPermissions', 'dontAsk'])
const OPTION_VALUE_RE = /^[\w.:[\]-]{1,64}$/
// Noise for a chat: hook bookkeeping, plugin UI logs, thinking signatures.
const DROPPED_SYSTEM = new Set(['hook_started', 'hook_response', 'hook_progress', 'ui_log'])

export class ChatManager {
  private readonly chats = new Map<string, ChatProcess>()

  async start(owner: WebContents, options: ChatStartOptions): Promise<void> {
    const chatId = String(options.chatId)
    this.stop(chatId)
    const claude = await resolveClaude()
    if (!claude) throw new Error('Claude Code est introuvable. Installe-le (https://claude.com/claude-code) puis réessaie.')

    // `--replay-user-messages` echoes each message once Claude takes it, which tells queued from started.
    const args = ['-p', '--input-format', 'stream-json', '--output-format', 'stream-json', '--verbose', '--include-partial-messages', '--replay-user-messages', '--permission-prompt-tool', 'stdio']
    if (isSessionId(options.sessionId)) args.push('--resume', options.sessionId)
    if (options.model && OPTION_VALUE_RE.test(options.model)) args.push('--model', options.model)
    if (options.permissionMode && PERMISSION_MODES.has(options.permissionMode)) args.push('--permission-mode', options.permissionMode)
    if (options.effort && OPTION_VALUE_RE.test(options.effort)) args.push('--effort', options.effort)

    const windowsScript = process.platform === 'win32' && /\.cmd$/i.test(claude.file)
    const child = spawn(windowsScript ? `"${claude.file}"` : claude.file, args, {
      cwd: isDirectory(options.cwd) ? options.cwd : homedir(),
      // Session state frames (running / requires_action / idle) end turns that never get a result.
      env: { ...claude.env, CLAUDE_CODE_EMIT_SESSION_STATE_EVENTS: '1' },
      windowsHide: true,
      // Every argument is a plain flag or a value checked above: safe to hand to cmd.exe.
      shell: windowsScript
    })
    const chat: ChatProcess = { child, owner, partial: '', outbox: [], flushTimer: null, pending: new Map(), stderr: '', stopped: false }
    this.chats.set(chatId, chat)

    child.stdout.setEncoding('utf8').on('data', (chunk: string) => this.onStdout(chatId, chat, chunk))
    child.stderr.setEncoding('utf8').on('data', (chunk: string) => {
      chat.stderr = (chat.stderr + chunk).slice(-STDERR_KEPT_CHARS)
    })
    child.stdin.on('error', () => {})
    child.on('error', (error) => this.finish(chatId, chat, null, `Impossible de lancer Claude Code : ${error.message}`))
    child.on('close', (code) => this.finish(chatId, chat, code, null))
  }

  /** `uuid` comes back on the replayed message, matching it to this send. */
  send(chatId: string, uuid: string, content: ChatUserContent): void {
    const blocks = Array.isArray(content) ? content.filter(isContentBlock) : []
    if (blocks.length === 0 || typeof uuid !== 'string') return
    this.write(chatId, { type: 'user', uuid, message: { role: 'user', content: blocks }, parent_tool_use_id: null, session_id: '' })
  }

  /** Answers a `can_use_tool` request. */
  respond(chatId: string, requestId: string, response: ChatPermissionResponse): void {
    if (typeof requestId !== 'string') return
    this.write(chatId, { type: 'control_response', response: { subtype: 'success', request_id: requestId, response } })
  }

  /** Sends a control request and resolves with Claude's answer. */
  control(chatId: string, request: ChatControlRequest): Promise<unknown> {
    const chat = this.chats.get(chatId)
    if (!chat || chat.stopped) return Promise.reject(new Error('Claude n’est pas lancé dans ce chat.'))
    if (typeof request?.subtype !== 'string') return Promise.reject(new Error('Requête invalide.'))
    const requestId = randomUUID()
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        chat.pending.delete(requestId)
        reject(new Error('Claude n’a pas répondu à temps.'))
      }, CONTROL_TIMEOUT_MS)
      chat.pending.set(requestId, { resolve, reject, timer })
      this.write(chatId, { type: 'control_request', request_id: requestId, request })
    })
  }

  stop(chatId: string): void {
    const chat = this.chats.get(chatId)
    if (!chat) return
    chat.stopped = true
    this.chats.delete(chatId)
    this.rejectPending(chat, 'Chat fermé.')
    if (chat.flushTimer) clearTimeout(chat.flushTimer)
    try {
      chat.child.stdin.end()
      chat.child.kill()
    } catch {
      // Already gone.
    }
  }

  stopAllFor(owner: WebContents): void {
    for (const [id, chat] of this.chats) if (chat.owner === owner) this.stop(id)
  }

  stopAll(): void {
    for (const id of [...this.chats.keys()]) this.stop(id)
  }

  private write(chatId: string, message: unknown): void {
    const chat = this.chats.get(chatId)
    if (!chat || chat.stopped || !chat.child.stdin.writable) return
    chat.child.stdin.write(`${JSON.stringify(message)}\n`)
  }

  private onStdout(chatId: string, chat: ChatProcess, chunk: string): void {
    chat.partial += chunk
    let newline: number
    while ((newline = chat.partial.indexOf('\n')) !== -1) {
      const line = chat.partial.slice(0, newline).trim()
      chat.partial = chat.partial.slice(newline + 1)
      if (!line) continue
      let message: ChatWireMessage
      try {
        message = JSON.parse(line) as ChatWireMessage
      } catch {
        continue
      }
      this.route(chatId, chat, message)
    }
  }

  private route(chatId: string, chat: ChatProcess, message: ChatWireMessage): void {
    if (message.type === 'control_response') {
      const response = message.response as { request_id?: string; subtype?: string; response?: unknown; error?: string } | undefined
      const pending = response?.request_id ? chat.pending.get(response.request_id) : undefined
      if (!pending || !response?.request_id) return
      chat.pending.delete(response.request_id)
      clearTimeout(pending.timer)
      if (response.subtype === 'error') pending.reject(new Error(response.error || 'Claude a refusé la requête.'))
      else pending.resolve(response.response ?? null)
      return
    }
    if (message.type === 'control_request') {
      const request = message.request as { subtype?: string } | undefined
      // Only permission prompts are ours to answer; anything else (hooks, MCP, dialogs…) wasn't registered.
      if (request?.subtype === 'request_user_dialog') {
        this.write(chatId, { type: 'control_response', response: { subtype: 'success', request_id: message.request_id, response: { behavior: 'cancelled' } } })
        return
      }
      if (request?.subtype !== 'can_use_tool') {
        this.write(chatId, { type: 'control_response', response: { subtype: 'error', request_id: message.request_id, error: 'Non pris en charge par Capitaine' } })
        return
      }
    }
    if (message.type === 'system' && DROPPED_SYSTEM.has(String(message.subtype))) return
    if (message.type === 'stream_event') {
      const event = message.event as { type?: string; delta?: { type?: string } } | undefined
      if (event?.type === 'content_block_delta' && event.delta?.type === 'signature_delta') return
    }
    chat.outbox.push(message)
    if (!chat.flushTimer) chat.flushTimer = setTimeout(() => this.flush(chatId, chat), FLUSH_INTERVAL_MS)
  }

  private flush(chatId: string, chat: ChatProcess): void {
    if (chat.flushTimer) clearTimeout(chat.flushTimer)
    chat.flushTimer = null
    if (chat.outbox.length === 0) return
    const messages = chat.outbox
    chat.outbox = []
    if (!chat.owner.isDestroyed()) chat.owner.send('chat:messages', chatId, messages)
  }

  private finish(chatId: string, chat: ChatProcess, code: number | null, error: string | null): void {
    if (this.chats.get(chatId) === chat) this.chats.delete(chatId)
    this.flush(chatId, chat)
    this.rejectPending(chat, 'Claude s’est arrêté.')
    // Stopped on purpose (tab closed, switched to the terminal): nothing to report.
    if (chat.stopped) return
    chat.stopped = true
    const reason = error ?? (code === 0 ? null : friendlyExit(chat.stderr, code))
    if (!chat.owner.isDestroyed()) chat.owner.send('chat:exit', chatId, code, reason)
  }

  private rejectPending(chat: ChatProcess, reason: string): void {
    for (const pending of chat.pending.values()) {
      clearTimeout(pending.timer)
      pending.reject(new Error(reason))
    }
    chat.pending.clear()
  }
}

function friendlyExit(stderr: string, code: number | null): string {
  const text = stderr.trim()
  if (/not logged in|please run \/login|invalid api key|authentication|oauth token/i.test(text)) {
    return 'Claude Code n’est pas connecté : ouvre ce chat en terminal et lance /login.'
  }
  if (/no conversation found|session.*not found/i.test(text)) return 'Conversation introuvable : elle a peut-être été supprimée.'
  const lines = text.split('\n').filter(Boolean).slice(-4).join('\n')
  return lines || `Claude Code s’est arrêté (code ${code ?? '?'}).`
}

function isContentBlock(block: unknown): boolean {
  if (typeof block !== 'object' || block === null) return false
  const { type } = block as { type?: unknown }
  if (type === 'text') return typeof (block as { text?: unknown }).text === 'string'
  if (type !== 'image') return false
  const source = (block as { source?: { type?: unknown; media_type?: unknown; data?: unknown } }).source
  return source?.type === 'base64' && typeof source.media_type === 'string' && /^image\/(png|jpeg|gif|webp)$/.test(source.media_type) && typeof source.data === 'string'
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory()
  } catch {
    return false
  }
}
