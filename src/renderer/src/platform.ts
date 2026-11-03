export const isMac = window.capitaine.platform === 'darwin'
export const isWindows = window.capitaine.platform === 'win32'

const labels = {
  newTerminal: isMac ? '⌘T' : 'Ctrl+Shift+T',
  closeTerminal: isMac ? '⌘W' : 'Ctrl+Shift+W',
  addProject: isMac ? '⌘O' : 'Ctrl+Shift+O',
  nextTerminal: isMac ? '⌘⇧]' : 'Ctrl+Tab',
  splitRight: isMac ? '⌘D' : 'Ctrl+Shift+D',
  splitDown: isMac ? '⌘⇧D' : 'Ctrl+Shift+E',
  nextPane: isMac ? '⌘⌥→' : 'Ctrl+Alt+→',
  toggleExplorer: isMac ? '⌘B' : 'Ctrl+Shift+B',
  toggleSidebar: isMac ? '⌘⇧S' : 'Ctrl+Shift+S'
}

export function shortcutLabel(action: keyof typeof labels): string {
  return labels[action]
}
