import { ipcMain } from 'electron'
import type { PtyCreateOptions, SessionSaveInput } from '../../shared/types'
import type { PtyManager } from './pty-manager'
import type { SessionStore } from './session-store'

export function registerTerminalsIpc(ptys: PtyManager, session: SessionStore): void {
  ipcMain.handle('session:load', () => session.load())
  ipcMain.on('session:save', (_e, input: SessionSaveInput) => void session.save(input))
  // Sent while the window unloads: the shells die right after, so their directories are read now.
  ipcMain.on('session:save-sync', (event, input: SessionSaveInput) => {
    session.saveSync(input)
    event.returnValue = true
  })
  ipcMain.handle('pty:create', (event, options: PtyCreateOptions) => ptys.create(event.sender, options))
  ipcMain.on('pty:write', (_e, id: string, data: string) => ptys.write(id, data))
  ipcMain.on('pty:resize', (_e, id: string, cols: number, rows: number) => ptys.resize(id, cols, rows))
  ipcMain.on('pty:kill', (_e, id: string) => ptys.kill(id))
}
