export interface DirEntry {
  name: string
  /** Absolute path. */
  path: string
  /** Path from the project root, always `/`-separated. */
  relPath: string
  isDirectory: boolean
  isSymlink: boolean
}

export type FileContent =
  | { kind: 'text'; content: string; mtimeMs: number }
  | { kind: 'binary'; size: number }
  | { kind: 'too-large'; size: number }
  | { kind: 'missing' }
