import { BrowserWindow, dialog, ipcMain, shell } from 'electron'
import type { ProjectStore } from './project-store'

export function registerProjectsIpc(projects: ProjectStore): void {
  ipcMain.handle('projects:list', () => projects.list())
  ipcMain.handle('projects:add', async (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    const options: Electron.OpenDialogOptions = {
      title: 'Choisir le dossier du projet',
      properties: ['openDirectory', 'createDirectory']
    }
    const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    if (result.canceled || result.filePaths.length === 0) return null
    return projects.add(result.filePaths[0])
  })
  ipcMain.handle('projects:rename', (_e, id: string, name: string) => projects.rename(id, name))
  ipcMain.handle('projects:remove', (_e, id: string) => projects.remove(id))
  ipcMain.handle('projects:reorder', (_e, ids: string[]) => projects.reorder(ids))
  ipcMain.handle('projects:reveal', (_e, id: string) => {
    const project = projects.get(id)
    if (project) void shell.openPath(project.path)
  })
}
