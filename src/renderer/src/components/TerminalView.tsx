import { useEffect, useRef, useState } from 'react'
import { SquareTerminal, X } from 'lucide-react'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { SerializeAddon } from '@xterm/addon-serialize'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { WebglAddon } from '@xterm/addon-webgl'
import '@xterm/xterm/css/xterm.css'
import { parseAgentStatus, PROGRAM_STATUS_QUERY_REPLY } from '../agent-status'
import { attachPty } from '../pty-bus'
import { pathsForTerminal } from '../shell-quote'
import { forgetRestoredTerminal, restoredTerminal } from '../session'
import { registerTerminal } from '../terminal-registry'
import { isMac } from '../platform'
import type { Rect } from '../layout'
import { isTerminalVisible, terminalLabel, useApp } from '../store'
import { terminalTheme } from '../terminal-theme'
import { AgentStatusIcon } from './AgentStatus'
import { PATHS_MIME } from './FileExplorer'

interface Props {
  terminalId: string
  cwd: string
  /** Position inside the workspace, as fractions of its size. */
  rect: Rect
  visible: boolean
  focused: boolean
  /** Split tabs show a header per pane so you can tell terminals apart. */
  showHeader: boolean
}

const RESIZE_DEBOUNCE_MS = 120
// Lines of history kept across restarts (the live terminal keeps more).
const SAVED_SCROLLBACK_LINES = 2000
// A restored shell printing its first prompt in a background tab isn't news worth a dot.
const RESTORED_QUIET_MS = 3000
const RESTORED_MARKER = '\x1b[0m\r\n\x1b[2m── session précédente ──\x1b[0m\r\n'

/** Keys the app menu handles; xterm must not swallow them. */
function isAppShortcut(event: KeyboardEvent): boolean {
  if (event.type !== 'keydown') return false
  const key = event.key.toLowerCase()
  if (isMac) return event.metaKey
  if (event.ctrlKey && key === 'tab') return true
  if (event.ctrlKey && event.altKey && (key === 'arrowleft' || key === 'arrowright')) return true
  return event.ctrlKey && event.shiftKey && ['t', 'w', 'o', 'c', 'v', 'a', 'd', 'e', 'b', 'p'].includes(key)
}

