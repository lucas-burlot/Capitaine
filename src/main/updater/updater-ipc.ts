import { ipcMain } from 'electron'
import { checkForUpdates, downloadUpdate, installUpdate, openReleasesPage, updateState } from './updater'

export function registerUpdaterIpc(): void {
  ipcMain.handle('updater:state', () => updateState())
  ipcMain.on('updater:check', () => void checkForUpdates(true))
  ipcMain.on('updater:download', () => void downloadUpdate())
  ipcMain.on('updater:install', () => installUpdate())
  ipcMain.on('updater:open-releases', (_e, version: unknown) =>
    openReleasesPage(typeof version === 'string' && /^\d+\.\d+\.\d+[\w.-]*$/.test(version) ? version : undefined)
  )
}
