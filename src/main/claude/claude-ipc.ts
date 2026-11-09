import { ipcMain } from 'electron'
import type { ProjectStore } from '../projects/project-store'
import { listClaudeConfig } from './claude-config'
import { claudeUsage } from './claude-usage'

export function registerClaudeIpc(projects: ProjectStore): void {
  ipcMain.handle('claude:usage', (_e, force: unknown) => claudeUsage(force === true))
  ipcMain.handle('claude:config', (_e, projectId: string) => listClaudeConfig(projects.rootFor(projectId)))
}
