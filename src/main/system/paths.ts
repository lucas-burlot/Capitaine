import { isAbsolute, relative } from 'node:path'

/** True when `target` is `root` itself or somewhere beneath it. */
export function isInside(root: string, target: string): boolean {
  const rel = relative(root, target)
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))
}
