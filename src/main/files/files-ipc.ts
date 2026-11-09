import { clipboard, ipcMain, shell } from 'electron'
import type { ProjectStore } from '../projects/project-store'
import { DirectoryWatchers, gitStatus, listDirectory, listProjectFiles, readTextFile, writeTextFile } from './file-system'

export function registerFilesIpc(projects: ProjectStore, watchers: DirectoryWatchers): void {
  ipcMain.handle('files:list', (_e, projectId: string, dir: string) => {
    const root = projects.rootFor(projectId, dir)
    if (!root) throw new Error('Chemin hors du projet')
    return listDirectory(root, dir)
  })
  ipcMain.handle('files:all', (_e, projectId: string) => {
    const root = projects.rootFor(projectId)
    return root ? listProjectFiles(root) : []
  })
  ipcMain.on('files:watch', (event, projectId: string, dir: string) => {
    if (projects.rootFor(projectId, dir)) watchers.add(event.sender, dir)
  })
  ipcMain.on('files:unwatch', (event, dir: string) => watchers.remove(event.sender, dir))
  ipcMain.handle('files:git-status', (_e, projectId: string) => {
    const root = projects.rootFor(projectId)
    return root ? gitStatus(root) : null
  })
  ipcMain.handle('files:read', (_e, projectId: string, path: string) => {
    if (!projects.rootFor(projectId, path)) throw new Error('Chemin hors du projet')
    return readTextFile(path)
  })
  ipcMain.handle('files:write', (_e, projectId: string, path: string, content: string) => {
    if (!projects.rootFor(projectId, path)) throw new Error('Chemin hors du projet')
    return writeTextFile(path, String(content))
  })
  ipcMain.handle('files:open', async (_e, projectId: string, path: string) => {
    if (!projects.rootFor(projectId, path)) return
    const error = await shell.openPath(path)
    if (error) throw new Error(error)
  })
  ipcMain.on('files:reveal', (_e, projectId: string, path: string) => {
    if (projects.rootFor(projectId, path)) shell.showItemInFolder(path)
  })
  ipcMain.on('clipboard:write', (_e, text: string) => clipboard.writeText(String(text)))
}
