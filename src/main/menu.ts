import { app, BrowserWindow, Menu, type Input, type MenuItemConstructorOptions, type WebContents } from 'electron'
import type { MenuCommand } from '../shared/types'

const isMac = process.platform === 'darwin'

type WindowAction = 'copy' | 'paste' | 'selectAll' | 'quit' | 'zoomIn' | 'zoomOut' | 'resetZoom' | 'fullscreen' | 'devtools' | 'reload'
type Action = MenuCommand | WindowAction

interface Shortcut {
  action: Action
  mac: string
  /** Linux/Windows: the terminal owns Ctrl+<letter> (Ctrl+C, Ctrl+W, Ctrl+R…), so app shortcuts use Ctrl+Shift. */
  other: string
  devOnly?: boolean
}

const SHORTCUTS: Shortcut[] = [
  { action: 'add-project', mac: 'Cmd+O', other: 'Ctrl+Shift+O' },
  { action: 'new-terminal', mac: 'Cmd+T', other: 'Ctrl+Shift+T' },
  { action: 'close-terminal', mac: 'Cmd+W', other: 'Ctrl+Shift+W' },
  { action: 'split-right', mac: 'Cmd+D', other: 'Ctrl+Shift+D' },
  { action: 'split-down', mac: 'Cmd+Shift+D', other: 'Ctrl+Shift+E' },
  { action: 'next-terminal', mac: 'Cmd+Shift+]', other: 'Ctrl+Tab' },
  { action: 'prev-terminal', mac: 'Cmd+Shift+[', other: 'Ctrl+Shift+Tab' },
  { action: 'next-pane', mac: 'Cmd+Alt+Right', other: 'Ctrl+Alt+Right' },
  { action: 'prev-pane', mac: 'Cmd+Alt+Left', other: 'Ctrl+Alt+Left' },
  { action: 'toggle-explorer', mac: 'Cmd+B', other: 'Ctrl+Shift+B' },
  { action: 'toggle-sidebar', mac: 'Cmd+Shift+S', other: 'Ctrl+Shift+S' },
  { action: 'copy', mac: 'Cmd+C', other: 'Ctrl+Shift+C' },
  { action: 'paste', mac: 'Cmd+V', other: 'Ctrl+Shift+V' },
  { action: 'selectAll', mac: 'Cmd+A', other: 'Ctrl+Shift+A' },
  { action: 'quit', mac: 'Cmd+Q', other: 'Ctrl+Q' },
  { action: 'zoomIn', mac: 'Cmd+=', other: 'Ctrl+=' },
  { action: 'zoomOut', mac: 'Cmd+-', other: 'Ctrl+-' },
  { action: 'resetZoom', mac: 'Cmd+0', other: 'Ctrl+0' },
  { action: 'fullscreen', mac: 'Ctrl+Cmd+F', other: 'F11' },
  { action: 'devtools', mac: 'Alt+Cmd+I', other: 'Ctrl+Shift+I', devOnly: true },
  { action: 'reload', mac: 'Cmd+R', other: 'Ctrl+Shift+R', devOnly: true }
]

function accelerator(action: Action): string | undefined {
  const shortcut = SHORTCUTS.find((s) => s.action === action)
  return shortcut && (isMac ? shortcut.mac : shortcut.other)
}

function run(action: Action, contents: WebContents) {
  const win = BrowserWindow.fromWebContents(contents)
  switch (action) {
    case 'copy':
      return contents.copy()
    case 'paste':
      return contents.paste()
    case 'selectAll':
      return contents.selectAll()
    case 'quit':
      return app.quit()
    case 'zoomIn':
      return contents.setZoomLevel(contents.getZoomLevel() + 0.5)
    case 'zoomOut':
      return contents.setZoomLevel(contents.getZoomLevel() - 0.5)
    case 'resetZoom':
      return contents.setZoomLevel(0)
    case 'fullscreen':
      return win?.setFullScreen(!win.isFullScreen())
    case 'devtools':
      return contents.toggleDevTools()
    case 'reload':
      return contents.reload()
    default:
      contents.send('menu:command', action)
  }
}

