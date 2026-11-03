import { app, BrowserWindow, clipboard, dialog, ipcMain, shell } from 'electron'
import { join } from 'node:path'
import type { PtyCreateOptions, SessionSaveInput } from '../shared/types'
import { DirectoryWatchers, gitStatus, isInside, listDirectory, listProjectFiles, readTextFile, writeTextFile } from './file-system'
import { installAppMenu, installShortcutHandler, popupAppMenu } from './menu'
import { claudeUsage } from './claude-usage'
import { checkForUpdates, downloadUpdate, installUpdate, openReleasesPage, setupUpdater, updateState } from './updater'
import { branchInfo, repoRootOf, repoStatus, showBlob, stagePaths, stashFiles, stashList, unstagePaths } from './source-control'
import type { DiffSide } from '../shared/types'
import { ProjectStore } from './project-store'
import { PtyManager } from './pty-manager'
import { SessionStore } from './session-store'
import icon from '../../resources/icon.png?asset'

const isDev = !app.isPackaged
// Set while a quit is in progress, so a close the renderer vetoed (unsaved files) can resume it.
let quitRequested = false
const ptys = new PtyManager()
const watchers = new DirectoryWatchers()
let projects: ProjectStore
let session: SessionStore

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 720,
    minHeight: 480,
    show: false,
    backgroundColor: '#0e0f13',
    title: 'Capitaine',
    // macOS takes the icon from the app bundle; Linux/Windows windows need it explicitly.
    ...(process.platform !== 'darwin' ? { icon } : {}),
    // Custom title bar everywhere, like Orca: macOS keeps its inset traffic lights, Windows hides the
    // native bar, and Linux (which ignores titleBarStyle) drops the frame. The renderer draws the rest.
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : process.platform === 'win32' ? 'hidden' : undefined,
    ...(process.platform === 'linux' ? { frame: false } : {}),
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  win.once('ready-to-show', () => win.show())

  // Open external links (e.g. URLs clicked in a terminal) in the default browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })

  const contents = win.webContents
  installShortcutHandler(contents, isDev)
  win.on('maximize', () => contents.send('window:maximized', true))
  win.on('unmaximize', () => contents.send('window:maximized', false))
  // Dropping a file outside a terminal would otherwise navigate the window to it (and kill every shell).
  contents.on('will-navigate', (event, url) => {
    if (url !== contents.getURL()) event.preventDefault()
  })
  win.on('closed', () => {
    ptys.killAllFor(contents)
    watchers.removeOwner(contents)
  })
  contents.on('render-process-gone', () => ptys.killAllFor(contents))
  // A renderer reload drops every xterm instance, so their shells must go too.
  contents.on('did-start-navigation', (details) => {
    if (details.isMainFrame && !details.isSameDocument) {
      ptys.killAllFor(contents)
      watchers.removeOwner(contents)
    }
  })

  if (isDev && process.env.ELECTRON_RENDERER_URL) {
    void win.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
  return win
}

