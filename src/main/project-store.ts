import { app } from 'electron'
import { randomUUID } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import type { Project } from '../shared/types'

interface StoreFile {
  version: 1
  projects: Project[]
}

/** Persists the project list as JSON in the per-user app data folder. */
export class ProjectStore {
  private readonly file = join(app.getPath('userData'), 'projects.json')
  private projects: Project[] = []

  constructor() {
    this.load()
  }

  list(): Project[] {
    return this.projects
  }

  get(id: string): Project | undefined {
    return this.projects.find((p) => p.id === id)
  }

  add(path: string): Project {
    const existing = this.projects.find((p) => p.path === path)
    if (existing) return existing
    const project: Project = { id: randomUUID(), name: basename(path) || path, path, createdAt: Date.now() }
    this.projects = [...this.projects, project]
    this.save()
    return project
  }

  rename(id: string, name: string): Project[] {
    const trimmed = name.trim()
    if (!trimmed) return this.projects
    this.projects = this.projects.map((p) => (p.id === id ? { ...p, name: trimmed } : p))
    this.save()
    return this.projects
  }

  remove(id: string): Project[] {
    this.projects = this.projects.filter((p) => p.id !== id)
    this.save()
    return this.projects
  }

  reorder(ids: string[]): Project[] {
    const byId = new Map(this.projects.map((p) => [p.id, p]))
    const ordered = ids.map((id) => byId.get(id)).filter((p): p is Project => !!p)
    const rest = this.projects.filter((p) => !ids.includes(p.id))
    this.projects = [...ordered, ...rest]
    this.save()
    return this.projects
  }

  private load(): void {
    try {
      this.migrateFromAtelier()
      if (!existsSync(this.file)) return
      const data = JSON.parse(readFileSync(this.file, 'utf8')) as StoreFile
      this.projects = Array.isArray(data.projects) ? data.projects : []
    } catch (error) {
      console.error('[capitaine] failed to read projects.json', error)
    }
  }

  /** The app was called "Atelier" before; carry its project list over once. */
  private migrateFromAtelier(): void {
    const legacy = join(app.getPath('appData'), 'Atelier', 'projects.json')
    if (existsSync(this.file) || !existsSync(legacy)) return
    mkdirSync(app.getPath('userData'), { recursive: true })
    copyFileSync(legacy, this.file)
  }

  private save(): void {
    mkdirSync(app.getPath('userData'), { recursive: true })
    const data: StoreFile = { version: 1, projects: this.projects }
    // Write-then-rename so a crash mid-write never corrupts the file.
    const tmp = `${this.file}.tmp`
    writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf8')
    renameSync(tmp, this.file)
  }
}
