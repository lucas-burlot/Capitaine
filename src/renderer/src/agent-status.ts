/**
 * Program Status Protocol (OSC 7501): agents such as Claude Code report their own state in the
 * terminal stream once the terminal answers the `OSC 7501 ; ?` probe.
 * Spec: https://www.superlogical.com/rex/docs/build/program-status — same approach as Orca.
 *
 * Observed with Claude Code 2.1.316:
 *   state=idle:app=claude-code                         prompt waiting for a task
 *   state=working:app=claude-code                      turn in progress
 *   state=working:id=<agentId>:title=<b64>             a subagent (cleared with state=clear:id=…)
 *   state=blocked:kind=question:msg=<b64>              waiting on the user (also permission, auth)
 *   state=done                                         turn finished
 *   state=clear                                        Claude exited
 */

export const AGENT_STATES = ['idle', 'working', 'done', 'blocked', 'error'] as const
export type AgentState = (typeof AGENT_STATES)[number]
export const AGENT_BLOCK_KINDS = ['permission', 'question', 'auth'] as const
export type AgentBlockKind = (typeof AGENT_BLOCK_KINDS)[number]

export const PROGRAM_STATUS_QUERY_REPLY = `\x1b]7501;?:states=${AGENT_STATES.join(',')}:kinds=${AGENT_BLOCK_KINDS.join(',')}\x1b\\`

export interface AgentReport {
  /** Null addresses the program itself; otherwise a child such as a subagent. */
  id: string | null
  state: AgentState | 'clear'
  kind?: AgentBlockKind
  app?: string
  title?: string
  msg?: string
  progress?: number
}

export type AgentMessage = { type: 'query' } | { type: 'report'; report: AgentReport }

const MAX_BODY = 4096
const ID_RE = /^[A-Za-z0-9_.+-]{1,32}(\/[A-Za-z0-9_.+-]{1,32}){0,7}$/
// eslint-disable-next-line no-control-regex
const CONTROL_RE = /[\u0000-\u001f\u007f-\u009f]/
const utf8 = new TextDecoder('utf-8', { fatal: true })

function decodeBase64Text(value: string): string | null {
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(value)) return null
  try {
    const binary = atob(value.padEnd(Math.ceil(value.length / 4) * 4, '='))
    const text = utf8.decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)))
    return CONTROL_RE.test(text) ? null : text
  } catch {
    return null
  }
}

const isState = (v: string): v is AgentState => (AGENT_STATES as readonly string[]).includes(v)
const isKind = (v: string): v is AgentBlockKind => (AGENT_BLOCK_KINDS as readonly string[]).includes(v)

/** Parses the body between `ESC ] 7501 ;` and the terminator. Null = ignore. */
export function parseAgentStatus(body: string): AgentMessage | null {
  if (body.length > MAX_BODY) return null
  if (body.trim() === '?') return { type: 'query' }

  const fields = new Map<string, string>()
  for (const pair of body.split(':')) {
    const eq = pair.indexOf('=')
    if (eq > 0) fields.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim())
  }

  const state = fields.get('state')
  if (!state || (state !== 'clear' && !isState(state))) return null
  const id = fields.get('id') ?? null
  if (id !== null && !ID_RE.test(id)) return null

  const report: AgentReport = { id, state }
  const kind = fields.get('kind')
  if (state === 'blocked' && kind && isKind(kind)) report.kind = kind
  const app = fields.get('app')
  if (app && /^[A-Za-z0-9_.+-]{1,32}$/.test(app)) report.app = app
  for (const key of ['title', 'msg'] as const) {
    const raw = fields.get(key)
    if (raw === undefined) continue
    const text = decodeBase64Text(raw)
    if (text === null) return null
    if (text) report[key] = text
  }
  const progress = Number(fields.get('progress'))
  if ((state === 'working' || state === 'blocked') && Number.isInteger(progress) && progress >= 0 && progress <= 100) {
    report.progress = progress
  }
  return { type: 'report', report }
}

export interface AgentChild {
  id: string
  state: AgentState
  kind?: AgentBlockKind
  title?: string
  msg?: string
}

export interface AgentSession {
  app: string
  state: AgentState
  kind?: AgentBlockKind
  msg?: string
  progress?: number
  /** When the current state started. */
  since: number
  children: AgentChild[]
}

/** Applies one report; returns the new session, or null when the agent is gone. */
export function applyAgentReport(session: AgentSession | undefined, report: AgentReport, now: number): AgentSession | null {
  if (report.id === null) {
    if (report.state === 'clear') return null
    return {
      app: report.app ?? session?.app ?? 'agent',
      state: report.state,
      kind: report.kind,
      msg: report.msg,
      progress: report.progress,
      since: session && session.state === report.state && session.kind === report.kind ? session.since : now,
      children: session?.children ?? []
    }
  }

  const base: AgentSession = session ?? { app: report.app ?? 'agent', state: 'working', since: now, children: [] }
  const id = report.id
  const others = base.children.filter((c) => c.id !== id && !(report.state === 'clear' && c.id.startsWith(`${id}/`)))
  if (report.state === 'clear') return { ...base, children: others }
  const child: AgentChild = { id, state: report.state, kind: report.kind, title: report.title, msg: report.msg }
  const index = base.children.findIndex((c) => c.id === id)
  const children = index === -1 ? [...others, child] : base.children.map((c) => (c.id === id ? child : c))
  return { ...base, children }
}

export function agentDisplayName(app: string): string {
  if (app === 'claude-code') return 'Claude'
  return app.charAt(0).toUpperCase() + app.slice(1)
}

export type AgentTone = 'working' | 'attention' | 'done' | 'idle' | 'error'

export function agentTone(state: AgentState): AgentTone {
  if (state === 'blocked') return 'attention'
  return state
}

export function agentStateLabel(state: AgentState, kind?: AgentBlockKind): string {
  switch (state) {
    case 'working':
      return 'Travaille'
    case 'blocked':
      if (kind === 'permission') return 'Attend ta permission'
      if (kind === 'question') return 'Attend ta réponse'
      if (kind === 'auth') return 'Connexion requise'
      return 'Attend une action'
    case 'done':
      return 'Terminé'
    case 'error':
      return 'Erreur'
    default:
      return 'En attente d’une consigne'
  }
}

/** Claude's `msg` repeats what the state label already says ("answer: …", "approve Write: …"). */
export function agentMessageText(msg: string): string {
  return msg.replace(/^(answer|approve)\s*:?\s*/i, '')
}

/** Claude prefixes its window title with a spinner/✳ glyph until the terminal answers the probe. */
export function stripStatusGlyph(title: string): string {
  return title.replace(/^[⠀-⣿✳✶✻✽✢·*⏺●◯○◉\s]+/u, '').trim()
}
