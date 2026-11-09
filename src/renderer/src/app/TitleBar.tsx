import { useEffect, useState } from 'react'
import { MoreHorizontal, PanelLeft } from 'lucide-react'
import logo from '@resources/logo.svg'
import { useExplorer } from '@/features/files/explorer-store'
import { isMac, shortcutLabel } from '@/lib/platform'

/** Linux/Windows: the app draws its own title bar (Orca-style), window buttons included. */
export const customTitleBar = window.capitaine.window.customTitleBar
/** Width reserved at the right of the top-most header for the fixed window buttons. */
export const WINDOW_CONTROLS_WIDTH = customTitleBar ? 138 : 0
/** Header height, shared by every top row so they line up. */
export const titleBarHeightClass = isMac ? 'h-12' : 'h-10'

/**
 * Top-left of the window: (traffic lights on macOS,) the Capitaine cap and name, the app menu (⋯) where the
 * native menu bar is gone, and the sidebar toggle.
 */
export function TitleBarBrand({ compact = false }: { compact?: boolean }) {
  const toggleSidebar = useExplorer((s) => s.toggleSidebar)
  const sidebarOpen = useExplorer((s) => s.sidebarOpen)
  return (
    <div className={`flex shrink-0 items-center gap-1 ${isMac ? 'pl-[76px]' : 'pl-2.5'}`}>
      <img src={logo} alt="" aria-hidden draggable={false} className="h-[18px] w-auto shrink-0" />
      {!compact && <span className="pl-1 text-[13px] font-semibold tracking-tight text-fg select-none">Capitaine</span>}
      {customTitleBar && (
        <button
          className="no-drag rounded p-1 text-muted hover:bg-panel-2 hover:text-fg"
          title="Menu de l’application"
          aria-label="Menu de l’application"
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect()
            window.capitaine.window.popupMenu(rect.left, rect.bottom + 2)
          }}
        >
          <MoreHorizontal size={14} />
        </button>
      )}
      <button
        className={`no-drag rounded p-1 hover:bg-panel-2 hover:text-fg ${sidebarOpen ? 'text-muted' : 'text-accent'}`}
        title={`${sidebarOpen ? 'Masquer' : 'Afficher'} la barre latérale (${shortcutLabel('toggleSidebar')})`}
        aria-label={`${sidebarOpen ? 'Masquer' : 'Afficher'} la barre latérale`}
        onClick={toggleSidebar}
      >
        <PanelLeft size={15} />
      </button>
    </div>
  )
}

/** Minimize / maximize / close, fixed at the window's top-right (Linux/Windows only). */
export function WindowControls() {
  const [maximized, setMaximized] = useState(false)
  useEffect(() => {
    if (!customTitleBar) return
    let cancelled = false
    void window.capitaine.window.isMaximized().then((value) => !cancelled && setMaximized(value))
    const off = window.capitaine.window.onMaximizedChange(setMaximized)
    return () => {
      cancelled = true
      off()
    }
  }, [])
  if (!customTitleBar) return null

  const button = 'no-drag flex h-10 w-[46px] items-center justify-center text-muted transition-colors'
  return (
    <div className="fixed top-0 right-0 z-[60] flex" role="group" aria-label="Fenêtre">
      <button className={`${button} hover:bg-white/10 hover:text-fg`} aria-label="Réduire" title="Réduire" onClick={() => window.capitaine.window.minimize()}>
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
          <path d="M0 5h10v1H0z" fill="currentColor" />
        </svg>
      </button>
      <button
        className={`${button} hover:bg-white/10 hover:text-fg`}
        aria-label={maximized ? 'Restaurer' : 'Agrandir'}
        title={maximized ? 'Restaurer' : 'Agrandir'}
        onClick={() => window.capitaine.window.toggleMaximize()}
      >
        {maximized ? (
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
            <path d="M2 0v2H0v8h8V8h2V0H2zm6 9H1V3h7v6zM9 7H8V2H3V1h6v6z" fill="currentColor" />
          </svg>
        ) : (
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
            <path d="M0 0v10h10V0H0zm9 9H1V1h8v8z" fill="currentColor" />
          </svg>
        )}
      </button>
      <button
        className={`${button} hover:bg-[#c42b1c] hover:text-white`}
        aria-label="Fermer"
        title="Fermer"
        // Through main's close(), so unsaved editors still get their "save changes?" prompt.
        onClick={() => window.capitaine.window.close()}
      >
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
          <path d="M1 0L0 1l4 4-4 4 1 1 4-4 4 4 1-1-4-4 4-4-1-1-4 4-4-4z" fill="currentColor" />
        </svg>
      </button>
    </div>
  )
}

/** Keeps the right end of the top-most header clear of the fixed window buttons. */
export function WindowControlsSpacer() {
  return WINDOW_CONTROLS_WIDTH ? <div aria-hidden className="shrink-0" style={{ width: WINDOW_CONTROLS_WIDTH }} /> : null
}
