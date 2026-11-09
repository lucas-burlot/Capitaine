/** Small icon-only button for panel headers (clickable even inside the window drag region). */
export function IconButton({ title, onClick, children }: { title: string; onClick(): void; children: React.ReactNode }) {
  return (
    <button title={title} onClick={onClick} className="no-drag rounded p-1 text-muted hover:bg-panel-2 hover:text-fg">
      {children}
    </button>
  )
}
