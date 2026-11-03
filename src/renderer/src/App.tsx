import { useEffect } from 'react'
import { CloseEditorDialog } from './components/CloseEditorDialog'
import { RightPanel } from './components/RightPanel'
import { UsageFooter } from './components/UsageFooter'
import { WindowControls } from './components/TitleBar'
import { UpdateCard } from './components/UpdateCard'
import { useEditors } from './editor-store'
import { Sidebar } from './components/Sidebar'
import { useExplorer } from './explorer-store'
import { Workspace } from './components/Workspace'
import { startAgentNotifications } from './agent-notifications'
import { restoreSession, startSessionPersistence } from './session'
import { useApp } from './store'

export function App() {
  const explorerOpen = useExplorer((s) => s.open)
  const sidebarOpen = useExplorer((s) => s.sidebarOpen)
  const activeProject = useApp((s) => s.projects.find((p) => p.id === s.activeProjectId))

  useEffect(() => startAgentNotifications(), [])

  useEffect(() => {
    let cancelled = false
    let stopPersistence = () => {}
    useApp
      .getState()
      .loadProjects()
      .then(restoreSession)
      .catch((error: unknown) => console.error('[capitaine] failed to restore the session', error))
      .finally(() => {
        if (!cancelled) stopPersistence = startSessionPersistence()
      })
    return () => {
      cancelled = true
      stopPersistence()
    }
  }, [])

  useEffect(() => {
    return window.capitaine.onMenuCommand((command) => {
      const app = useApp.getState()
      switch (command) {
        case 'new-terminal':
          return app.newTab()
        case 'close-terminal': {
          const tab = app.activeProjectId ? app.tabs[app.activeTabByProject[app.activeProjectId] ?? ''] : undefined
          if (tab?.kind === 'editor') return useEditors.getState().requestClose(tab.id)
          if (tab?.kind === 'diff') return app.closeTab(tab.id)
          return app.closeActivePane()
        }
        case 'next-terminal':
          return app.cycleTab(1)
        case 'prev-terminal':
          return app.cycleTab(-1)
        case 'split-right':
          return app.splitActivePane('row')
        case 'split-down':
          return app.splitActivePane('column')
        case 'next-pane':
          return app.cyclePane(1)
        case 'prev-pane':
          return app.cyclePane(-1)
        case 'toggle-explorer':
          return useExplorer.getState().toggleOpen()
        case 'find-file':
          return useExplorer.getState().focusSearch()
        case 'toggle-sidebar':
          return useExplorer.getState().toggleSidebar()
        case 'add-project':
          return void app.addProject()
      }
    })
  }, [])

  return (
    <div className="flex h-full flex-col">
      <div className="flex min-h-0 flex-1">
        {sidebarOpen && <Sidebar />}
        <Workspace />
        {explorerOpen && activeProject && <RightPanel key={activeProject.id} project={activeProject} />}
      </div>
      <UsageFooter />
      <UpdateCard />
      <WindowControls />
      <CloseEditorDialog />
    </div>
  )
}
