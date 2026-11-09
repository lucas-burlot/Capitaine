/** Drag payload understood by terminals: a JSON array of absolute paths. */
export const PATHS_MIME = 'application/x-capitaine-paths'

/**
 * Starts a pointer drag (sidebar or split resize). A full-window shield keeps xterm from
 * selecting text or eating events while the pointer crosses terminals.
 */
export function startDrag(
  event: React.PointerEvent,
  cursor: 'col-resize' | 'row-resize',
  onMove: (e: PointerEvent) => void,
  onEnd?: () => void
): void {
  if (event.button !== 0) return
  event.preventDefault()
  const shield = document.createElement('div')
  shield.style.cssText = `position:fixed;inset:0;z-index:9999;cursor:${cursor};`
  document.body.appendChild(shield)

  const move = (e: PointerEvent) => onMove(e)
  const up = () => {
    window.removeEventListener('pointermove', move)
    window.removeEventListener('pointerup', up)
    window.removeEventListener('blur', up)
    shield.remove()
    onEnd?.()
  }
  window.addEventListener('pointermove', move)
  window.addEventListener('pointerup', up)
  window.addEventListener('blur', up)
}
