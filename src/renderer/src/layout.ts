/** Split layout of a tab: a tree whose leaves are terminals. Pure functions only. */

export type SplitDirection = 'row' | 'column'

export type LayoutNode =
  | { type: 'pane'; id: string }
  | { type: 'split'; direction: SplitDirection; children: LayoutNode[]; sizes: number[] }

export interface Rect {
  left: number
  top: number
  width: number
  height: number
}

export interface Divider {
  /** Child indexes from the root down to the split that owns this divider. */
  path: number[]
  /** The divider sits between children `index` and `index + 1`. */
  index: number
  direction: SplitDirection
  rect: Rect
  /** The owning split's rect, needed to turn pointer moves into size fractions. */
  splitRect: Rect
}

export const MIN_PANE_FRACTION = 0.08

export function pane(id: string): LayoutNode {
  return { type: 'pane', id }
}

export function paneIds(node: LayoutNode): string[] {
  return node.type === 'pane' ? [node.id] : node.children.flatMap(paneIds)
}

/** Splits `targetId`, putting `newId` after it (right for `row`, below for `column`). */
export function splitPane(node: LayoutNode, targetId: string, newId: string, direction: SplitDirection): LayoutNode {
  if (node.type === 'pane') {
    return node.id === targetId
      ? { type: 'split', direction, children: [node, pane(newId)], sizes: [0.5, 0.5] }
      : node
  }
  const index = node.children.findIndex((child) => child.type === 'pane' && child.id === targetId)
  if (index !== -1 && node.direction === direction) {
    // Same direction: become a sibling and share the target's space instead of nesting.
    const half = node.sizes[index] / 2
    return {
      ...node,
      children: [...node.children.slice(0, index + 1), pane(newId), ...node.children.slice(index + 1)],
      sizes: [...node.sizes.slice(0, index), half, half, ...node.sizes.slice(index + 1)]
    }
  }
  return { ...node, children: node.children.map((child) => splitPane(child, targetId, newId, direction)) }
}

/** Removes a pane; returns null when nothing is left. Single-child splits collapse. */
export function removePane(node: LayoutNode, id: string): LayoutNode | null {
  if (node.type === 'pane') return node.id === id ? null : node
  const kept: { child: LayoutNode; size: number }[] = []
  node.children.forEach((child, i) => {
    const next = removePane(child, id)
    if (next) kept.push({ child: next, size: node.sizes[i] })
  })
  if (kept.length === 0) return null
  if (kept.length === 1) return kept[0].child
  const total = kept.reduce((sum, k) => sum + k.size, 0)
  return { ...node, children: kept.map((k) => k.child), sizes: kept.map((k) => k.size / total) }
}

export function resizeSplit(node: LayoutNode, path: number[], sizes: number[]): LayoutNode {
  if (node.type === 'pane') return node
  if (path.length === 0) return { ...node, sizes }
  const [head, ...rest] = path
  return { ...node, children: node.children.map((child, i) => (i === head ? resizeSplit(child, rest, sizes) : child)) }
}

export function nodeAt(node: LayoutNode, path: number[]): LayoutNode | null {
  let cursor: LayoutNode = node
  for (const index of path) {
    if (cursor.type !== 'split' || !cursor.children[index]) return null
    cursor = cursor.children[index]
  }
  return cursor
}

/** Lays the tree out in a unit square (fractions of the container). */
export function computeLayout(root: LayoutNode): { panes: Map<string, Rect>; dividers: Divider[] } {
  const panes = new Map<string, Rect>()
  const dividers: Divider[] = []

  const walk = (node: LayoutNode, rect: Rect, path: number[]) => {
    if (node.type === 'pane') {
      panes.set(node.id, rect)
      return
    }
    const horizontal = node.direction === 'row'
    let offset = 0
    node.children.forEach((child, i) => {
      const size = node.sizes[i]
      const childRect = horizontal
        ? { left: rect.left + offset * rect.width, top: rect.top, width: size * rect.width, height: rect.height }
        : { left: rect.left, top: rect.top + offset * rect.height, width: rect.width, height: size * rect.height }
      walk(child, childRect, [...path, i])
      offset += size
      if (i < node.children.length - 1) {
        dividers.push({
          path,
          index: i,
          direction: node.direction,
          splitRect: rect,
          rect: horizontal
            ? { left: rect.left + offset * rect.width, top: rect.top, width: 0, height: rect.height }
            : { left: rect.left, top: rect.top + offset * rect.height, width: rect.width, height: 0 }
        })
      }
    })
  }

  walk(root, { left: 0, top: 0, width: 1, height: 1 }, [])
  return { panes, dividers }
}

/** New sizes after dragging divider `index` to `fraction` (0..1 across the split). */
export function dragSizes(sizes: number[], index: number, fraction: number): number[] {
  const before = sizes.slice(0, index).reduce((a, b) => a + b, 0)
  const pair = sizes[index] + sizes[index + 1]
  const first = Math.min(Math.max(fraction - before, MIN_PANE_FRACTION), pair - MIN_PANE_FRACTION)
  const next = [...sizes]
  next[index] = first
  next[index + 1] = pair - first
  return next
}