function onFocused(action: Action) {
  return () => {
    const contents = BrowserWindow.getFocusedWindow()?.webContents
    if (contents) run(action, contents)
  }
}

const KEY_NAMES: Record<string, string> = { right: 'arrowright', left: 'arrowleft', plus: '+' }

function matches(input: Input, combo: string): boolean {
  const parts = combo.toLowerCase().split('+')
  // "Ctrl+=" splits into ["ctrl", "="]; "Ctrl+-" into ["ctrl", "-"].
  const key = parts.pop() || '+'
  const wanted = { ctrl: parts.includes('ctrl'), shift: parts.includes('shift'), alt: parts.includes('alt') }
  if (input.control !== wanted.ctrl || input.alt !== wanted.alt || input.meta) return false
  const pressed = input.key.toLowerCase()
  // Shift changes the produced character for symbols ("=" → "+"), so only letters/named keys check it strictly.
  if (/^[a-z]$|^f\d+$|^tab$|^right$|^left$/.test(key) && input.shift !== wanted.shift) return false
  return pressed === (KEY_NAMES[key] ?? key)
}

/**
 * Linux/Windows use a frameless window (custom title bar), where menu accelerators are unreliable:
 * shortcuts are matched here, before the page sees the key, so they work everywhere in the app.
 */
export function installShortcutHandler(contents: WebContents, isDev: boolean): void {
  if (isMac) return
  contents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return
    const shortcut = SHORTCUTS.find((s) => (!s.devOnly || isDev) && matches(input, s.other))
    if (!shortcut) return
    event.preventDefault()
    run(shortcut.action, contents)
  })
}

export function installAppMenu(isDev: boolean): void {
  const item = (label: string, action: Action): MenuItemConstructorOptions => ({
    label,
    accelerator: accelerator(action),
    click: onFocused(action)
  })
  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: 'appMenu' as const }] : []),
    {
      label: 'Fichier',
      submenu: [
        item('Ajouter un projet…', 'add-project'),
        { type: 'separator' },
        item('Nouvel onglet', 'new-terminal'),
        item('Fermer le terminal', 'close-terminal'),
        { type: 'separator' },
        item('Diviser à droite', 'split-right'),
        item('Diviser en bas', 'split-down'),
        { type: 'separator' },
        isMac ? { role: 'close', accelerator: 'Cmd+Shift+W' } : item('Quitter', 'quit')
      ]
    },
    {
      label: 'Édition',
      // macOS: native roles (they also serve dialogs and DevTools); elsewhere, our handler.
      submenu: isMac
        ? [{ role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }]
        : [item('Copier', 'copy'), item('Coller', 'paste'), item('Tout sélectionner', 'selectAll')]
    },
    {
      label: 'Terminal',
      submenu: [
        item('Onglet suivant', 'next-terminal'),
        item('Onglet précédent', 'prev-terminal'),
        { type: 'separator' },
        item('Panneau suivant', 'next-pane'),
        item('Panneau précédent', 'prev-pane')
      ]
    },
    {
      label: 'Affichage',
      submenu: [
        item('Barre latérale', 'toggle-sidebar'),
        item('Panneau de droite', 'toggle-explorer'),
        { type: 'separator' },
        item('Taille réelle', 'resetZoom'),
        item('Zoom avant', 'zoomIn'),
        item('Zoom arrière', 'zoomOut'),
        { type: 'separator' },
        item('Plein écran', 'fullscreen'),
        ...(isDev ? [{ type: 'separator' as const }, item('Recharger', 'reload'), item('Outils de développement', 'devtools')] : [])
      ]
    },
    ...(isMac ? [{ role: 'windowMenu' as const }] : [])
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

/** The ⋯ button of the custom title bar (Linux/Windows): the same menu, as a popup. */
export function popupAppMenu(win: BrowserWindow, x: number, y: number): void {
  Menu.getApplicationMenu()?.popup({ window: win, x: Math.round(x), y: Math.round(y) })
}