function registerIpc(): void {
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

  // The renderer only ever reaches files inside a registered project.
  const projectPath = (projectId: string, target?: string): string | null => {
    const root = projects.get(projectId)?.path
    if (!root || (target !== undefined && !isInside(root, target))) return null
    return root
  }
  ipcMain.handle('files:list', (_e, projectId: string, dir: string) => {
    const root = projectPath(projectId, dir)
    if (!root) throw new Error('Chemin hors du projet')
    return listDirectory(root, dir)
  })
  ipcMain.handle('files:all', (_e, projectId: string) => {
    const root = projectPath(projectId)
    return root ? listProjectFiles(root) : []
  })
  ipcMain.on('files:watch', (event, projectId: string, dir: string) => {
    if (projectPath(projectId, dir)) watchers.add(event.sender, dir)
  })
  ipcMain.on('files:unwatch', (event, dir: string) => watchers.remove(event.sender, dir))
  ipcMain.handle('files:git-status', (_e, projectId: string) => {
    const root = projectPath(projectId)
    return root ? gitStatus(root) : null
  })
  ipcMain.handle('files:read', (_e, projectId: string, path: string) => {
    if (!projectPath(projectId, path)) throw new Error('Chemin hors du projet')
    return readTextFile(path)
  })
  ipcMain.handle('files:write', (_e, projectId: string, path: string, content: string) => {
    if (!projectPath(projectId, path)) throw new Error('Chemin hors du projet')
    return writeTextFile(path, String(content))
  })
  ipcMain.handle('files:open', async (_e, projectId: string, path: string) => {
    if (!projectPath(projectId, path)) return
    const error = await shell.openPath(path)
    if (error) throw new Error(error)
  })
  ipcMain.on('files:reveal', (_e, projectId: string, path: string) => {
    if (projectPath(projectId, path)) shell.showItemInFolder(path)
  })
  // Git: the repo is always derived from the project here, never taken from the renderer.
  const repoOf = async (projectId: string): Promise<string> => {
    const root = projectPath(projectId)
    const repo = root ? await repoRootOf(root) : null
    if (!repo) throw new Error('Ce projet n’est pas un dépôt git')
    return repo
  }
  const repoPaths = (paths: unknown): string[] => (Array.isArray(paths) ? paths.filter((p): p is string => typeof p === 'string') : [])
  ipcMain.handle('git:status', (_e, projectId: string) => {
    const root = projectPath(projectId)
    return root ? repoStatus(root) : null
  })
  ipcMain.handle('git:stage', async (_e, projectId: string, paths: unknown) => stagePaths(await repoOf(projectId), repoPaths(paths)))
  ipcMain.handle('git:unstage', async (_e, projectId: string, paths: unknown) => unstagePaths(await repoOf(projectId), repoPaths(paths)))
  ipcMain.handle('git:stashes', async (_e, projectId: string) => stashList(await repoOf(projectId)))
  ipcMain.handle('git:stash-files', async (_e, projectId: string, ref: string) => stashFiles(await repoOf(projectId), String(ref)))
  ipcMain.handle('git:show', async (_e, projectId: string, side: DiffSide) => showBlob(await repoOf(projectId), side))
  ipcMain.handle('git:branch', (_e, projectId: string) => {
    const root = projectPath(projectId)
    return root ? branchInfo(root) : null
  })
  ipcMain.handle('claude:usage', (_e, force: unknown) => claudeUsage(force === true))
  ipcMain.handle('updater:state', () => updateState())
  ipcMain.on('updater:check', () => void checkForUpdates(true))
  ipcMain.on('updater:download', () => void downloadUpdate())
  ipcMain.on('updater:install', () => installUpdate())
  ipcMain.on('updater:open-releases', (_e, version: unknown) =>
    openReleasesPage(typeof version === 'string' && /^\d+\.\d+\.\d+[\w.-]*$/.test(version) ? version : undefined)
  )

  ipcMain.on('clipboard:write', (_e, text: string) => clipboard.writeText(String(text)))

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
  ipcMain.on('window:close-confirmed', (event) => {
    if (quitRequested) app.quit()
    else BrowserWindow.fromWebContents(event.sender)?.close()
  })
  ipcMain.on('window:close-cancelled', () => {
    quitRequested = false
  })
  const senderWindow = (event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent) => BrowserWindow.fromWebContents(event.sender)
  ipcMain.on('window:minimize', (event) => senderWindow(event)?.minimize())
  ipcMain.on('window:toggle-maximize', (event) => {
    const win = senderWindow(event)
    if (!win) return
    if (win.isMaximized()) win.unmaximize()
    else win.maximize()
  })
  // close() (not destroy) so unsaved editors can still veto it.
  ipcMain.on('window:close', (event) => senderWindow(event)?.close())
  ipcMain.handle('window:is-maximized', (event) => senderWindow(event)?.isMaximized() ?? false)
  ipcMain.on('window:popup-menu', (event, x: number, y: number) => {
    const win = senderWindow(event)
    if (win) popupAppMenu(win, Number(x) || 0, Number(y) || 0)
  })
  ipcMain.on('window:focus', (event) => {
    const win = BrowserWindow.fromWebContents(event.sender)
    if (!win) return
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
  })
}

app.whenReady().then(() => {
  app.setName('Capitaine')
  if (process.platform === 'darwin' && isDev) app.dock?.setIcon(icon)
  projects = new ProjectStore()
  session = new SessionStore(ptys)
  registerIpc()
  installAppMenu(isDev)
  createWindow()
  setupUpdater()

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  quitRequested = true
})

// Only once every window agreed to close (no unsaved files left) do the shells go.
app.on('will-quit', () => ptys.killAll())
