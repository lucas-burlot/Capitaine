import { useState } from 'react'
import { startDrag } from '../drag'

interface WidthOptions {
  storageKey: string
  defaultWidth: number
  min: number
  max: number
}

/** A panel width the user drags, remembered across launches. */
export function usePanelWidth({ storageKey, defaultWidth, min, max }: WidthOptions) {
  const [width, setWidth] = useState(() => {
    try {
      const saved = Number(localStorage.getItem(storageKey))
      return Number.isFinite(saved) && saved >= min && saved <= max ? saved : defaultWidth
    } catch {
      return defaultWidth
    }
  })
  const commit = (w: number) => {
    setWidth(w)
    try {
      localStorage.setItem(storageKey, String(w))
    } catch {
      // Not persisted; the width still applies for this session.
    }
  }
  const clamp = (w: number) => Math.round(Math.min(max, Math.max(min, w)))
  return { width, setWidth, commit, clamp, defaultWidth }
}

/**
 * Vertical drag handle on the panel edge facing the terminals (`right` for a left panel, `left`
 * for a right panel); double-click restores the default width.
 */
export function ResizeHandle({ panel, edge = 'right' }: { panel: ReturnType<typeof usePanelWidth>; edge?: 'left' | 'right' }) {
  const direction = edge === 'right' ? 1 : -1
  return (
    <div
      title="Glisser pour redimensionner · double-clic pour réinitialiser"
      onDoubleClick={() => panel.commit(panel.defaultWidth)}
      onPointerDown={(event) => {
        const startX = event.clientX
        const startWidth = panel.width
        let latest = startWidth
        startDrag(
          event,
          'col-resize',
          (e) => {
            latest = panel.clamp(startWidth + direction * (e.clientX - startX))
            panel.setWidth(latest)
          },
          () => panel.commit(latest)
        )
      }}
      className={`group no-drag absolute top-0 bottom-0 z-20 w-1.5 cursor-col-resize ${edge === 'right' ? '-right-[3px]' : '-left-[3px]'}`}
    >
      <div className="mx-auto h-full w-px bg-transparent transition-colors group-hover:bg-accent/70" />
    </div>
  )
}
