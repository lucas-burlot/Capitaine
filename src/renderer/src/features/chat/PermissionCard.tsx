import { useEffect, useMemo, useRef, useState } from 'react'
import { ClipboardList, MessageCircleQuestionMark, ShieldAlert } from 'lucide-react'
import { answerPermission, chatOf, setPermissionMode, type PendingPermission } from './chat-store'
import { decorateCodeBlocks, renderMarkdown } from './chat-markdown'
import { Diff } from './ChatTranscript'
import { permissionTitle, shortPath, toolDisplay } from './tool-display'

interface Props {
  chatId: string
  permission: PendingPermission
  cwd: string
  /** Only the first pending prompt takes the keyboard shortcuts. */
  active: boolean
}

export function PermissionCard(props: Props) {
  if (props.permission.toolName === 'AskUserQuestion') return <QuestionCard {...props} />
  if (props.permission.toolName === 'ExitPlanMode') return <PlanCard {...props} />
  return <ToolPermissionCard {...props} />
}

const DENIED = 'L’utilisateur a refusé cette action.'

function ToolPermissionCard({ chatId, permission, cwd, active }: Props) {
  const [feedback, setFeedback] = useState('')
  const [refusing, setRefusing] = useState(false)
  const display = toolDisplay(permission.toolName, permission.input, cwd)
  const command = typeof permission.input.command === 'string' ? permission.input.command : null
  const sessionRules = permission.suggestions.filter((s) => isRecord(s) && (s.type === 'addRules' || s.type === 'addDirectories'))
  const ruleLabel = useMemo(() => alwaysLabel(permission, cwd), [permission, cwd])
  const edits = fileEdits(permission)

  const allow = (always: boolean) =>
    answerPermission(chatId, permission.requestId, {
      behavior: 'allow',
      updatedInput: permission.input,
      // Session only: nothing is written to the project's settings files.
      ...(always && sessionRules.length ? { updatedPermissions: sessionRules.map((s) => ({ ...(s as object), destination: 'session' })) } : {})
    })
  const deny = () =>
    answerPermission(chatId, permission.requestId, { behavior: 'deny', message: feedback.trim() ? `${DENIED} Sa remarque : ${feedback.trim()}` : DENIED })

  useShortcuts(chatId, active && !refusing, { Enter: () => allow(false), Escape: () => setRefusing(true) })

  return (
    <Card icon={<ShieldAlert size={14} className="text-waiting" />} title={permissionTitle(permission.toolName)} subtitle={permission.agentId ? 'demandé par un sous-agent' : null}>
      {command ? (
        <pre className="chat-selectable scrollbar-sleek max-h-48 overflow-auto rounded-md border border-line bg-bg px-3 py-2 font-mono text-small whitespace-pre-wrap text-fg">{command}</pre>
      ) : edits ? (
        <div className="flex max-h-72 flex-col gap-1.5 overflow-y-auto">
          {edits.map((edit, i) => (
            <Diff key={i} path={i === 0 ? display.detail : null} before={edit.before} after={edit.after} />
          ))}
        </div>
      ) : (
        display.detail && <div className="chat-selectable font-mono text-small break-all text-fg">{display.detail}</div>
      )}
      {permission.description && permission.description !== command && !sameText(permission.description, display.detail) && (
        <div className="text-small text-muted">{permission.description}</div>
      )}
      {permission.decisionReason && <div className="text-small text-faint">{permission.decisionReason}</div>}
      {permission.blockedPath && !sameText(shortPath(permission.blockedPath, cwd), display.detail) && (
        <div className="text-small text-faint">Chemin concerné : {shortPath(permission.blockedPath, cwd)}</div>
      )}
      {refusing ? (
        <div className="flex items-center gap-2">
          <input
            autoFocus
            value={feedback}
            onChange={(e) => setFeedback(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') deny()
              if (e.key === 'Escape') setRefusing(false)
            }}
            placeholder="Dire à Claude quoi faire à la place (facultatif)"
            className="min-w-0 flex-1 rounded-md border border-line bg-bg px-2 py-1 text-ui text-fg outline-none placeholder:text-faint focus:border-accent"
          />
          <Button tone="danger" onClick={deny}>
            Refuser
          </Button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <Button tone="primary" onClick={() => allow(false)} hint={active ? 'Entrée' : undefined}>
            Autoriser
          </Button>
          {sessionRules.length > 0 && (
            <Button onClick={() => allow(true)} title="Pour la suite de cette conversation uniquement">
              {ruleLabel}
            </Button>
          )}
          <Button tone="danger" onClick={() => setRefusing(true)} hint={active ? 'Échap' : undefined}>
            Refuser…
          </Button>
        </div>
      )}
    </Card>
  )
}

