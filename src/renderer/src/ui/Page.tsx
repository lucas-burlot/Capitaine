import { useEffect, useRef } from 'react'
import { RefreshCw, Search, X } from 'lucide-react'
import { customTitleBar, titleBarHeightClass, WindowControlsSpacer } from '@/app/TitleBar'
import { isMac } from '@/lib/platform'
import { IconButton } from './IconButton'
import { ResizeHandle, usePanelWidth } from './ResizeHandle'

/**
 * A full page over the terminals (skills, Docker…): title bar header with a filter, refresh and
 * close; Escape closes it (or clears the filter first), Ctrl/⌘+F focuses the filter.
 */
export function PageShell(props: {
  label: string
  icon: React.ReactNode
  title: string
  subtitle?: string
  query: string
  onQueryChange(query: string): void
  placeholder: string
  refreshing: boolean
  onRefresh(): void
  onClose(): void
  /** Under the header: tabs, banners. */
  toolbar?: React.ReactNode
  children: React.ReactNode
}) {
  const searchRef = useRef<HTMLInputElement>(null)
  const { query, onQueryChange, onClose } = props

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const inSearch = event.target === searchRef.current
      if (event.key === 'Escape') {
        if (inSearch && query) onQueryChange('')
        else if (inSearch) searchRef.current?.blur()
        else onClose()
      } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'f') {
        event.preventDefault()
        searchRef.current?.focus()
        searchRef.current?.select()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [query, onQueryChange, onClose])

  return (
    <div className="app-page absolute inset-0 z-30 flex flex-col bg-bg" aria-label={props.label}>
      <header className={`drag-region flex shrink-0 items-center gap-3 border-b border-line pl-4 ${customTitleBar ? '' : 'pr-1.5'} ${titleBarHeightClass}`}>
        <h1 className="flex min-w-0 items-center gap-2 text-[13px] font-semibold text-fg">
          <span className="shrink-0 text-accent">{props.icon}</span>
          {props.title}
          {props.subtitle && <span className="truncate text-[12px] font-normal text-muted">{props.subtitle}</span>}
        </h1>
        <div className="min-w-[24px] flex-1 self-stretch" data-window-drag />
        <label className="no-drag flex h-7 w-64 items-center gap-1.5 rounded-md border border-line bg-panel px-2 text-[12px] transition-colors focus-within:border-accent/50">
          <Search size={12} className="shrink-0 text-muted" />
          <input
            ref={searchRef}
            value={query}
            onChange={(e) => onQueryChange(e.target.value)}
            placeholder={props.placeholder}
            aria-label={props.placeholder}
            className="min-w-0 flex-1 bg-transparent text-fg caret-accent outline-none placeholder:text-muted/70"
          />
          {query ? (
            <button title="Effacer (Échap)" onClick={() => onQueryChange('')} className="shrink-0 rounded text-muted hover:text-fg">
              <X size={12} />
            </button>
          ) : (
            <kbd className="shrink-0 rounded bg-panel-2 px-1 font-sans text-[10px] text-muted">{isMac ? '⌘F' : 'Ctrl F'}</kbd>
          )}
        </label>
        <IconButton title="Rafraîchir" onClick={props.onRefresh}>
          <RefreshCw size={13} className={props.refreshing ? 'animate-spin' : ''} />
        </IconButton>
        <IconButton title="Revenir aux terminaux (Échap)" onClick={onClose}>
          <X size={14} />
        </IconButton>
        <WindowControlsSpacer />
      </header>
      {props.toolbar}
      {props.children}
    </div>
  )
}

/** Resizable list on the left, the selected item on the right. */
export function PageSplit({ storageKey, listLabel, list, detail }: { storageKey: string; listLabel: string; list: React.ReactNode; detail: React.ReactNode }) {
  const panel = usePanelWidth({ storageKey, defaultWidth: 360, min: 260, max: 640 })
  return (
    <div className="flex min-h-0 flex-1">
      <div className="relative flex shrink-0 flex-col border-r border-line bg-panel" style={{ width: panel.width }}>
        <ResizeHandle panel={panel} />
        <div className="scrollbar-sleek min-h-0 flex-1 overflow-y-auto py-1.5" role="listbox" aria-label={listLabel}>
          {list}
        </div>
      </div>
      <div className="scrollbar-sleek min-w-0 flex-1 overflow-y-auto">{detail}</div>
    </div>
  )
}

/** Centered message filling the page body (empty list, no match, unavailable). */
export function PageMessage({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-1 items-center justify-center px-8">
      <div className="max-w-md text-center">
        <h2 className="text-[15px] font-medium text-fg">{title}</h2>
        {children}
      </div>
    </div>
  )
}

/** A selectable two-line row of a page list. */
export function PageListRow(props: {
  id: string
  active: boolean
  dimmed?: boolean
  title: string
  onSelect(): void
  onOpen?(): void
  children: React.ReactNode
}) {
  return (
    <div
      role="option"
      aria-selected={props.active}
      data-page-row={props.id}
      onClick={props.onSelect}
      onDoubleClick={props.onOpen}
      title={props.title}
      className={`mx-1.5 cursor-pointer rounded-md py-1.5 pr-3 pl-[18px] transition-colors ${props.active ? 'bg-panel-2' : 'hover:bg-panel-2/50'} ${
        props.dimmed ? 'opacity-50' : ''
      }`}
    >
      {props.children}
    </div>
  )
}

/**
 * ↑/↓ move the selection through `ids` (scrolling the row into view), Enter runs `onEnter`.
 * Ignored while typing in a field other than the page filter.
 */
export function useListKeys(ids: string[], selectedId: string | null, onSelect: (id: string) => void, onEnter?: () => void) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null
      const typing = !!target?.closest('textarea, input:not([type=checkbox])') && !target?.closest('header')
      if (typing) return
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault()
        const index = selectedId ? ids.indexOf(selectedId) : -1
        const next = ids[Math.min(ids.length - 1, Math.max(0, index + (event.key === 'ArrowDown' ? 1 : -1)))]
        if (next) {
          onSelect(next)
          document.querySelector(`[data-page-row="${CSS.escape(next)}"]`)?.scrollIntoView({ block: 'nearest' })
        }
      } else if (event.key === 'Enter' && onEnter && !(target instanceof HTMLButtonElement)) {
        event.preventDefault()
        onEnter()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })
}

/** A row of a detail page's property table. */
export function Property({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[132px_minmax(0,1fr)] gap-4 border-b border-line/60 py-2">
      <dt className="truncate text-muted" title={label}>
        {label}
      </dt>
      <dd className="min-w-0 break-words text-fg/90 select-text">{children}</dd>
    </div>
  )
}

export function PrimaryButton({ onClick, disabled, children }: { onClick(): void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="flex items-center gap-2 rounded-md bg-accent px-3 py-1.5 text-[12.5px] font-medium text-bg outline-none hover:brightness-110 focus-visible:ring-2 focus-visible:ring-accent/40 focus-visible:ring-offset-2 focus-visible:ring-offset-bg disabled:opacity-50 disabled:hover:brightness-100"
    >
      {children}
    </button>
  )
}

export function TextButton({ onClick, disabled, children }: { onClick(): void; disabled?: boolean; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[12.5px] text-muted outline-none hover:bg-panel-2 hover:text-fg focus-visible:bg-panel-2 focus-visible:text-fg disabled:opacity-50 disabled:hover:bg-transparent"
    >
      {children}
    </button>
  )
}
