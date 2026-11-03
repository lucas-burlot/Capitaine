/**
 * Fuzzy file search over project-relative paths: the query's characters must appear in order
 * (`fexp` finds `FileExplorer.tsx`). Matches in the file name beat matches spread over folders,
 * and word starts, runs of consecutive characters and short paths rank higher.
 */

export interface FileMatch {
  /** Project-relative, `/`-separated. */
  path: string
  score: number
  /** Indexes in `path` of the matched characters, for highlighting. */
  positions: number[]
}

const lowered = new WeakMap<string[], string[]>()

export function searchFiles(query: string, paths: string[], limit: number): FileMatch[] {
  const q = query.toLowerCase().replace(/\s+/g, '')
  if (!q) return []
  let lower = lowered.get(paths)
  if (!lower) {
    lower = paths.map((p) => p.toLowerCase())
    lowered.set(paths, lower)
  }
  const matches: FileMatch[] = []
  for (let i = 0; i < paths.length; i++) {
    const match = matchPath(q, paths[i], lower[i])
    if (match) matches.push(match)
  }
  matches.sort((a, b) => b.score - a.score || a.path.length - b.path.length || a.path.localeCompare(b.path))
  return matches.slice(0, limit)
}

function matchPath(q: string, path: string, lower: string): FileMatch | null {
  const nameStart = lower.lastIndexOf('/') + 1
  // The file name alone first: that's almost always what is being typed.
  const inName = tightestMatch(q, lower, nameStart)
  const positions = inName ?? tightestMatch(q, lower, 0)
  if (!positions) return null
  let score = scorePositions(path, positions, nameStart)
  const name = lower.slice(nameStart)
  if (inName) {
    score += 100
    if (name.includes(q)) score += 50
    if (name.startsWith(q)) score += 30
    const dot = name.lastIndexOf('.')
    if (name === q || (dot > 0 && name.slice(0, dot) === q)) score += 100
  } else if (lower.includes(q)) {
    score += 40
  }
  return { path, score: score - path.length * 0.05, positions }
}

/** Positions of `q` in `text` from `from`, as compact as a forward then backward scan finds them. */
function tightestMatch(q: string, text: string, from: number): number[] | null {
  let i = from
  for (let k = 0; k < q.length; k++, i++) {
    i = text.indexOf(q[k], i)
    if (i === -1) return null
  }
  // Walk back from where the last character matched to find the latest possible start.
  let start = i - 1
  for (let k = q.length - 1; k >= 0; k--, start--) start = text.lastIndexOf(q[k], start)
  const positions: number[] = []
  for (let k = 0, j = start + 1; k < q.length; k++, j++) {
    j = text.indexOf(q[k], j)
    positions.push(j)
  }
  return positions
}

function scorePositions(path: string, positions: number[], nameStart: number): number {
  let score = 0
  for (let k = 0; k < positions.length; k++) {
    const p = positions[k]
    score += 1
    if (k > 0 && p === positions[k - 1] + 1) score += 5
    const before = p > 0 ? path[p - 1] : '/'
    if ('/-_. '.includes(before)) score += 8
    else if (isUpper(path[p]) && !isUpper(before)) score += 6
    if (p === nameStart) score += 10
  }
  // Characters scattered far apart are a weak match.
  return score - (positions[positions.length - 1] - positions[0]) * 0.3
}

function isUpper(char: string): boolean {
  return char !== char.toLowerCase()
}