/** The change a file tool is about to make, as before / after pairs. */
function fileEdits(permission: PendingPermission): { before: string; after: string }[] | null {
  const input = permission.input
  const text = (value: unknown) => (typeof value === 'string' ? value : '')
  switch (permission.toolName) {
    case 'Write':
      return [{ before: '', after: text(input.content) }]
    case 'Edit':
      return [{ before: text(input.old_string), after: text(input.new_string) }]
    case 'MultiEdit':
      return Array.isArray(input.edits) ? (input.edits as Record<string, unknown>[]).map((e) => ({ before: text(e.old_string), after: text(e.new_string) })) : null
    default:
      return null
  }
}

function sameText(a: string, b: string): boolean {
  return a.trim().replace(/^\.\//, '') === b.trim().replace(/^\.\//, '')
}

/** "Toujours autoriser …" with what the rule covers. */
function alwaysLabel(permission: PendingPermission, cwd: string): string {
  for (const suggestion of permission.suggestions) {
    if (!isRecord(suggestion)) continue
    if (suggestion.type === 'addRules' && Array.isArray(suggestion.rules)) {
      const rule = suggestion.rules[0] as { toolName?: string; ruleContent?: string } | undefined
      if (rule?.ruleContent) return `Toujours autoriser « ${rule.ruleContent.length > 40 ? `${rule.ruleContent.slice(0, 39)}…` : rule.ruleContent} »`
      if (rule?.toolName) return `Toujours autoriser ${rule.toolName}`
    }
    if (suggestion.type === 'addDirectories' && Array.isArray(suggestion.directories) && typeof suggestion.directories[0] === 'string') {
      return `Toujours autoriser dans ${shortPath(suggestion.directories[0], cwd) || 'ce dossier'}`
    }
  }
  return 'Toujours autoriser'
}

interface Question {
  question: string
  header?: string
  multiSelect?: boolean
  options: { label: string; description?: string }[]
}

function QuestionCard({ chatId, permission, active }: Props) {
  const questions = (Array.isArray(permission.input.questions) ? permission.input.questions : []).filter(
    (q): q is Question => isRecord(q) && typeof q.question === 'string' && Array.isArray(q.options)
  )
  const [selected, setSelected] = useState<Record<number, string[]>>({})
  const [other, setOther] = useState<Record<number, string>>({})

  const toggle = (index: number, label: string, multi: boolean) =>
    setSelected((current) => {
      const list = current[index] ?? []
      const next = multi ? (list.includes(label) ? list.filter((l) => l !== label) : [...list, label]) : [label]
      return { ...current, [index]: next }
    })

  const answerOf = (index: number, question: Question): string | string[] | null => {
    const picks = [...(selected[index] ?? []), ...(other[index]?.trim() ? [other[index].trim()] : [])]
    if (picks.length === 0) return null
    return question.multiSelect ? picks : picks[picks.length - 1]
  }
  const complete = questions.every((q, i) => answerOf(i, q) !== null)

  const submit = () => {
    if (!complete) return
    const answers: Record<string, string | string[]> = {}
    questions.forEach((q, i) => {
      answers[q.question || q.header || String(i)] = answerOf(i, q)!
    })
    answerPermission(chatId, permission.requestId, { behavior: 'allow', updatedInput: { ...permission.input, answers } })
  }
  const dismiss = () =>
    answerPermission(chatId, permission.requestId, {
      behavior: 'deny',
      message: 'L’utilisateur a ignoré ces questions. Termine ton tour et attends sa prochaine instruction.'
    })

  useShortcuts(chatId, active, { Escape: dismiss })

  return (
    <Card icon={<MessageCircleQuestionMark size={14} className="text-waiting" />} title="Claude te pose une question">
      {questions.map((question, index) => (
        <div key={index} className="flex flex-col gap-1.5">
          {question.header && <div className="text-caption font-medium tracking-wide text-faint uppercase">{question.header}</div>}
          <div className="text-ui text-fg">{question.question}</div>
          <div className="flex flex-col gap-1">
            {question.options.map((option) => {
              const checked = (selected[index] ?? []).includes(option.label)
              return (
                <button
                  key={option.label}
                  onClick={() => toggle(index, option.label, !!question.multiSelect)}
                  className={`flex items-start gap-2 rounded-md border px-2.5 py-1.5 text-left ${checked ? 'border-accent/60 bg-accent/10' : 'border-line hover:bg-panel-2'}`}
                >
                  <span
                    className={`mt-[3px] h-3 w-3 shrink-0 border ${question.multiSelect ? 'rounded-sm' : 'rounded-full'} ${checked ? 'border-accent bg-accent' : 'border-faint'}`}
                  />
                  <span className="flex flex-col">
                    <span className="text-ui text-fg">{option.label}</span>
                    {option.description && <span className="text-small text-muted">{option.description}</span>}
                  </span>
                </button>
              )
            })}
            <input
              value={other[index] ?? ''}
              onChange={(e) => {
                const value = e.target.value
                setOther((current) => ({ ...current, [index]: value }))
                if (!question.multiSelect && value.trim()) setSelected((current) => ({ ...current, [index]: [] }))
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && complete) submit()
              }}
              placeholder="Autre réponse…"
              className="rounded-md border border-line bg-bg px-2.5 py-1.5 text-ui text-fg outline-none placeholder:text-faint focus:border-accent"
            />
          </div>
        </div>
      ))}
      <div className="flex items-center gap-2">
        <Button tone="primary" onClick={submit} disabled={!complete}>
          Répondre
        </Button>
        <Button onClick={dismiss} hint={active ? 'Échap' : undefined}>
          Ignorer
        </Button>
      </div>
    </Card>
  )
}

