import { create } from 'zustand'
import type {
  BranchInfo,
  CommitFollowUp,
  ConflictResolution,
  GitActionResult,
  GitBranch,
  GitStash,
  GitStashFile,
  RepoStatus,
  StashOptions
} from '@shared/types'
import { resolutionDiff } from './diff-targets'
import { useApp } from '@/features/workspace/workspace-store'

/** The one repo-changing action running for a project (they would step on each other). */
export type GitPending = 'commit' | 'push' | 'pull' | 'sync' | 'switch' | 'branch' | 'continue' | 'abort' | 'stash'

export interface GitNotice {
  tone: 'ok' | 'warn'
  text: string
}

/** AI conflict resolution of one file: being written, ready for review, or failed. */
export type ResolutionState = { state: 'pending' } | { state: 'ready'; resolution: ConflictResolution } | { state: 'error'; message: string }

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
  /** Sidebar summary for every project; undefined: not read yet, null: not a git repo. */
  branches: Record<string, BranchInfo | null | undefined>
  /** Every branch of the repo, for the branch picker. */
  branchList: Record<string, GitBranch[] | undefined>
  pending: Record<string, GitPending | undefined>
  fetching: Record<string, boolean>
  /** Last action's outcome, shown a few seconds under the commit box. */
  notices: Record<string, GitNotice | null>
  /** Commit message being written, per project (survives switching views and projects). */
  drafts: Record<string, string>
  generatingMessage: Record<string, boolean>
  /** Keyed by `${projectId}:${path}`. */
  resolutions: Record<string, ResolutionState | undefined>

  refresh(projectId: string): Promise<void>
  refreshBranches(projectIds: string[]): Promise<void>
  loadStashFiles(projectId: string, stash: GitStash): Promise<void>
  stage(projectId: string, paths: string[]): Promise<void>
  unstage(projectId: string, paths: string[]): Promise<void>

  setDraft(projectId: string, message: string): void
  generateMessage(projectId: string): Promise<void>
  commit(projectId: string, followUp: CommitFollowUp): Promise<void>
  push(projectId: string): Promise<void>
  pull(projectId: string): Promise<void>
  sync(projectId: string): Promise<void>
  fetch(projectId: string, quiet: boolean): Promise<void>
  loadBranchList(projectId: string): Promise<void>
  switchBranch(projectId: string, name: string): Promise<boolean>
  createBranch(projectId: string, name: string, from?: string): Promise<boolean>
  finishOperation(projectId: string, how: 'continue' | 'abort'): Promise<void>
  takeSide(projectId: string, path: string, side: 'current' | 'incoming'): Promise<void>
  stashPush(projectId: string, options: StashOptions): Promise<boolean>
  /** `drop`: pop (apply, then remove it from the list). */
  applyStash(projectId: string, stash: GitStash, drop: boolean): Promise<void>
  dropStash(projectId: string, stash: GitStash): Promise<void>
  resolveWithAi(projectId: string, path: string, options?: { review: boolean }): Promise<void>
  acceptResolution(projectId: string, path: string, content: string): Promise<void>
  discardResolution(projectId: string, path: string): void
}

const inFlight = new Map<string, Promise<void>>()
const noticeTimers = new Map<string, ReturnType<typeof setTimeout>>()

/** Electron wraps errors thrown in the main process: keep only what the main process said. */
export function errorText(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  return message.replace(/^Error invoking remote method '[^']+': (?:Error: )?/, '')
}

export const resolutionKey = (projectId: string, path: string) => `${projectId}:${path}`

