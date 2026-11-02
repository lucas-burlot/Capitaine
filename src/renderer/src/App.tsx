import { useEffect } from 'react'
import { CloseEditorDialog } from './components/CloseEditorDialog'
import { FileExplorer } from './components/FileExplorer'
import { useEditors } from './editor-store'
import { Sidebar } from './components/Sidebar'
import { useExplorer } from './explorer-store'
import { Workspace } from './components/Workspace'
import { startAgentNotifications } from './agent-notifications'
import { useApp } from './store'

export function App() {
  const explorerOpen = useExplorer((s) => s.open)
  const activeProject = useApp((s) => s.projects.find((p) => p.id === s.activeProjectId))

  useEffect(() => startAgentNotifications(), [])

  useEffect(() => {
    void useApp.getState().loadProjects()
    return window.capitaine.onMenuCommand((command) => {
      const app = useApp.getState()
      switch (command) {
        case 'new-terminal':
          return app.newTab()
        case 'close-terminal': {
          const tab = app.activeProjectId ? app.tabs[app.activeTabByProject[app.activeProjectId] ?? ''] : undefined
          if (tab?.kind === 'editor') return useEditors.getState().requestClose(tab.id)
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
        case 'add-project':
          return void app.addProject()
      }
    })
  }, [])

  return (
    <div className="flex h-full">
      <Sidebar />
      <Workspace />
      {explorerOpen && activeProject && <FileExplorer key={activeProject.id} project={activeProject} />}
      <CloseEditorDialog />
    </div>
  )
}