function PlanCard({ chatId, permission, active }: Props) {
  const [feedback, setFeedback] = useState('')
  const ref = useRef<HTMLDivElement>(null)
  const plan = typeof permission.input.plan === 'string' ? permission.input.plan : ''
  const html = useMemo(() => renderMarkdown(plan), [plan])
  useEffect(() => {
    if (ref.current) decorateCodeBlocks(ref.current)
  }, [html])

  const approve = (mode: 'default' | 'acceptEdits') => {
    // Out of plan mode first, or Claude would keep planning after the approval.
    if (chatOf(chatId)?.permissionMode === 'plan') void setPermissionMode(chatId, mode)
    answerPermission(chatId, permission.requestId, { behavior: 'allow', updatedInput: permission.input })
  }
  const keepPlanning = () =>
    answerPermission(chatId, permission.requestId, {
      behavior: 'deny',
      message: `L’utilisateur veut que tu continues à planifier. Revois le plan et appelle ExitPlanMode à nouveau.${feedback.trim() ? ` Sa remarque : ${feedback.trim()}` : ''}`
    })

  useShortcuts(chatId, active, { Enter: () => approve('default') })

  return (
    <Card icon={<ClipboardList size={14} className="text-waiting" />} title="Claude propose un plan">
      <div
        ref={ref}
        className="markdown-body chat-markdown chat-selectable scrollbar-sleek max-h-[50vh] overflow-y-auto rounded-md border border-line bg-bg px-4 py-3"
        dangerouslySetInnerHTML={{ __html: html }}
      />
      <input
        value={feedback}
        onChange={(e) => setFeedback(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && feedback.trim()) {
            e.stopPropagation()
            keepPlanning()
          }
        }}
        placeholder="Ce qu’il faut changer dans le plan (facultatif)"
        className="rounded-md border border-line bg-bg px-2.5 py-1.5 text-ui text-fg outline-none placeholder:text-faint focus:border-accent"
      />
      <div className="flex flex-wrap items-center gap-2">
        <Button tone="primary" onClick={() => approve('default')} hint={active ? 'Entrée' : undefined} title="Claude demandera avant chaque modification">
          Approuver
        </Button>
        <Button onClick={() => approve('acceptEdits')} title="Claude modifie les fichiers sans redemander">
          Approuver et accepter les modifs
        </Button>
        <Button onClick={keepPlanning}>Continuer à planifier</Button>
      </div>
    </Card>
  )
}

function Card({ icon, title, subtitle, children }: { icon: React.ReactNode; title: string; subtitle?: string | null; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-2.5 rounded-lg border border-waiting/40 bg-panel px-3.5 py-3 shadow-lg shadow-black/20">
      <div className="flex items-center gap-2">
        {icon}
        <span className="text-ui font-medium text-fg">{title}</span>
        {subtitle && <span className="text-small text-faint">· {subtitle}</span>}
      </div>
      {children}
    </div>
  )
}

function Button(props: { tone?: 'primary' | 'danger'; onClick(): void; disabled?: boolean; hint?: string; title?: string; children: React.ReactNode }) {
  const tone =
    props.tone === 'primary'
      ? 'bg-accent text-bg hover:brightness-110'
      : props.tone === 'danger'
        ? 'border border-line text-red-300 hover:bg-red-500/10'
        : 'border border-line text-fg hover:bg-panel-2'
  return (
    <button
      onClick={props.onClick}
      disabled={props.disabled}
      title={props.title}
      className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 text-ui font-medium disabled:opacity-40 ${tone}`}
    >
      {props.children}
      {props.hint && <kbd className={`rounded px-1 font-sans text-caption ${props.tone === 'primary' ? 'bg-bg/15' : 'bg-panel-2 text-faint'}`}>{props.hint}</kbd>}
    </button>
  )
}

/** Keyboard answers while the card is the first one of the focused chat, unless typing in a field. */
function useShortcuts(chatId: string, enabled: boolean, keys: Partial<Record<'Enter' | 'Escape', () => void>>) {
  const ref = useRef(keys)
  ref.current = keys
  useEffect(() => {
    if (!enabled) return
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      if (target && (target.tagName === 'INPUT' || (target.tagName === 'TEXTAREA' && (target as HTMLTextAreaElement).value.trim()))) return
      if (target?.closest<HTMLElement>('[data-chat-root]')?.dataset.chatRoot !== chatId) return
      const handler = ref.current[event.key as 'Enter' | 'Escape']
      if (!handler || event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return
      event.preventDefault()
      event.stopPropagation()
      handler()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [chatId, enabled])
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
