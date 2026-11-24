/** Small icon-only button for panel headers (clickable even inside the window drag region). */
export function IconButton({ title, onClick, children, className = 'p-1' }: { title: string; onClick(): void; children: React.ReactNode; className?: string }) {
  return (
    <button title={title} onClick={onClick} className={`no-drag shrink-0 rounded text-muted hover:bg-panel-2 hover:text-fg ${className}`}>
      {children}
    </button>
  )
}
