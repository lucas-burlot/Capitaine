import { readFileSync } from 'node:fs'
import { app, BrowserWindow, shell } from 'electron'
import electronUpdater, { type UpdateInfo } from 'electron-updater'
import type { UpdateState } from '../shared/types'

const { autoUpdater } = electronUpdater

const RELEASES_URL = 'https://github.com/lucas-burlot/Capitaine/releases'
/** Background check cadence once the first startup check is done. */
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000
const FIRST_CHECK_DELAY_MS = 10_000
/** Unsigned macOS apps can't install an update themselves: the download button opens the release instead. */
const canSelfInstall = process.platform !== 'darwin'

let state: UpdateState = {
  status: 'idle',
  currentVersion: app.getVersion(),
  version: null,
  notes: [],
  releaseUrl: null,
  percent: null,
  error: null,
  manual: false,
  checkedAt: null,
  canSelfInstall
}

function publish(patch: Partial<UpdateState>) {
  state = { ...state, ...patch }
  for (const win of BrowserWindow.getAllWindows()) win.webContents.send('updater:state', state)
}

export function updateState(): UpdateState {
  return state
}

/**
 * Test/screenshot hook: CAPITAINE_UPDATE_FIXTURE points to `{ "version": "…", "notes": ["…"] }` and the
 * whole flow (available → download → ready) is simulated, with no network and no install.
 */
const fixture = (() => {
  const path = process.env.CAPITAINE_UPDATE_FIXTURE
  if (!path) return null
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as { version: string; notes?: string[] }
  } catch {
    return null
  }
})()

/** Where updates can apply: packaged builds, and on Linux only the AppImage / deb flavours. */
function updatesSupported(): boolean {
  if (fixture) return true
  if (!app.isPackaged) return false
  if (process.platform === 'linux') return Boolean(process.env.APPIMAGE) || process.resourcesPath.startsWith('/opt/')
  return true
}

function releaseUrl(version: string): string {
  return `${RELEASES_URL}/tag/v${version}`
}

/** GitHub release notes arrive as HTML: keep the bullet points, as plain text. */
function noteLines(notes: UpdateInfo['releaseNotes']): string[] {
  const html = typeof notes === 'string' ? notes : Array.isArray(notes) ? notes.map((n) => n.note ?? '').join('\n') : ''
  return html
    .replace(/<\/(li|p|h\d)>|<br\s*\/?>/gi, '\n')
    .replace(/<li[^>]*>/gi, '- ')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.startsWith('- ') || line.startsWith('* '))
    .map((line) => line.slice(2).trim())
    .filter(Boolean)
    .slice(0, 8)
}

/** `manual`: the user asked ("Rechercher les mises à jour…"), so "up to date" and errors are worth showing. */
export async function checkForUpdates(manual: boolean): Promise<void> {
  if (!updatesSupported()) {
    publish({ status: 'unsupported', manual, error: app.isPackaged ? null : 'Mode développement' })
    return
  }
  if (state.status === 'checking' || state.status === 'downloading') return
  // Already found or downloaded: just show it again.
  if (state.status === 'available' || state.status === 'ready') {
    publish({ manual })
    return
  }
  publish({ status: 'checking', manual, error: null })
  if (fixture) {
    publish({ status: 'available', version: fixture.version, notes: fixture.notes ?? [], releaseUrl: releaseUrl(fixture.version), checkedAt: Date.now() })
    return
  }
  try {
    await autoUpdater.checkForUpdates()
  } catch (error) {
    publish({ status: 'error', error: describe(error), checkedAt: Date.now() })
  }
}

/** The "Télécharger" button: nothing is downloaded until the user asks. */
export async function downloadUpdate(): Promise<void> {
  if (!state.version || !['available', 'error'].includes(state.status)) return
  if (!state.canSelfInstall) {
    void shell.openExternal(releaseUrl(state.version))
    return
  }
  publish({ status: 'downloading', percent: 0, error: null })
  if (fixture) {
    const timer = setInterval(() => {
      const percent = Math.min(100, (state.percent ?? 0) + 25)
      if (percent < 100) publish({ percent })
      else {
        clearInterval(timer)
        publish({ status: 'ready', percent: 100 })
      }
    }, 250)
    return
  }
  try {
    await autoUpdater.downloadUpdate()
  } catch (error) {
    publish({ status: 'error', error: describe(error) })
  }
}

export function installUpdate(): void {
  if (state.status !== 'ready' || fixture) return
  // Quits (letting windows veto for unsaved files) and relaunches on the new version.
  setImmediate(() => autoUpdater.quitAndInstall(false, true))
}

export function openReleasesPage(version?: string): void {
  void shell.openExternal(version ? releaseUrl(version) : RELEASES_URL)
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
  // Ask first: a check only announces the version; the download starts from the update card.
  autoUpdater.autoDownload = false
  // Once downloaded, it also installs when the app quits (the "Au prochain lancement" choice).
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.allowPrerelease = false
  autoUpdater.logger = null

  autoUpdater.on('update-not-available', () =>
    publish({ status: 'up-to-date', version: null, notes: [], releaseUrl: null, percent: null, checkedAt: Date.now() })
  )
  autoUpdater.on('update-available', (info) =>
    publish({
      status: 'available',
      version: info.version,
      notes: noteLines(info.releaseNotes),
      releaseUrl: releaseUrl(info.version),
      percent: null,
      checkedAt: Date.now()
    })
  )
  autoUpdater.on('download-progress', (progress) => publish({ status: 'downloading', percent: Math.round(progress.percent) }))
  autoUpdater.on('update-downloaded', (info) => publish({ status: 'ready', version: info.version, percent: 100 }))
  autoUpdater.on('error', (error) => {
    // A failed download keeps the version, so the card can offer to retry.
    publish({ status: 'error', error: describe(error) })
  })

  if (!updatesSupported()) {
    state = { ...state, status: 'unsupported', error: app.isPackaged ? null : 'Mode développement' }
    return
  }
  setTimeout(() => void checkForUpdates(false), fixture ? 1500 : FIRST_CHECK_DELAY_MS)
  setInterval(() => void checkForUpdates(false), CHECK_EVERY_MS)
}