export const useGit = create<GitState>((set, get) => ({
  status: {},
  errors: {},
  stashes: {},
  stashFiles: {},
  version: {},
  busy: {},
  branches: {},
  branchList: {},
  pending: {},
  fetching: {},
  notices: {},
  drafts: {},
  generatingMessage: {},
  resolutions: {},

  async refreshBranches(projectIds) {
    const results = await Promise.all(
      projectIds.map((id) => window.capitaine.git.branch(id).then((info) => [id, info] as const, () => [id, null] as const))
    )
    set((s) => {
      const changed = results.some(([id, info]) => JSON.stringify(s.branches[id]) !== JSON.stringify(info))
      return changed ? { branches: { ...s.branches, ...Object.fromEntries(results) } } : s
    })
  },

  refresh(projectId) {
    const running = inFlight.get(projectId)
    if (running) return running
    const job = (async () => {
      try {
        const status = await window.capitaine.git.status(projectId)
        const previous = get().status[projectId]
        const changed = JSON.stringify(previous) !== JSON.stringify(status)
        // The stash count moves with every push / pop / drop, which also shifts the `stash@{n}` refs.
        const stashesStale = status && (previous?.stashCount !== status.stashCount || !get().stashes[projectId])
        const stashes = stashesStale ? await window.capitaine.git.stashes(projectId) : get().stashes[projectId]
        set((s) => ({
          status: changed ? { ...s.status, [projectId]: status } : s.status,
          stashes: stashesStale ? { ...s.stashes, [projectId]: stashes } : s.stashes,
          errors: s.errors[projectId] ? { ...s.errors, [projectId]: null } : s.errors,
          version: changed ? { ...s.version, [projectId]: (s.version[projectId] ?? 0) + 1 } : s.version
        }))
        if (changed && status) forgetSettledResolutions(projectId, status)
      } catch (error) {
        set((s) => ({ errors: { ...s.errors, [projectId]: errorText(error) } }))
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
  },

  setDraft(projectId, message) {
    set((s) => ({ drafts: { ...s.drafts, [projectId]: message } }))
  },

  async generateMessage(projectId) {
    if (get().generatingMessage[projectId]) return
    const status = get().status[projectId]
    const all = !!status && status.staged.length === 0
    set((s) => ({ generatingMessage: { ...s.generatingMessage, [projectId]: true }, errors: { ...s.errors, [projectId]: null } }))
    try {
      const message = await window.capitaine.git.ai.commitMessage(projectId, all)
      set((s) => ({ drafts: { ...s.drafts, [projectId]: message } }))
    } catch (error) {
      set((s) => ({ errors: { ...s.errors, [projectId]: errorText(error) } }))
    } finally {
      set((s) => ({ generatingMessage: { ...s.generatingMessage, [projectId]: false } }))
    }
  },

  async commit(projectId, followUp) {
    const status = get().status[projectId]
    const message = (get().drafts[projectId] ?? '').trim()
    if (!status || !message) return
    const all = status.staged.length === 0
    await run(projectId, 'commit', async () => {
      const done = await window.capitaine.git.commit(projectId, { message, all })
      set((s) => ({ drafts: { ...s.drafts, [projectId]: '' } }))
      if (followUp === 'none') return done
      const pulled = followUp === 'sync' ? await window.capitaine.git.pull(projectId) : null
      if (pulled?.conflicts) return { message: `${done.message} · ${pulled.message}`, conflicts: true }
      const pushed = await window.capitaine.git.push(projectId)
      return { message: [done.message, pulled?.message, pushed.message].filter(Boolean).join(' · ') }
    })
  },

  async push(projectId) {
    await run(projectId, 'push', () => window.capitaine.git.push(projectId))
  },

  async pull(projectId) {
    await run(projectId, 'pull', () => window.capitaine.git.pull(projectId))
  },

  async sync(projectId) {
    await run(projectId, 'sync', async () => {
      const pulled = await window.capitaine.git.pull(projectId)
      if (pulled.conflicts) return pulled
      const status = await window.capitaine.git.branch(projectId)
      if (!status?.ahead) return pulled
      const pushed = await window.capitaine.git.push(projectId)
      return { message: `${pulled.message} · ${pushed.message}` }
    })
  },

  async fetch(projectId, quiet) {
    if (get().fetching[projectId]) return
    set((s) => ({ fetching: { ...s.fetching, [projectId]: true } }))
    try {
      const done = await window.capitaine.git.fetch(projectId)
      if (!quiet) notify(projectId, { tone: 'ok', text: done.message })
    } catch (error) {
      // Background fetches fail quietly (offline, credentials): the next manual action will say why.
      if (!quiet) set((s) => ({ errors: { ...s.errors, [projectId]: errorText(error) } }))
    } finally {
      set((s) => ({ fetching: { ...s.fetching, [projectId]: false } }))
    }
    await Promise.all([get().refresh(projectId), get().refreshBranches([projectId])])
  },

  async loadBranchList(projectId) {
    try {
      const list = await window.capitaine.git.branches(projectId)
      set((s) => ({ branchList: { ...s.branchList, [projectId]: list } }))
    } catch (error) {
      set((s) => ({ errors: { ...s.errors, [projectId]: errorText(error) } }))
    }
  },

  async switchBranch(projectId, name) {
    return run(projectId, 'switch', () => window.capitaine.git.switchBranch(projectId, name))
  },

  async createBranch(projectId, name, from) {
    return run(projectId, 'branch', () => window.capitaine.git.createBranch(projectId, name, from))
  },

  async finishOperation(projectId, how) {
    await run(projectId, how, () => window.capitaine.git.finishOperation(projectId, how))
  },

  async takeSide(projectId, path, side) {
    await withBusy(projectId, [path], () => window.capitaine.git.takeSide(projectId, path, side))
    get().discardResolution(projectId, path)
  },

  async stashPush(projectId, options) {
    return run(projectId, 'stash', () => window.capitaine.git.stashPush(projectId, options))
  },

  async applyStash(projectId, stash, drop) {
    await run(projectId, 'stash', () => window.capitaine.git.stashApply(projectId, stash.ref, stash.hash, drop))
  },

  async dropStash(projectId, stash) {
    await run(projectId, 'stash', () => window.capitaine.git.stashDrop(projectId, stash.ref, stash.hash))
  },

  async resolveWithAi(projectId, path, options = { review: true }) {
    const key = resolutionKey(projectId, path)
    if (get().resolutions[key]?.state === 'pending') return
    setResolution(key, { state: 'pending' })
    try {
      const resolution = await window.capitaine.git.ai.resolveConflict(projectId, path)
      setResolution(key, { state: 'ready', resolution })
      const repoRoot = get().status[projectId]?.repoRoot
      if (options.review && repoRoot) useApp.getState().openDiff(projectId, resolutionDiff(repoRoot, path))
    } catch (error) {
      setResolution(key, { state: 'error', message: errorText(error) })
    }
  },

  async acceptResolution(projectId, path, content) {
    await withBusy(projectId, [path], () => window.capitaine.git.writeResolution(projectId, path, content))
    if (!get().errors[projectId]) get().discardResolution(projectId, path)
  },

  discardResolution(projectId, path) {
    setResolution(resolutionKey(projectId, path), undefined)
    const tabs = useApp.getState().tabs
    const review = Object.values(tabs).find((tab) => tab.projectId === projectId && tab.diff?.key === `resolution::${path}`)
    if (review) useApp.getState().closeTab(review.id)
  }
}))

function setResolution(key: string, value: ResolutionState | undefined) {
  useGit.setState((s) => {
    const resolutions = { ...s.resolutions }
    if (value) resolutions[key] = value
    else delete resolutions[key]
    return { resolutions }
  })
}

/** Proposals for files no longer in conflict (resolved by hand, merge aborted) have nothing left to review. */
function forgetSettledResolutions(projectId: string, status: RepoStatus) {
  const conflicted = new Set(status.conflicts.map((c) => c.path))
  const prefix = `${projectId}:`
  for (const [key, value] of Object.entries(useGit.getState().resolutions)) {
    if (!key.startsWith(prefix) || value?.state === 'pending') continue
    const path = key.slice(prefix.length)
    if (!conflicted.has(path)) useGit.getState().discardResolution(projectId, path)
  }
}

function notify(projectId: string, notice: GitNotice | null) {
  clearTimeout(noticeTimers.get(projectId))
  useGit.setState((s) => ({ notices: { ...s.notices, [projectId]: notice } }))
  if (notice) noticeTimers.set(projectId, setTimeout(() => notify(projectId, null), notice.tone === 'ok' ? 5000 : 9000))
}

/** Runs one repo-changing action: marks it pending, reports its outcome, then re-reads the repo. */
async function run(projectId: string, pending: GitPending, action: () => Promise<GitActionResult>): Promise<boolean> {
  if (useGit.getState().pending[projectId]) return false
  useGit.setState((s) => ({ pending: { ...s.pending, [projectId]: pending }, errors: { ...s.errors, [projectId]: null } }))
  notify(projectId, null)
  let ok = true
  let done: GitActionResult | null = null
  try {
    done = await action()
  } catch (error) {
    ok = false
    useGit.setState((s) => ({ errors: { ...s.errors, [projectId]: errorText(error) } }))
  } finally {
    useGit.setState((s) => ({ pending: { ...s.pending, [projectId]: undefined } }))
  }
  const failure = useGit.getState().errors[projectId]
  await Promise.all([useGit.getState().refresh(projectId), useGit.getState().refreshBranches([projectId])])
  // Stopped on conflicts mid-merge: the merge banner already says so.
  if (done && !(done.conflicts && useGit.getState().status[projectId]?.operation)) {
    notify(projectId, { tone: done.conflicts ? 'warn' : 'ok', text: done.message })
  }
  // `refresh` clears the error line on success: put the action's error back.
  if (failure) useGit.setState((s) => ({ errors: { ...s.errors, [projectId]: failure } }))
  if (useGit.getState().branchList[projectId]) void useGit.getState().loadBranchList(projectId)
  return ok
}

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
    failure = errorText(error)
  }
  mark(false)
  await useGit.getState().refresh(projectId)
  if (failure) useGit.setState((s) => ({ errors: { ...s.errors, [projectId]: failure } }))
}
