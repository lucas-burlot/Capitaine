import { ipcMain } from 'electron'
import { claudeUsage } from './claude-usage'

export function registerClaudeIpc(): void {
  ipcMain.handle('claude:usage', (_e, force: unknown) => claudeUsage(force === true))
}
