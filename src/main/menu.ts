import { BrowserWindow, Menu, type MenuItemConstructorOptions } from 'electron'
import type { MenuCommand } from '../shared/types'

const isMac = process.platform === 'darwin'

function send(command: MenuCommand) {
  return () => BrowserWindow.getFocusedWindow()?.webContents.send('menu:command', command)
}

/**
 * On Linux/Windows the terminal owns Ctrl+<letter> (Ctrl+C, Ctrl+W, Ctrl+T…),
 * so app shortcuts use Ctrl+Shift there, like most terminal emulators.
 */
const keys = {
  newTerminal: isMac ? 'Cmd+T' : 'Ctrl+Shift+T',
  closeTerminal: isMac ? 'Cmd+W' : 'Ctrl+Shift+W',
  nextTerminal: isMac ? 'Cmd+Shift+]' : 'Ctrl+Tab',
  prevTerminal: isMac ? 'Cmd+Shift+[' : 'Ctrl+Shift+Tab',
  splitRight: isMac ? 'Cmd+D' : 'Ctrl+Shift+D',
  splitDown: isMac ? 'Cmd+Shift+D' : 'Ctrl+Shift+E',
  nextPane: isMac ? 'Cmd+Alt+Right' : 'Ctrl+Alt+Right',
  prevPane: isMac ? 'Cmd+Alt+Left' : 'Ctrl+Alt+Left',
  addProject: isMac ? 'Cmd+O' : 'Ctrl+Shift+O',
  toggleExplorer: isMac ? 'Cmd+B' : 'Ctrl+Shift+B',
  copy: isMac ? 'Cmd+C' : 'Ctrl+Shift+C',
  paste: isMac ? 'Cmd+V' : 'Ctrl+Shift+V'
}

export function installAppMenu(isDev: boolean): void {
  const template: MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: 'appMenu' as const }] : []),
    {
      label: 'Fichier',
      submenu: [
        { label: 'Ajouter un projet…', accelerator: keys.addProject, click: send('add-project') },
        { type: 'separator' },
        { label: 'Nouvel onglet', accelerator: keys.newTerminal, click: send('new-terminal') },
        { label: 'Fermer le terminal', accelerator: keys.closeTerminal, click: send('close-terminal') },
        { type: 'separator' },
        { label: 'Diviser à droite', accelerator: keys.splitRight, click: send('split-right') },
        { label: 'Diviser en bas', accelerator: keys.splitDown, click: send('split-down') },
        { type: 'separator' },
        isMac ? { role: 'close', accelerator: 'Cmd+Shift+W' } : { role: 'quit', accelerator: 'Ctrl+Q' }
      ]
    },
    {
      label: 'Édition',
      submenu: [
        { role: 'copy', accelerator: keys.copy },
        { role: 'paste', accelerator: keys.paste },
        { role: 'selectAll', accelerator: isMac ? 'Cmd+A' : 'Ctrl+Shift+A' }
      ]
    },
    {
      label: 'Terminal',
      submenu: [
        { label: 'Onglet suivant', accelerator: keys.nextTerminal, click: send('next-terminal') },
        { label: 'Onglet précédent', accelerator: keys.prevTerminal, click: send('prev-terminal') },
        { type: 'separator' },
        { label: 'Panneau suivant', accelerator: keys.nextPane, click: send('next-pane') },
        { label: 'Panneau précédent', accelerator: keys.prevPane, click: send('prev-pane') }
      ]
    },
    {
      label: 'Affichage',
      submenu: [
        { label: 'Explorateur de fichiers', accelerator: keys.toggleExplorer, click: send('toggle-explorer') },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
        ...(isDev ? [{ type: 'separator' as const }, { role: 'reload' as const }, { role: 'toggleDevTools' as const }] : [])
      ]
    },
    { role: 'windowMenu' }
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}
