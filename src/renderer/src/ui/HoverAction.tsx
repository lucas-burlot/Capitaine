/** Icon button shown on a hovered list row; the click doesn't reach the row itself. */
export function HoverAction(props: { title: string; disabled?: boolean; onClick(): void; children: React.ReactNode }) {
  return (
    <button
      title={props.title}
      disabled={props.disabled}
      onClick={(e) => {
        e.stopPropagation()
        props.onClick()
      }}
      className="rounded p-0.5 text-muted hover:bg-line hover:text-fg disabled:opacity-40"
    >
      {props.children}
    </button>
  )
}
