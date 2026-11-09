import { clipboard, ipcMain, shell } from 'electron'
import type { ProjectStore } from '../projects/project-store'
import { isClaudeConfigPath } from '../claude/claude-config'
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
  ipcMain.on('clipboard:write', (_e, text: string) => clipboard.writeText(String(text)))
}
