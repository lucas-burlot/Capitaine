import { ArrowRightToLine, Copy, CopyX, FileX, Pencil, SquareX, X } from 'lucide-react'
import { useEditors } from '@/features/editor/editor-store'
import { ContextMenu, MenuItem, MenuSeparator } from '@/ui/ContextMenu'
import { paneIds } from './layout'
import { useApp, type Tab } from './workspace-store'

interface Props {
  tab: Tab
  x: number
  y: number
  onClose(): void
  /** Starts renaming the tab in place (terminal tabs). */
  onRename(): void
}

/**
 * A tab's right-click menu: close it, the others, those to its right, every file, or all, as in a
 * browser or an editor. Closing several at once leaves alone the tabs where Claude is working or
 * waiting for an answer (closing one by one still does); unsaved files are asked about together.
 */
export function TabMenu({ tab, x, y, onClose, onRename }: Props) {
  const order = useApp((s) => s.tabOrder[tab.projectId] ?? [])
  const tabs = useApp((s) => s.tabs)
  const agents = useApp((s) => s.agents)
  const projectPath = useApp((s) => s.projects.find((p) => p.id === tab.projectId)?.path ?? null)

  const busy = (id: string) => {
    const other = tabs[id]
    if (other?.kind !== 'terminal') return false
    return paneIds(other.layout).some((paneId) => agents[paneId]?.state === 'working' || agents[paneId]?.state === 'blocked')
  }
  const index = order.indexOf(tab.id)
  const groups = {
    others: order.filter((id) => id !== tab.id),
    right: index === -1 ? [] : order.slice(index + 1),
    files: order.filter((id) => tabs[id] && tabs[id].kind !== 'terminal'),
    all: order
  }

  const close = (ids: string[]) => () => {
    // The tab that was right-clicked comes forward when it stays, as in a browser.
    if (!ids.includes(tab.id)) useApp.getState().selectTab(tab.id)
    useEditors.getState().requestCloseTabs(ids)
    onClose()
  }
  /** Closes the group, minus the busy agents; says how many stay open. */
  const bulk = (ids: string[], icon: React.ReactNode, label: string) => {
    const closing = ids.filter((id) => !busy(id))
    const kept = ids.length - closing.length
    const hint = kept > 0 ? `garde ${kept} agent${kept > 1 ? 's' : ''} actif${kept > 1 ? 's' : ''}` : undefined
    return <MenuItem icon={icon} label={label} hint={hint} disabled={closing.length === 0} onClick={close(closing)} />
  }

  const relative = tab.filePath && projectPath ? relativeTo(projectPath, tab.filePath) : null
  const copy = (text: string) => () => {
    window.capitaine.files.copyText(text)
    onClose()
  }

  return (
    <ContextMenu x={x} y={y} onClose={onClose}>
      <MenuItem icon={<X size={13} />} label="Fermer" onClick={close([tab.id])} />
      {bulk(groups.others, <SquareX size={13} />, 'Fermer les autres')}
      {bulk(groups.right, <ArrowRightToLine size={13} />, 'Fermer les onglets à droite')}
      {bulk(groups.files, <FileX size={13} />, 'Fermer tous les fichiers')}
      {bulk(groups.all, <CopyX size={13} />, 'Tout fermer')}
      {(tab.kind === 'terminal' || tab.filePath) && <MenuSeparator />}
      {tab.kind === 'terminal' && (
        <MenuItem
          icon={<Pencil size={13} />}
          label="Renommer"
          onClick={() => {
            onClose()
            onRename()
          }}
        />
      )}
      {tab.filePath && <MenuItem icon={<Copy size={13} />} label="Copier le chemin" onClick={copy(tab.filePath)} />}
      {relative && <MenuItem icon={<Copy size={13} />} label="Copier le chemin relatif" onClick={copy(relative)} />}
    </ContextMenu>
  )
}

/** `path` relative to `root`, or null when it's outside. */
function relativeTo(root: string, path: string): string | null {
  const base = root.replace(/[\\/]+$/, '')
  if (!path.startsWith(base) || !/[\\/]/.test(path.charAt(base.length))) return null
  return path.slice(base.length + 1)
}
