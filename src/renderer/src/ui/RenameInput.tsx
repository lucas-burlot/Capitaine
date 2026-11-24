import { useState } from 'react'

/**
 * In-place name field: Enter or leaving it keeps the value, Escape gives up (null).
 * `selectUntil`: how much of the name to preselect (a file's name without its extension).
 */
export function RenameInput(props: { initial: string; onDone(value: string | null): void; selectUntil?: number; className?: string }) {
  const [value, setValue] = useState(props.initial)
  const [done, setDone] = useState(false)
  // Enter then the blur it causes must not finish twice.
  const finish = (result: string | null) => {
    if (done) return
    setDone(true)
    props.onDone(result)
  }
  return (
    <input
      autoFocus
      value={value}
      spellCheck={false}
      onFocus={(e) => e.currentTarget.setSelectionRange(0, props.selectUntil ?? e.currentTarget.value.length)}
      onClick={(e) => e.stopPropagation()}
      onDoubleClick={(e) => e.stopPropagation()}
      onMouseDown={(e) => e.stopPropagation()}
      onChange={(e) => setValue(e.target.value)}
      onBlur={() => finish(value)}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter') finish(value)
        if (e.key === 'Escape') finish(null)
      }}
      className={`w-full min-w-0 rounded border border-line bg-bg px-1 text-fg outline-none focus:border-accent ${props.className ?? 'text-ui'}`}
    />
  )
}
