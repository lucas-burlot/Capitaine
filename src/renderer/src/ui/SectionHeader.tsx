import { ChevronRight } from 'lucide-react'

/** Collapsible list section title, with a count and actions revealed on hover. */
export function SectionHeader(props: {
  open: boolean
  onToggle(): void
  title: string
  count: React.ReactNode
  /** Tooltip on the whole header. */
  tooltip?: string
  /** Draws the title in the accent colour. */
  highlight?: boolean
  children?: React.ReactNode
}) {
  return (
    <div
      role="button"
      onClick={props.onToggle}
      title={props.tooltip}
      className="group flex h-6 cursor-pointer items-center gap-1 pr-2 pl-2 text-[11px] font-semibold tracking-wider text-muted uppercase hover:text-fg"
    >
      <ChevronRight size={12} className={`shrink-0 transition-transform ${props.open ? 'rotate-90' : ''}`} />
      <span className={`flex-1 truncate ${props.highlight ? 'text-accent' : ''}`}>{props.title}</span>
      <span className="hidden items-center group-hover:flex" onClick={(e) => e.stopPropagation()}>
        {props.children}
      </span>
      <span className="ml-1 rounded-full bg-line px-1.5 text-[10px] font-medium tracking-normal text-muted tabular-nums">{props.count}</span>
    </div>
  )
}
