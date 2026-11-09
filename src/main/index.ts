import { app, BrowserWindow } from 'electron'
import { registerClaudeIpc } from './claude/claude-ipc'
import { registerDockerIpc } from './docker/docker-ipc'
import { DirectoryWatchers } from './files/file-system'
import { registerFilesIpc } from './files/files-ipc'
import { registerGitIpc } from './git/git-ipc'
import { installAppMenu } from './menu'
import { ProjectStore } from './projects/project-store'
import { registerProjectsIpc } from './projects/projects-ipc'
import { PtyManager } from './terminals/pty-manager'
import { SessionStore } from './terminals/session-store'
import { registerTerminalsIpc } from './terminals/terminals-ipc'
import { setupUpdater } from './updater/updater'
import { registerUpdaterIpc } from './updater/updater-ipc'
import { createWindow, markQuitRequested, registerWindowIpc } from './window'
import icon from '../../resources/icon.png?asset'

const isDev = !app.isPackaged
const ptys = new PtyManager()
const watchers = new DirectoryWatchers()

app.whenReady().then(() => {
  app.setName('Capitaine')
  if (process.platform === 'darwin' && isDev) app.dock?.setIcon(icon)
  const projects = new ProjectStore()
  const session = new SessionStore(ptys)

  registerProjectsIpc(projects)
  registerFilesIpc(projects, watchers)
  registerGitIpc(projects)
  registerTerminalsIpc(ptys, session)
  registerClaudeIpc(projects)
  registerDockerIpc()
  registerUpdaterIpc()
  registerWindowIpc()

  installAppMenu(isDev)
  createWindow({ ptys, watchers, isDev })
  setupUpdater()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow({ ptys, watchers, isDev })
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => markQuitRequested())

// Only once every window agreed to close (no unsaved files left) do the shells go.
app.on('will-quit', () => ptys.killAll())
