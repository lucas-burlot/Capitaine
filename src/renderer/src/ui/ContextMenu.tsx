import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'

/**
 * Right-click menu at the pointer, kept inside the window. Closes on a click elsewhere, Escape or
 * the window losing focus. Rendered on <body>, and its events don't reach the element it was
 * opened from (a tab would otherwise get selected by a click in its own menu).
 */
export function ContextMenu({ x, y, onClose, children }: { x: number; y: number; onClose(): void; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState({ x, y })

  useLayoutEffect(() => {
    const rect = ref.current?.getBoundingClientRect()
    if (rect) setPos({ x: Math.max(4, Math.min(x, window.innerWidth - rect.width - 4)), y: Math.max(4, Math.min(y, window.innerHeight - rect.height - 4)) })
  }, [x, y])

  useEffect(() => {
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && onClose()
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('mousedown', close)
    window.addEventListener('keydown', esc)
    window.addEventListener('blur', onClose)
    return () => {
      window.removeEventListener('mousedown', close)
      window.removeEventListener('keydown', esc)
      window.removeEventListener('blur', onClose)
    }
  }, [onClose])

  const stop = (e: React.SyntheticEvent) => e.stopPropagation()
  return createPortal(
    <div
      ref={ref}
      role="menu"
      onClick={stop}
      onMouseDown={stop}
      onDoubleClick={stop}
      onContextMenu={(e) => {
        e.preventDefault()
        e.stopPropagation()
      }}
      className="no-drag fixed z-50 w-max min-w-60 rounded-md border border-line bg-panel-2 py-1 whitespace-nowrap shadow-xl shadow-black/40"
      style={{ left: pos.x, top: pos.y }}
    >
      {children}
    </div>,
    document.body
  )
}

export function MenuItem(props: { icon: React.ReactNode; label: string; hint?: string; disabled?: boolean; onClick(): void }) {
  return (
    <button
      role="menuitem"
      disabled={props.disabled}
      onClick={props.onClick}
      className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-small text-fg enabled:hover:bg-line disabled:text-faint"
    >
      {props.icon}
      <span className="flex-1">{props.label}</span>
      {props.hint && <span className="pl-4 text-caption text-faint">{props.hint}</span>}
    </button>
  )
}

export function MenuSeparator() {
  return <div className="my-1 border-t border-line" />
}
