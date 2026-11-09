import { ipcMain } from 'electron'
import type { CommitOptions, DiffSide, StashOptions } from '../../shared/types'
import type { ProjectStore } from '../projects/project-store'
import { stringList, text } from '../system/ipc-args'
import {
  commit,
  createBranch,
  fetchAll,
  finishOperation,
  listBranches,
  pull,
  push,
  stashApply,
  stashDrop,
  stashPush,
  switchBranch,
  takeSide,
  writeResolution
} from './git-actions'
import { generateCommitMessage, resolveConflict } from './git-ai'
import { branchInfo, repoRootOf, repoStatus, showBlob, stagePaths, stashFiles, stashList, unstagePaths } from './git-repo'

export function registerGitIpc(projects: ProjectStore): void {
  // The repo is always derived from the project here, never taken from the renderer.
  const repoOf = async (projectId: string): Promise<string> => {
    const root = projects.rootFor(projectId)
    const repo = root ? await repoRootOf(root) : null
    if (!repo) throw new Error('Ce projet n’est pas un dépôt git')
    return repo
  }

  ipcMain.handle('git:status', (_e, projectId: string) => {
    const root = projects.rootFor(projectId)
    return root ? repoStatus(root) : null
  })
  ipcMain.handle('git:stage', async (_e, projectId: string, paths: unknown) => stagePaths(await repoOf(projectId), stringList(paths)))
  ipcMain.handle('git:unstage', async (_e, projectId: string, paths: unknown) => unstagePaths(await repoOf(projectId), stringList(paths)))
  ipcMain.handle('git:stashes', async (_e, projectId: string) => stashList(await repoOf(projectId)))
  ipcMain.handle('git:stash-files', async (_e, projectId: string, ref: string) => stashFiles(await repoOf(projectId), String(ref)))
  ipcMain.handle('git:show', async (_e, projectId: string, side: DiffSide) => showBlob(await repoOf(projectId), side))
  ipcMain.handle('git:branch', (_e, projectId: string) => {
    const root = projects.rootFor(projectId)
    return root ? branchInfo(root) : null
  })
  ipcMain.handle('git:branches', async (_e, projectId: string) => listBranches(await repoOf(projectId)))
  ipcMain.handle('git:switch', async (_e, projectId: string, name: unknown) => switchBranch(await repoOf(projectId), text(name)))
  ipcMain.handle('git:create-branch', async (_e, projectId: string, name: unknown, from: unknown) =>
    createBranch(await repoOf(projectId), text(name), text(from) || undefined)
  )
  ipcMain.handle('git:commit', async (_e, projectId: string, options: Partial<CommitOptions> | undefined) =>
    commit(await repoOf(projectId), { message: text(options?.message), all: options?.all === true, amend: options?.amend === true })
  )
  ipcMain.handle('git:push', async (_e, projectId: string) => push(await repoOf(projectId)))
  ipcMain.handle('git:pull', async (_e, projectId: string) => pull(await repoOf(projectId)))
  ipcMain.handle('git:fetch', async (_e, projectId: string) => fetchAll(await repoOf(projectId)))
  ipcMain.handle('git:finish-operation', async (_e, projectId: string, how: unknown) =>
    finishOperation(await repoOf(projectId), how === 'abort' ? 'abort' : 'continue')
  )
  ipcMain.handle('git:take-side', async (_e, projectId: string, path: unknown, side: unknown) =>
    takeSide(await repoOf(projectId), text(path), side === 'incoming' ? 'incoming' : 'current')
  )
  ipcMain.handle('git:write-resolution', async (_e, projectId: string, path: unknown, content: unknown) =>
    writeResolution(await repoOf(projectId), text(path), text(content))
  )
  ipcMain.handle('git:stash-push', async (_e, projectId: string, options: Partial<StashOptions> | undefined) =>
    stashPush(await repoOf(projectId), {
      message: text(options?.message),
      includeUntracked: options?.includeUntracked === true,
      stagedOnly: options?.stagedOnly === true,
      paths: stringList(options?.paths)
    })
  )
  ipcMain.handle('git:stash-apply', async (_e, projectId: string, ref: unknown, hash: unknown, drop: unknown) =>
    stashApply(await repoOf(projectId), text(ref), text(hash), drop === true)
  )
  ipcMain.handle('git:stash-drop', async (_e, projectId: string, ref: unknown, hash: unknown) =>
    stashDrop(await repoOf(projectId), text(ref), text(hash))
  )
  ipcMain.handle('git:ai-commit-message', async (_e, projectId: string, all: unknown) =>
    generateCommitMessage(await repoOf(projectId), all === true)
  )
  ipcMain.handle('git:ai-resolve', async (_e, projectId: string, path: unknown) => resolveConflict(await repoOf(projectId), text(path)))
}
