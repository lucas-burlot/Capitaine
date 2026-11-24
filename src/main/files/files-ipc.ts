import { rm } from 'node:fs/promises'
import { clipboard, ipcMain, shell } from 'electron'
import type { ProjectStore } from '../projects/project-store'
import { isClaudeConfigPath } from '../claude/claude-config'
import { isInside } from '../system/paths'
import { createEntry, duplicateEntry, renameEntry } from './file-operations'
import { DirectoryWatchers, gitStatus, listDirectory, listProjectFiles, readTextFile, writeTextFile } from './file-system'

export function registerFilesIpc(projects: ProjectStore, watchers: DirectoryWatchers): void {
  /**
   * Inside the project, or one of the Claude Code files listed for it (~/.claude, plugins): the
   * Claude panel opens those in the editor too.
   */
  const reachable = async (projectId: string, path: string, asDirectory = false): Promise<boolean> =>
    !!projects.rootFor(projectId, path) || (!!projects.get(projectId) && (await isClaudeConfigPath(projects.rootFor(projectId), path, asDirectory)))

  ipcMain.handle('files:list', (_e, projectId: string, dir: string) => {
    const root = projects.rootFor(projectId, dir)
    if (!root) throw new Error('Chemin hors du projet')
    return listDirectory(root, dir)
  })
  ipcMain.handle('files:all', (_e, projectId: string) => {
    const root = projects.rootFor(projectId)
    return root ? listProjectFiles(root) : []
  })
  ipcMain.on('files:watch', async (event, projectId: string, dir: string) => {
    if (await reachable(projectId, dir, true)) watchers.add(event.sender, dir)
  })
  ipcMain.on('files:unwatch', (event, dir: string) => watchers.remove(event.sender, dir))
  ipcMain.handle('files:git-status', (_e, projectId: string) => {
    const root = projects.rootFor(projectId)
    return root ? gitStatus(root) : null
  })
  ipcMain.handle('files:read', async (_e, projectId: string, path: string) => {
    if (!(await reachable(projectId, path))) throw new Error('Chemin hors du projet')
    return readTextFile(path)
  })
  ipcMain.handle('files:write', async (_e, projectId: string, path: string, content: string) => {
    if (!(await reachable(projectId, path))) throw new Error('Chemin hors du projet')
    return writeTextFile(path, String(content))
  })
  ipcMain.handle('files:open', async (_e, projectId: string, path: string) => {
    if (!projects.rootFor(projectId, path)) return
    const error = await shell.openPath(path)
    if (error) throw new Error(error)
  })
  ipcMain.on('files:reveal', async (_e, projectId: string, path: string) => {
    if (await reachable(projectId, path)) shell.showItemInFolder(path)
  })
  /** Inside the project, and not the project folder itself. */
  const editable = (projectId: string, path: unknown): string => {
    const target = typeof path === 'string' ? path : ''
    const root = target ? projects.rootFor(projectId, target) : null
    if (!root || isInside(target, root)) throw new Error('Chemin hors du projet')
    return target
  }
  ipcMain.handle('files:create', (_e, projectId: string, dir: unknown, name: unknown, kind: unknown) => {
    const folder = typeof dir === 'string' ? dir : ''
    if (!folder || !projects.rootFor(projectId, folder)) throw new Error('Chemin hors du projet')
    return createEntry(folder, String(name ?? ''), kind === 'directory' ? 'directory' : 'file')
  })
  ipcMain.handle('files:rename', (_e, projectId: string, path: unknown, name: unknown) => renameEntry(editable(projectId, path), String(name ?? '')))
  ipcMain.handle('files:duplicate', (_e, projectId: string, path: unknown) => duplicateEntry(editable(projectId, path)))
  ipcMain.handle('files:trash', (_e, projectId: string, path: unknown) => shell.trashItem(editable(projectId, path)))
  // When the trash can't take it (a tmpfs, some network or removable disks), and only once asked.
  ipcMain.handle('files:delete', (_e, projectId: string, path: unknown) => rm(editable(projectId, path), { recursive: true, force: true }))
  ipcMain.on('clipboard:write', (_e, text: string) => clipboard.writeText(String(text)))
}
