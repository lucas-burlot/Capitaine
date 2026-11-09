import { ipcMain } from 'electron'
import { text } from '../system/ipc-args'
import { containerAction, containerLogs, listContainers } from './docker'

export function registerDockerIpc(): void {
  ipcMain.handle('docker:list', () => listContainers())
  ipcMain.handle('docker:action', (_e, id: unknown, action: unknown) =>
    containerAction(text(id), action === 'stop' ? 'stop' : action === 'restart' ? 'restart' : 'start')
  )
  ipcMain.handle('docker:logs', (_e, id: unknown, tail: unknown) => containerLogs(text(id), Number(tail)))
}
