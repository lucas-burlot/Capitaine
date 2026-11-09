// IPC arguments come from the renderer: their types are never trusted.

export const text = (value: unknown): string => (typeof value === 'string' ? value : '')

export const stringList = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
