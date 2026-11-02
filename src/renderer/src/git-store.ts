import { create } from 'zustand'
import type { GitStash, GitStashFile, RepoStatus } from '@shared/types'

interface GitState {
  /** undefined: never loaded; null: not a git repo. */
  status: Record<string, RepoStatus | null | undefined>
  errors: Record<string, string | null>
  stashes: Record<string, GitStash[] | undefined>
  /** Keyed by stash commit hash (stable while `stash@{n}` indexes shift). */
  stashFiles: Record<string, GitStashFile[] | undefined>
  /** Bumped whenever a project's status changes, so open diffs know to re-read. */
  version: Record<string, number>
  /** Files being staged/unstaged, to disable their buttons meanwhile. */
  busy: Record<string, boolean>

  refresh(projectId: string): Promise<void>
  loadStashFiles(projectId: string, stash: GitStash): Promise<void>
  stage(projectId: string, paths: string[]): Promise<void>
  unstage(projectId: string, paths: string[]): Promise<void>
}

const inFlight = new Map<string, Promise<void>>()

export const useGit = create<GitState>((set, get) => ({
  status: {},
  errors: {},
  stashes: {},
  stashFiles: {},
  version: {},
  busy: {},

  refresh(projectId) {
    // Coalesce: polling, fs events and button clicks can all ask at once.
    const running = inFlight.get(projectId)
    if (running) return running
    const job = (async () => {
      try {
        const status = await window.capitaine.git.status(projectId)
        const previous = get().status[projectId]
        const changed = JSON.stringify(previous) !== JSON.stringify(status)
        const stashesStale = status && (previous?.stashCount !== status.stashCount || !get().stashes[projectId])
        const stashes = stashesStale ? await window.capitaine.git.stashes(projectId) : get().stashes[projectId]
        set((s) => ({
          status: changed ? { ...s.status, [projectId]: status } : s.status,
          stashes: stashesStale ? { ...s.stashes, [projectId]: stashes } : s.stashes,
          errors: s.errors[projectId] ? { ...s.errors, [projectId]: null } : s.errors,
          version: changed ? { ...s.version, [projectId]: (s.version[projectId] ?? 0) + 1 } : s.version
        }))
      } catch (error) {
        set((s) => ({ errors: { ...s.errors, [projectId]: error instanceof Error ? error.message : String(error) } }))
      } finally {
        inFlight.delete(projectId)
      }
    })()
    inFlight.set(projectId, job)
    return job
  },

  async loadStashFiles(projectId, stash) {
    if (get().stashFiles[stash.hash]) return
    const files = await window.capitaine.git.stashFiles(projectId, stash.ref)
    set((s) => ({ stashFiles: { ...s.stashFiles, [stash.hash]: files } }))
  },

  async stage(projectId, paths) {
    await withBusy(projectId, paths, () => window.capitaine.git.stage(projectId, paths))
  },

  async unstage(projectId, paths) {
    await withBusy(projectId, paths, () => window.capitaine.git.unstage(projectId, paths))
  }
}))

async function withBusy(projectId: string, paths: string[], action: () => Promise<void>) {
  const keys = paths.map((p) => `${projectId}:${p}`)
  const mark = (value: boolean) =>
    useGit.setState((s) => {
      const busy = { ...s.busy }
      for (const key of keys) {
        if (value) busy[key] = true
        else delete busy[key]
      }
      return { busy }
    })
  mark(true)
  let failure: string | null = null
  try {
    await action()
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error)
  }
  mark(false)
  await useGit.getState().refresh(projectId)
  // After the refresh, which clears errors on success: the failure must stay visible.
  if (failure) useGit.setState((s) => ({ errors: { ...s.errors, [projectId]: failure } }))
}
