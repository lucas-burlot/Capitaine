import { app, BrowserWindow, ipcMain, shell } from 'electron'
import { join } from 'node:path'
import type { DirectoryWatchers } from './files/file-system'
import { installShortcutHandler, popupAppMenu } from './menu'
import type { PtyManager } from './terminals/pty-manager'
import icon from '../../resources/icon.png?asset'

// Set while a quit is in progress, so a close the renderer vetoed (unsaved files) can resume it.
let quitRequested = false

export function markQuitRequested(): void {
  quitRequested = true
}

export function createWindow(options: { ptys: PtyManager; watchers: DirectoryWatchers; isDev: boolean }): BrowserWindow {
  const { ptys, watchers, isDev } = options
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

export function registerWindowIpc(): void {
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
