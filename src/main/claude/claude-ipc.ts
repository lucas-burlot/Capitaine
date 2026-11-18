import { ipcMain } from 'electron'
import type { ChatControlRequest, ChatPermissionResponse, ChatStartOptions, ChatUserContent } from '../../shared/types'
import type { ProjectStore } from '../projects/project-store'
import type { PtyManager } from '../terminals/pty-manager'
import type { ChatManager } from './claude-chat'
import { listClaudeConfig } from './claude-config'
import { findClaudeAgents } from './claude-sessions'
import { readChatHistory } from './claude-transcript'
import { claudeUsage } from './claude-usage'

export function registerClaudeIpc(projects: ProjectStore, chats: ChatManager, ptys: PtyManager): void {
  ipcMain.handle('claude:usage', (_e, force: unknown) => claudeUsage(force === true))
  ipcMain.handle('claude:config', (_e, projectId: string) => listClaudeConfig(projects.rootFor(projectId)))

  ipcMain.handle('chat:start', (event, options: ChatStartOptions) => chats.start(event.sender, options))
  ipcMain.on('chat:send', (_e, chatId: string, uuid: string, content: ChatUserContent) => chats.send(chatId, uuid, content))
  ipcMain.on('chat:respond', (_e, chatId: string, requestId: string, response: ChatPermissionResponse) => chats.respond(chatId, requestId, response))
  ipcMain.handle('chat:control', (_e, chatId: string, request: ChatControlRequest) => chats.control(chatId, request))
  ipcMain.on('chat:stop', (_e, chatId: string) => chats.stop(chatId))
  ipcMain.handle('chat:history', (_e, sessionId: string) => readChatHistory(sessionId))
  // The Claude session running in a terminal, to carry it over into a chat.
  ipcMain.handle('chat:agent-in-terminal', async (_e, ptyId: string) => {
    const pid = typeof ptyId === 'string' ? ptys.pidOf(ptyId) : null
    if (!pid) return null
    const agents = await findClaudeAgents(new Map([['terminal', pid]]))
    // A Claude typed moments ago (e.g. just switched from the chat) may not have registered yet.
    return agents.get('terminal') ?? ptys.relaunchedAgentOf(ptyId)
  })
  // Where the shell is now: a chat replacing it starts there.
  ipcMain.handle('chat:terminal-cwd', (_e, ptyId: string) => (typeof ptyId === 'string' ? ptys.cwdOf(ptyId) : null))
}
