// Agents add and remove files all the time: the list is fetched again when older than this.
const FILE_LIST_MAX_AGE_MS = 5000

// Project files by project id, shared by the file search and the chat's `@` menu.
const fileLists = new Map<string, { files: string[]; at: number }>()
const loading = new Map<string, Promise<string[]>>()

/** The project's files as last fetched (project-relative, `/`-separated), or null before the first fetch. */
export function cachedProjectFiles(projectId: string): string[] | null {
  return fileLists.get(projectId)?.files ?? null
}

/** The project's files, fetched again when the cached list is stale; one fetch at a time per project. */
export function loadProjectFiles(projectId: string): Promise<string[]> {
  const cached = fileLists.get(projectId)
  if (cached && Date.now() - cached.at < FILE_LIST_MAX_AGE_MS) return Promise.resolve(cached.files)
  const pending = loading.get(projectId)
  if (pending) return pending
  const request = window.capitaine.files
    .all(projectId)
    .then((files) => {
      fileLists.set(projectId, { files, at: Date.now() })
      return files
    })
    .finally(() => loading.delete(projectId))
  loading.set(projectId, request)
  return request
}
