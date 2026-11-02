import { useEditors } from '../editor-store'
import { monaco } from './monaco-setup'

/** Parent directory, keeping the platform's separator (it must match what the watcher reports). */
function parentDir(path: string): string {
  const cut = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return cut > 0 ? path.slice(0, cut) : path
}

/**
 * One open file: its Monaco model, what's on disk, and whether they differ.
 * Outside edits (an agent rewriting the file) reload silently when you have no unsaved changes.
 */
class EditorSession {
  model: monaco.editor.ITextModel | null = null
  /** Disk content the buffer was last in sync with. */
  private savedContent = ''
  /** Model version matching `savedContent`; undoing back to it clears the dirty flag. */
  private savedVersion = 0
  /** Disk content seen while the buffer was dirty, offered by the conflict banner. */
  private pendingDisk: string | null = null
  private readonly disposers: (() => void)[] = []
  private checking: Promise<void> | null = null

  constructor(
    readonly tabId: string,
    readonly projectId: string,
    readonly path: string
  ) {}

  private meta(patch: Parameters<ReturnType<typeof useEditors.getState>['setMeta']>[1]) {
    useEditors.getState().setMeta(this.tabId, patch)
  }

  async load(): Promise<void> {
    this.meta({ status: 'loading' })
    let file
    try {
      file = await window.capitaine.files.read(this.projectId, this.path)
    } catch (error) {
      this.meta({ status: 'error', error: error instanceof Error ? error.message : String(error) })
      return
    }
    if (file.kind !== 'text') {
      this.meta({ status: file.kind })
      return
    }
    const uri = monaco.Uri.file(this.path)
    monaco.editor.getModel(uri)?.dispose()
    // No explicit language: Monaco picks it from the file name.
    this.model = monaco.editor.createModel(file.content, undefined, uri)
    this.markSaved(file.content)
    const sub = this.model.onDidChangeContent(() => this.syncDirty())
    this.disposers.push(() => sub.dispose())
    this.watchDisk()
    this.meta({ status: 'ready', dirty: false, external: null, error: null })
  }

  get dirty(): boolean {
    return !!this.model && this.model.getAlternativeVersionId() !== this.savedVersion
  }

  private markSaved(content: string) {
    this.savedContent = content
    this.savedVersion = this.model?.getAlternativeVersionId() ?? 0
    this.pendingDisk = null
    this.syncDirty()
  }

  private syncDirty() {
    const dirty = this.dirty
    if (useEditors.getState().meta[this.tabId]?.dirty !== dirty) this.meta({ dirty })
  }

  async save(): Promise<void> {
    if (!this.model) return
    const content = this.model.getValue()
    await window.capitaine.files.write(this.projectId, this.path, content)
    this.markSaved(content)
    this.meta({ external: null })
  }

  /** Replaces the buffer as an edit, so Ctrl+Z can still go back to what you had. */
  private replaceContent(text: string) {
    if (!this.model) return
    this.model.pushStackElement()
    this.model.pushEditOperations([], [{ range: this.model.getFullModelRange(), text }], () => null)
    this.model.pushStackElement()
  }

  private watchDisk() {
    const dir = parentDir(this.path)
    window.capitaine.files.watch(this.projectId, dir)
    const off = window.capitaine.files.onChanged((changed) => {
      if (changed === dir) void this.checkDisk()
    })
    this.disposers.push(off, () => window.capitaine.files.unwatch(dir))
  }

  checkDisk(): Promise<void> {
    // Serialized: a burst of change events must not interleave reads.
    this.checking ??= this.readDisk().finally(() => {
      this.checking = null
    })
    return this.checking
  }

  private async readDisk() {
    if (!this.model) return
    const file = await window.capitaine.files.read(this.projectId, this.path).catch(() => null)
    if (!file) return
    if (file.kind === 'missing') {
      this.meta({ external: 'deleted' })
      return
    }
    if (file.kind !== 'text') return
    const external = useEditors.getState().meta[this.tabId]?.external
    if (file.content === this.savedContent) {
      if (external === 'deleted') this.meta({ external: null })
      return
    }
    if (this.dirty) {
      this.pendingDisk = file.content
      this.meta({ external: 'changed' })
      return
    }
    this.replaceContent(file.content)
    this.markSaved(file.content)
    this.meta({ external: null, reloadedAt: Date.now() })
  }

  /** Conflict banner: take the disk version (still undoable). */
  async reloadFromDisk() {
    const file = await window.capitaine.files.read(this.projectId, this.path)
    if (file.kind !== 'text') return
    this.replaceContent(file.content)
    this.markSaved(file.content)
    this.meta({ external: null })
  }

  /** Conflict banner: keep the buffer; the next save overwrites the disk version. */
  keepMine() {
    if (this.pendingDisk !== null) this.savedContent = this.pendingDisk
    this.pendingDisk = null
    this.meta({ external: null })
  }

  dispose() {
    for (const dispose of this.disposers.splice(0)) dispose()
    this.model?.dispose()
    this.model = null
    useEditors.getState().removeMeta(this.tabId)
  }
}

const sessions = new Map<string, EditorSession>()

export function openSession(tabId: string, projectId: string, path: string): EditorSession {
  let session = sessions.get(tabId)
  if (!session) {
    session = new EditorSession(tabId, projectId, path)
    sessions.set(tabId, session)
  }
  return session
}

export function getSession(tabId: string): EditorSession | undefined {
  return sessions.get(tabId)
}

export function closeSession(tabId: string) {
  sessions.get(tabId)?.dispose()
  sessions.delete(tabId)
}

export async function saveSession(tabId: string) {
  await sessions.get(tabId)?.save()
}

export type { EditorSession }