export function TerminalView({ terminalId, cwd, rect, visible, focused, showHeader }: Props) {
  const [dropping, setDropping] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<Terminal | null>(null)
  const fitRef = useRef<FitAddon | null>(null)

  useEffect(() => {
    const container = containerRef.current
    if (!container) return

    const term = new Terminal({
      fontFamily: '"JetBrains Mono", "Cascadia Code", "SF Mono", Menlo, Consolas, "DejaVu Sans Mono", monospace',
      fontSize: 13,
      lineHeight: 1.2,
      cursorBlink: true,
      allowProposedApi: true,
      scrollback: 10000,
      macOptionIsMeta: true,
      theme: terminalTheme
    })
    const fit = new FitAddon()
    term.loadAddon(fit)
    const serializer = new SerializeAddon()
    term.loadAddon(serializer)
    term.loadAddon(new WebLinksAddon((_event, uri) => window.open(uri, '_blank')))
    term.attachCustomKeyEventHandler((event) => !isAppShortcut(event))
    term.open(container)

    try {
      const webgl = new WebglAddon()
      webgl.onContextLoss(() => webgl.dispose())
      term.loadAddon(webgl)
    } catch {
      // No WebGL available: xterm keeps its DOM renderer.
    }

    termRef.current = term
    fitRef.current = fit
    safeFit(fit)

    const store = useApp.getState()
    let ptyId: string | null = null
    let disposed = false
    let detach = () => {}
    const unregister = registerTerminal(terminalId, {
      paste: (text) => term.paste(text),
      focus: () => term.focus(),
      snapshot: () => ({
        ptyId,
        // Modes and the alternate screen (vim, less…) belong to programs that won't be running anymore.
        scrollback: serializer.serialize({ scrollback: SAVED_SCROLLBACK_LINES, excludeModes: true, excludeAltBuffer: true })
      })
    })

    // Reopened after a restart: show what the terminal had on screen, then start the shell below it.
    // A resumed Claude conversation prints itself again, so its old screen would only repeat it.
    const restored = restoredTerminal(terminalId)
    const resumeAgent = restored?.agent ?? undefined
    if (restored?.scrollback && !resumeAgent?.sessionId) term.write(restored.scrollback + RESTORED_MARKER)

    const onFocus = () => useApp.getState().focusPane(terminalId)
    term.textarea?.addEventListener('focus', onFocus)
    const titleSub = term.onTitleChange((title) => useApp.getState().setShellTitle(terminalId, title))

    // Agents (Claude Code…) probe with `OSC 7501 ; ?` and then report their status in-band.
    const statusSub = term.parser.registerOscHandler(7501, (body) => {
      const message = parseAgentStatus(body)
      if (message?.type === 'query') {
        if (ptyId) window.capitaine.pty.write(ptyId, PROGRAM_STATUS_QUERY_REPLY)
      } else if (message) {
        useApp.getState().applyAgentReport(terminalId, message.report)
      }
      return true
    })

    window.capitaine.pty.create({ cwd, restoreCwd: restored?.cwd ?? undefined, resumeAgent, cols: term.cols, rows: term.rows }).then(({ id, shell }) => {
      if (disposed) {
        window.capitaine.pty.kill(id)
        return
      }
      ptyId = id
      forgetRestoredTerminal(terminalId)
      const quietUntil = restored ? Date.now() + RESTORED_QUIET_MS : 0
      term.onData((data) => window.capitaine.pty.write(id, data))
      term.onResize(({ cols, rows }) => window.capitaine.pty.resize(id, cols, rows))
      detach = attachPty(id, {
        onData: (data) => {
          term.write(data)
          if (Date.now() >= quietUntil && !isTerminalVisible(useApp.getState(), terminalId)) useApp.getState().markUnread(terminalId)
        },
        onProcess: (name) => {
          // Back at the shell prompt: whatever agent ran here is gone, even if it never said so.
          if (name === shell) useApp.getState().clearAgent(terminalId)
        },
        onExit: (exitCode) => {
          ptyId = null
          // A clean `exit` closes the tab; a failure stays visible so the user can read it.
          if (exitCode === 0) {
            useApp.getState().closeTerminal(terminalId)
            return
          }
          term.write(`\r\n\x1b[2m[processus terminé avec le code ${exitCode}]\x1b[0m\r\n`)
          useApp.getState().markExited(terminalId, exitCode)
        }
      })
    }, (error: unknown) => {
      term.write(`\x1b[31mImpossible de lancer le shell : ${String(error)}\x1b[0m\r\n`)
      store.markExited(terminalId, -1)
    })

    // Debounced: every resize makes the shell redraw its prompt, so a drag would stack copies of it.
    let fitTimer: ReturnType<typeof setTimeout> | undefined
    const observer = new ResizeObserver(() => {
      clearTimeout(fitTimer)
      fitTimer = setTimeout(() => safeFit(fit), RESIZE_DEBOUNCE_MS)
    })
    observer.observe(container)

    return () => {
      disposed = true
      observer.disconnect()
      clearTimeout(fitTimer)
      unregister()
      term.textarea?.removeEventListener('focus', onFocus)
      titleSub.dispose()
      statusSub.dispose()
      detach()
      if (ptyId) window.capitaine.pty.kill(ptyId)
      term.dispose()
      termRef.current = null
      fitRef.current = null
    }
  }, [terminalId, cwd])

  useEffect(() => {
    if (visible && fitRef.current) safeFit(fitRef.current)
  }, [visible])

  useEffect(() => {
    if (!focused) return
    // Focus after layout so the keyboard goes straight to the shell.
    const frame = requestAnimationFrame(() => termRef.current?.focus())
    return () => cancelAnimationFrame(frame)
  }, [focused])

  return (
    <div
      className={`absolute flex flex-col ${visible ? '' : 'invisible pointer-events-none'}`}
      style={{
        left: `${rect.left * 100}%`,
        top: `${rect.top * 100}%`,
        width: `${rect.width * 100}%`,
        height: `${rect.height * 100}%`
      }}
      aria-hidden={!visible}
      data-terminal-id={terminalId}
      onDragOver={(e) => {
        if (!acceptsDrop(e.dataTransfer)) return
        e.preventDefault()
        e.dataTransfer.dropEffect = 'copy'
        if (!dropping) setDropping(true)
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropping(false)
      }}
      onDrop={(e) => {
        setDropping(false)
        const paths = droppedPaths(e.dataTransfer)
        if (paths.length === 0) return
        e.preventDefault()
        useApp.getState().focusPane(terminalId)
        termRef.current?.paste(pathsForTerminal(paths))
        termRef.current?.focus()
      }}
    >
      {dropping && (
        <div className="pointer-events-none absolute inset-1 z-10 flex items-center justify-center rounded-md border-2 border-dashed border-accent/70 bg-accent/10 text-[12px] font-medium text-accent">
          Déposer pour insérer le chemin
        </div>
      )}
      {showHeader && <PaneHeader terminalId={terminalId} focused={focused} />}
      <div className={`min-h-0 flex-1 px-3 pb-1 ${showHeader ? 'pt-1' : 'pt-2'}`}>
        <div ref={containerRef} className="h-full w-full" />
      </div>
    </div>
  )
}

function PaneHeader({ terminalId, focused }: { terminalId: string; focused: boolean }) {
  const terminal = useApp((s) => s.terminals[terminalId])
  const agent = useApp((s) => s.agents[terminalId])
  const focusPane = useApp((s) => s.focusPane)
  const closeTerminal = useApp((s) => s.closeTerminal)
  if (!terminal) return null
  return (
    <div
      onMouseDown={() => focusPane(terminalId)}
      className={`flex h-6 shrink-0 items-center gap-1.5 border-b px-2 text-[11px] ${
        focused ? 'border-accent/50 bg-panel-2 text-fg' : 'border-line bg-panel text-faint'
      }`}
    >
      {agent ? (
        <AgentStatusIcon state={agent.state} kind={agent.kind} size={11} />
      ) : (
        <SquareTerminal size={11} className={focused ? 'text-accent' : ''} />
      )}
      <span className="min-w-0 flex-1 truncate">{terminalLabel(terminal)}</span>
      {terminal.unread && !focused && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />}
      <button
        className="rounded p-0.5 hover:bg-line hover:text-fg"
        title="Fermer ce panneau"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={() => closeTerminal(terminalId)}
      >
        <X size={11} />
      </button>
    </div>
  )
}

function acceptsDrop(data: DataTransfer): boolean {
  return data.types.includes(PATHS_MIME) || data.types.includes('Files')
}

/** Paths from the explorer (our MIME type) or files dragged in from the OS. */
function droppedPaths(data: DataTransfer): string[] {
  const internal = data.getData(PATHS_MIME)
  if (internal) {
    try {
      const parsed: unknown = JSON.parse(internal)
      if (Array.isArray(parsed)) return parsed.filter((p): p is string => typeof p === 'string')
    } catch {
      return []
    }
  }
  return [...data.files].map((file) => window.capitaine.files.pathForFile(file)).filter(Boolean)
}

function safeFit(fit: FitAddon) {
  try {
    fit.fit()
  } catch {
    // Container not laid out yet.
  }
}
