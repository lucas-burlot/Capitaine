/**
 * Line diff for the chat's edit cards: which lines an edit kept, removed and added, in order, with
 * the characters that changed inside a reworded line. Small inputs (an Edit's old and new strings),
 * so a plain LCS over what's left once the common head and tail are set aside is enough.
 */

export type DiffLine =
  | { kind: 'same'; text: string }
  | { kind: 'del' | 'add'; text: string; /** [start, end) of the changed characters, when paired with a reworded line. */ changed?: [number, number] }
  /** A long run of kept lines, folded. */
  | { kind: 'fold'; count: number }

// Past this many cells the LCS table costs too much: the middle shows as removed, then added.
const MAX_CELLS = 2_000_000
const CONTEXT = 3

export function lineDiff(before: string, after: string): DiffLine[] {
  // A final newline isn't an extra line.
  const a = before ? before.replace(/\n$/, '').split('\n') : []
  const b = after ? after.replace(/\n$/, '').split('\n') : []
  let head = 0
  while (head < a.length && head < b.length && a[head] === b[head]) head++
  let tail = 0
  while (tail < a.length - head && tail < b.length - head && a[a.length - 1 - tail] === b[b.length - 1 - tail]) tail++
  const midA = a.slice(head, a.length - tail)
  const midB = b.slice(head, b.length - tail)

  const lines: DiffLine[] = a.slice(0, head).map((text) => ({ kind: 'same', text }))
  lines.push(...markChanges(middle(midA, midB)))
  lines.push(...a.slice(a.length - tail).map((text): DiffLine => ({ kind: 'same', text })))
  return fold(lines)
}

function middle(a: string[], b: string[]): DiffLine[] {
  if (a.length === 0 || b.length === 0 || a.length * b.length > MAX_CELLS) {
    return [...a.map((text): DiffLine => ({ kind: 'del', text })), ...b.map((text): DiffLine => ({ kind: 'add', text }))]
  }
  // lcs[i][j]: longest common subsequence of a[i..] and b[j..], in one flat table.
  const width = b.length + 1
  const lcs = new Uint32Array((a.length + 1) * width)
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i * width + j] = a[i] === b[j] ? lcs[(i + 1) * width + j + 1] + 1 : Math.max(lcs[(i + 1) * width + j], lcs[i * width + j + 1])
    }
  }
  const out: DiffLine[] = []
  let i = 0
  let j = 0
  while (i < a.length || j < b.length) {
    if (i < a.length && j < b.length && a[i] === b[j]) {
      out.push({ kind: 'same', text: a[i] })
      i++
      j++
    } else if (i < a.length && (j === b.length || lcs[(i + 1) * width + j] >= lcs[i * width + j + 1])) {
      out.push({ kind: 'del', text: a[i++] })
    } else {
      out.push({ kind: 'add', text: b[j++] })
    }
  }
  return reorder(out)
}

/** Within each change, removed lines come before added ones. */
function reorder(lines: DiffLine[]): DiffLine[] {
  const out: DiffLine[] = []
  let dels: DiffLine[] = []
  let adds: DiffLine[] = []
  const flush = () => {
    out.push(...dels, ...adds)
    dels = []
    adds = []
  }
  for (const line of lines) {
    if (line.kind === 'del') dels.push(line)
    else if (line.kind === 'add') adds.push(line)
    else {
      flush()
      out.push(line)
    }
  }
  flush()
  return out
}

/** A change of as many removed as added lines pairs them up, and marks what changed inside each pair. */
function markChanges(lines: DiffLine[]): DiffLine[] {
  const out = [...lines]
  let k = 0
  while (k < out.length) {
    if (out[k].kind !== 'del') {
      k++
      continue
    }
    let dels = 0
    while (out[k + dels]?.kind === 'del') dels++
    let adds = 0
    while (out[k + dels + adds]?.kind === 'add') adds++
    if (dels === adds) {
      for (let p = 0; p < dels; p++) {
        const del = out[k + p] as { kind: 'del'; text: string }
        const add = out[k + dels + p] as { kind: 'add'; text: string }
        const [delRange, addRange] = changedRanges(del.text, add.text)
        if (delRange && addRange) {
          out[k + p] = { ...del, changed: delRange }
          out[k + dels + p] = { ...add, changed: addRange }
        }
      }
    }
    k += dels + adds
  }
  return out
}

/** The differing middle of two lines, once their common start and end are set aside; null when they share nothing. */
function changedRanges(a: string, b: string): [[number, number] | null, [number, number] | null] {
  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start]) start++
  let end = 0
  while (end < a.length - start && end < b.length - start && a[a.length - 1 - end] === b[b.length - 1 - end]) end++
  if (start === 0 && end === 0) return [null, null]
  return [
    [start, a.length - end],
    [start, b.length - end]
  ]
}

/** Runs of kept lines longer than the context on both sides fold, at the edges as in the middle. */
function fold(lines: DiffLine[]): DiffLine[] {
  const out: DiffLine[] = []
  let k = 0
  while (k < lines.length) {
    if (lines[k].kind !== 'same') {
      out.push(lines[k++])
      continue
    }
    let end = k
    while (end < lines.length && lines[end].kind === 'same') end++
    const keepBefore = k === 0 ? 0 : CONTEXT
    const keepAfter = end === lines.length ? 0 : CONTEXT
    const run = end - k
    if (run > keepBefore + keepAfter + 1 && (k > 0 || end < lines.length)) {
      out.push(...lines.slice(k, k + keepBefore), { kind: 'fold', count: run - keepBefore - keepAfter }, ...lines.slice(end - keepAfter, end))
    } else {
      out.push(...lines.slice(k, end))
    }
    k = end
  }
  return out
}
