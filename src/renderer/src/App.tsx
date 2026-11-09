import { useEffect } from 'react'
import { ClaudeConfigPage } from '@/features/claude/ClaudeConfigPage'
import { CloseEditorDialog } from '@/features/editor/CloseEditorDialog'
import { DockerPage } from '@/features/docker/DockerPage'
import { RightPanel } from '@/app/RightPanel'
import { UsageFooter } from '@/features/claude/UsageFooter'
import { WindowControls } from '@/app/TitleBar'
import { UpdateCard } from '@/features/updates/UpdateCard'
import { useEditors } from '@/features/editor/editor-store'
import { Sidebar } from '@/features/projects/Sidebar'
import { usePanels } from '@/app/panels-store'
import { useExplorer } from '@/features/files/explorer-store'
import { Workspace } from '@/features/workspace/Workspace'
import { startAgentNotifications } from '@/features/claude/agent-notifications'
import { restoreSession, startSessionPersistence } from '@/features/workspace/session'
import { useApp } from '@/features/workspace/workspace-store'

export function App() {
  const explorerOpen = usePanels((s) => s.rightOpen)
  const sidebarOpen = usePanels((s) => s.sidebarOpen)
  const page = usePanels((s) => s.page)
  const activeProject = useApp((s) => s.projects.find((p) => p.id === s.activeProjectId))

  useEffect(() => startAgentNotifications(), [])

  // Opening or switching a tab (new terminal, file search…) brings the terminals back.
  useEffect(
    () =>
      useApp.subscribe((state, prev) => {
        if (state.activeTabByProject !== prev.activeTabByProject) usePanels.getState().setPage(null)
      }),
    []
  )

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
          return usePanels.getState().toggleRight()
        case 'find-file':
          return useExplorer.getState().focusSearch()
        case 'toggle-sidebar':
          return usePanels.getState().toggleSidebar()
        case 'add-project':
          return void app.addProject()
      }
    })
  }, [])

  return (
    <div className="flex h-full flex-col">
      <div className="flex min-h-0 flex-1">
        {sidebarOpen && <Sidebar />}
        {/* Pages cover the terminals without unmounting them (they keep their scrollback). */}
        <div className="relative flex min-w-0 flex-1">
          <Workspace />
          {/* Siblings: their keys must differ, or React mixes them up and leaves stale panels behind. */}
          {explorerOpen && activeProject && <RightPanel key={`panel:${activeProject.id}`} project={activeProject} />}
          {page === 'claude' && activeProject && <ClaudeConfigPage key={`claude:${activeProject.id}`} project={activeProject} />}
          {page === 'docker' && activeProject && <DockerPage project={activeProject} />}
        </div>
      </div>
      <UsageFooter />
      <UpdateCard />
      <WindowControls />
      <CloseEditorDialog />
    </div>
  )
}
