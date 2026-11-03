import { app, BrowserWindow, shell } from 'electron'
import electronUpdater from 'electron-updater'
import type { UpdateState } from '../shared/types'

const { autoUpdater } = electronUpdater

const RELEASES_URL = 'https://github.com/lucas-burlot/Capitaine/releases'
/** Background check cadence once the first startup check is done. */
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000
const FIRST_CHECK_DELAY_MS = 10_000

let state: UpdateState = { status: 'idle', currentVersion: app.getVersion(), version: null, percent: null, error: null, manual: false }

function publish(patch: Partial<UpdateState>) {
  state = { ...state, ...patch }
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send('updater:state', state)
}

export function updateState(): UpdateState {
  return state
}

/** Where updates can apply: packaged builds, and on Linux only the AppImage / deb flavours. */
function updatesSupported(): boolean {
  if (!app.isPackaged) return false
  if (process.platform === 'linux') return Boolean(process.env.APPIMAGE) || process.resourcesPath.startsWith('/opt/')
  return true
}

/** `manual`: the user asked ("Rechercher les mises à jour…"), so "up to date" and errors are worth showing. */
export async function checkForUpdates(manual: boolean): Promise<void> {
  if (!updatesSupported()) {
    publish({ status: 'unsupported', manual, error: app.isPackaged ? null : 'Mode développement' })
    return
  }
  if (state.status === 'checking' || state.status === 'downloading') return
  if (state.status === 'ready') {
    publish({ manual })
    return
  }
  publish({ status: 'checking', manual, error: null })
  try {
    await autoUpdater.checkForUpdates()
  } catch (error) {
    publish({ status: 'error', error: describe(error) })
  }
}

export function installUpdate(): void {
  if (state.status !== 'ready') return
  // Quits (letting windows veto for unsaved files) and relaunches on the new version.
  setImmediate(() => autoUpdater.quitAndInstall(false, true))
}

export function openReleasesPage(): void {
  void shell.openExternal(RELEASES_URL)
}

function describe(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error)
  // The feed is missing until the first release exists.
  if (/No published versions|404|latest.*\.yml|Cannot find/i.test(message)) return 'Aucune version publiée pour le moment'
  if (/net::|ENOTFOUND|ECONNREFUSED|ETIMEDOUT/i.test(message)) return 'Pas de connexion à GitHub'
  if (/signature|code sign/i.test(message)) return 'Installation automatique impossible (app non signée) : télécharge la nouvelle version'
  return message.split('\n')[0].slice(0, 200)
}

export function setupUpdater(): void {
  autoUpdater.autoDownload = true
  // Installed on quit too, so a downloaded update never waits for the restart button.
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.allowPrerelease = false
  autoUpdater.logger = null

  autoUpdater.on('checking-for-update', () => publish({ status: 'checking' }))
  autoUpdater.on('update-not-available', () => publish({ status: 'up-to-date', version: null, percent: null }))
  autoUpdater.on('update-available', (info) => publish({ status: 'downloading', version: info.version, percent: 0 }))
  autoUpdater.on('download-progress', (progress) => publish({ status: 'downloading', percent: Math.round(progress.percent) }))
  autoUpdater.on('update-downloaded', (info) => publish({ status: 'ready', version: info.version, percent: 100 }))
  autoUpdater.on('error', (error) => publish({ status: 'error', error: describe(error) }))

  if (!updatesSupported()) {
    state = { ...state, status: 'unsupported', error: app.isPackaged ? null : 'Mode développement' }
    return
  }
  setTimeout(() => void checkForUpdates(false), FIRST_CHECK_DELAY_MS)
  setInterval(() => void checkForUpdates(false), CHECK_EVERY_MS)
}
