import { contextBridge, ipcRenderer, webUtils, type IpcRendererEvent } from 'electron'
import type { CapitaineApi, MenuCommand, UpdateState } from '../shared/types'

function subscribe<Args extends unknown[]>(channel: string, listener: (...args: Args) => void): () => void {
  const handler = (_event: IpcRendererEvent, ...args: unknown[]) => listener(...(args as Args))
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

const api: CapitaineApi = {
  platform: process.platform,
  projects: {
    list: () => ipcRenderer.invoke('projects:list'),
    add: () => ipcRenderer.invoke('projects:add'),
    rename: (id, name) => ipcRenderer.invoke('projects:rename', id, name),
    remove: (id) => ipcRenderer.invoke('projects:remove', id),
    reorder: (ids) => ipcRenderer.invoke('projects:reorder', ids),
    reveal: (id) => ipcRenderer.invoke('projects:reveal', id)
  },
  pty: {
    create: (options) => ipcRenderer.invoke('pty:create', options),
    write: (id, data) => ipcRenderer.send('pty:write', id, data),
    resize: (id, cols, rows) => ipcRenderer.send('pty:resize', id, cols, rows),
    kill: (id) => ipcRenderer.send('pty:kill', id),
    onData: (listener) => subscribe<[string, string]>('pty:data', listener),
    onExit: (listener) => subscribe<[string, number]>('pty:exit', listener),
    onProcess: (listener) => subscribe<[string, string]>('pty:process', listener)
  },
  session: {
    load: () => ipcRenderer.invoke('session:load'),
    save: (input) => ipcRenderer.send('session:save', input),
    saveNow: (input) => {
      ipcRenderer.sendSync('session:save-sync', input)
    }
  },
  files: {
    list: (projectId, dir) => ipcRenderer.invoke('files:list', projectId, dir),
    all: (projectId) => ipcRenderer.invoke('files:all', projectId),
    watch: (projectId, dir) => ipcRenderer.send('files:watch', projectId, dir),
    unwatch: (dir) => ipcRenderer.send('files:unwatch', dir),
    onChanged: (listener) => subscribe<[string]>('fs:changed', listener),
    gitStatus: (projectId) => ipcRenderer.invoke('files:git-status', projectId),
    read: (projectId, path) => ipcRenderer.invoke('files:read', projectId, path),
    write: (projectId, path, content) => ipcRenderer.invoke('files:write', projectId, path, content),
    open: (projectId, path) => ipcRenderer.invoke('files:open', projectId, path),
    reveal: (projectId, path) => ipcRenderer.send('files:reveal', projectId, path),
    copyText: (text) => ipcRenderer.send('clipboard:write', text),
    pathForFile: (file) => webUtils.getPathForFile(file)
  },
  git: {
    status: (projectId) => ipcRenderer.invoke('git:status', projectId),
    stage: (projectId, paths) => ipcRenderer.invoke('git:stage', projectId, paths),
    unstage: (projectId, paths) => ipcRenderer.invoke('git:unstage', projectId, paths),
    stashes: (projectId) => ipcRenderer.invoke('git:stashes', projectId),
    stashFiles: (projectId, ref) => ipcRenderer.invoke('git:stash-files', projectId, ref),
    show: (projectId, side) => ipcRenderer.invoke('git:show', projectId, side),
    branch: (projectId) => ipcRenderer.invoke('git:branch', projectId),
    branches: (projectId) => ipcRenderer.invoke('git:branches', projectId),
    switchBranch: (projectId, name) => ipcRenderer.invoke('git:switch', projectId, name),
    createBranch: (projectId, name, from) => ipcRenderer.invoke('git:create-branch', projectId, name, from),
    commit: (projectId, options) => ipcRenderer.invoke('git:commit', projectId, options),
    push: (projectId) => ipcRenderer.invoke('git:push', projectId),
    pull: (projectId) => ipcRenderer.invoke('git:pull', projectId),
    fetch: (projectId) => ipcRenderer.invoke('git:fetch', projectId),
    finishOperation: (projectId, how) => ipcRenderer.invoke('git:finish-operation', projectId, how),
    takeSide: (projectId, path, side) => ipcRenderer.invoke('git:take-side', projectId, path, side),
    writeResolution: (projectId, path, content) => ipcRenderer.invoke('git:write-resolution', projectId, path, content),
    ai: {
      commitMessage: (projectId, all) => ipcRenderer.invoke('git:ai-commit-message', projectId, all),
      resolveConflict: (projectId, path) => ipcRenderer.invoke('git:ai-resolve', projectId, path)
    }
  },
  claude: {
    usage: (force) => ipcRenderer.invoke('claude:usage', force)
  },
  window: {
    customTitleBar: process.platform !== 'darwin',
    minimize: () => ipcRenderer.send('window:minimize'),
    toggleMaximize: () => ipcRenderer.send('window:toggle-maximize'),
    close: () => ipcRenderer.send('window:close'),
    isMaximized: () => ipcRenderer.invoke('window:is-maximized'),
    onMaximizedChange: (listener) => subscribe<[boolean]>('window:maximized', listener),
    popupMenu: (x, y) => ipcRenderer.send('window:popup-menu', x, y)
  },
  updater: {
    state: () => ipcRenderer.invoke('updater:state'),
    check: () => ipcRenderer.send('updater:check'),
    download: () => ipcRenderer.send('updater:download'),
    install: () => ipcRenderer.send('updater:install'),
    openReleases: (version) => ipcRenderer.send('updater:open-releases', version),
    onState: (listener) => subscribe<[UpdateState]>('updater:state', listener)
  },
  focusWindow: () => ipcRenderer.send('window:focus'),
  confirmClose: () => ipcRenderer.send('window:close-confirmed'),
  cancelClose: () => ipcRenderer.send('window:close-cancelled'),
  onMenuCommand: (listener) => subscribe<[MenuCommand]>('menu:command', listener)
}

contextBridge.exposeInMainWorld('capitaine', api)
