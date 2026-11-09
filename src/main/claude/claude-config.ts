import { homedir } from 'node:os'
import { open, readdir, readFile, stat } from 'node:fs/promises'
import { basename, dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { ClaudeConfig, ClaudeConfigItem, ClaudeConfigKind, ClaudeConfigScope } from '../../shared/types'
import { isInside } from '../system/paths'
import { claudeConfigDir } from './claude-sessions'

/** Folders nested deeper than this under agents/, commands/ or rules/ are not looked at. */
const MAX_DEPTH = 4
/** Front matter and the first lines are all we need from a file. */
const HEAD_BYTES = 16 * 1024
const MAX_DESCRIPTION = 2000
/** Front matter fields already carried by their own property. */
const SHOWN_KEYS = new Set(['name', 'description', 'paths', 'globs'])

interface Source {
  scope: ClaudeConfigScope
  plugin: string | null
  disabled: boolean
}

/** Front matter values: plain strings, or lists (`paths: [a, b]` or `- a` lines). */
type FrontMatter = Record<string, string | string[]>

/**
 * Every Claude Code configuration file that applies to a project: the user's own (~/.claude),
 * the project's (.claude/ and CLAUDE.md), and those of the plugins installed for it.
 * `projectRoot` null lists the user's files only.
 */
export async function listClaudeConfig(projectRoot: string | null): Promise<ClaudeConfig> {
  const userDir = claudeConfigDir()
  const user: Source = { scope: 'user', plugin: null, disabled: false }
  const project: Source = { scope: 'project', plugin: null, disabled: false }

  const tasks: Promise<ClaudeConfigItem[]>[] = [scanConfigDir(userDir, user, true), memoryFiles([[join(userDir, 'CLAUDE.md'), 'CLAUDE.md']], user)]
  if (projectRoot) {
    tasks.push(
      scanConfigDir(join(projectRoot, '.claude'), project, true),
      memoryFiles(
        [
          [join(projectRoot, 'CLAUDE.md'), 'CLAUDE.md'],
          [join(projectRoot, '.claude', 'CLAUDE.md'), '.claude/CLAUDE.md'],
          [join(projectRoot, 'CLAUDE.local.md'), 'CLAUDE.local.md']
        ],
        project
      )
    )
  }
  for (const plugin of await installedPlugins(userDir, projectRoot)) tasks.push(scanPlugin(plugin))

  const items = (await Promise.all(tasks)).flat()
  remember(items)
  return { items: dedupe(items), userDir, homeDir: homedir() }
}

/** The same file can be reached twice (a symlink, an import listed as memory too). */
function dedupe(items: ClaudeConfigItem[]): ClaudeConfigItem[] {
  const seen = new Set<string>()
  return items.filter((item) => {
    const key = `${item.kind}:${item.path}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

// ---------------------------------------------------------------------------------------------
// Access control: the renderer may open these files in the editor even outside the project.

const knownFiles = new Set<string>()

function remember(items: ClaudeConfigItem[]) {
  for (const item of items) knownFiles.add(item.path)
}

/**
 * True when `path` is a configuration file listed for this project (or its folder, for the
 * editor's watcher). Rescans once when unknown: an editor tab can be restored before the panel ran.
 */
export async function isClaudeConfigPath(projectRoot: string | null, path: string, asDirectory = false): Promise<boolean> {
  const known = () => [...knownFiles].some((file) => (asDirectory ? dirname(file) === path : file === path))
  if (known()) return true
  await listClaudeConfig(projectRoot).catch(() => null)
  return known()
}

// ---------------------------------------------------------------------------------------------
// Scanning

/** skills/, agents/, commands/ and (outside plugins) rules/ of a `.claude` folder or a plugin. */
async function scanConfigDir(base: string, source: Source, withRules: boolean): Promise<ClaudeConfigItem[]> {
  const tasks = [skillsIn(join(base, 'skills'), source), markdownIn(join(base, 'agents'), 'agent', source), markdownIn(join(base, 'commands'), 'command', source)]
  if (withRules) tasks.push(markdownIn(join(base, 'rules'), 'rule', source))
  return (await Promise.all(tasks)).flat()
}

/** `skills/<name>/SKILL.md`. */
async function skillsIn(dir: string, source: Source): Promise<ClaudeConfigItem[]> {
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  const found = await Promise.all(
    entries.map(async (entry) => {
      const path = join(dir, entry.name, 'SKILL.md')
      if (!(await isFile(path))) return null
      return toItem('skill', path, entry.name, source)
    })
  )
  return found.filter((item): item is ClaudeConfigItem => !!item)
}

/** Every `.md` below `dir`; a file in a subfolder is named `folder:file`. */
async function markdownIn(dir: string, kind: ClaudeConfigKind, source: Source): Promise<ClaudeConfigItem[]> {
  const files = await walkMarkdown(dir, 0)
  const items = await Promise.all(
    files.map(async (path) => {
      const name = relative(dir, path).slice(0, -'.md'.length).split(sep).join(':')
      const text = (await readText(path)) ?? ''
      // An agent is defined by its front matter; a README.md next to the agents is not one.
      if (kind === 'agent' && Object.keys(parseFrontMatter(text).data).length === 0) return null
      return describe(kind, path, name, source, text)
    })
  )
  return items.filter((item): item is ClaudeConfigItem => !!item)
}

async function walkMarkdown(dir: string, depth: number): Promise<string[]> {
  if (depth > MAX_DEPTH) return []
  const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
  const nested = await Promise.all(
    entries.map(async (entry) => {
      const path = join(dir, entry.name)
      if (entry.name.startsWith('.')) return []
      const isDir = entry.isDirectory() || (entry.isSymbolicLink() && (await stat(path).then((s) => s.isDirectory(), () => false)))
      if (isDir) return walkMarkdown(path, depth + 1)
      return entry.name.toLowerCase().endsWith('.md') ? [path] : []
    })
  )
  return nested.flat()
}

/** CLAUDE.md files that exist (`[path, label]`), plus the Markdown files they import (`@path`), one level deep. */
async function memoryFiles(candidates: [string, string][], source: Source): Promise<ClaudeConfigItem[]> {
  const items: ClaudeConfigItem[] = []
  for (const [path, label] of candidates) {
    const text = await readText(path)
    if (text === null) continue
    items.push(describe('memory', path, label, source, text))
    for (const imported of importsOf(text, dirname(path))) {
      const importedText = await readText(imported)
      if (importedText === null) continue
      const rel = relative(dirname(path), imported)
      const name = rel.startsWith('..') || isAbsolute(rel) ? basename(imported) : rel.split(sep).join('/')
      const item = describe('memory', imported, name, source, importedText)
      items.push({ ...item, description: `Importé par ${label}${item.description ? ` · ${item.description}` : ''}` })
    }
  }
  return items
}

/** `@file.md` references outside code spans and fences. */
function importsOf(text: string, dir: string): string[] {
  const withoutCode = text.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '')
  const found = new Set<string>()
  for (const match of withoutCode.matchAll(/(?:^|\s)@((?:~\/|\.{1,2}\/|\/)?[\w./-]+\.md)\b/gm)) {
    const ref = match[1]
    const path = ref.startsWith('~/') ? join(homedir(), ref.slice(2)) : isAbsolute(ref) ? ref : resolve(dir, ref)
    found.add(path)
  }
  return [...found]
}

// ---------------------------------------------------------------------------------------------
// Plugins

interface InstalledPlugin {
  id: string
  installPath: string
  disabled: boolean
}

interface InstalledPluginsFile {
  plugins?: Record<string, { scope?: string; projectPath?: string; installPath?: string }[]>
}

/** Plugins installed for every project (`user` scope) or for this one, from Claude Code's registry. */
async function installedPlugins(userDir: string, projectRoot: string | null): Promise<InstalledPlugin[]> {
  const registry = await readJson<InstalledPluginsFile>(join(userDir, 'plugins', 'installed_plugins.json'))
  if (!registry?.plugins) return []
  const enabled = await enabledPlugins(userDir, projectRoot)
  const result: InstalledPlugin[] = []
  for (const [id, installs] of Object.entries(registry.plugins)) {
    if (!Array.isArray(installs)) continue
    const install = installs.find((i) => i.scope !== 'user' && !!projectRoot && i.projectPath === projectRoot) ?? installs.find((i) => i.scope === 'user')
    if (!install?.installPath) continue
    result.push({ id, installPath: install.installPath, disabled: enabled[id] === false })
  }
  return result
}

/** `enabledPlugins` of the user's then the project's settings (the later one wins). */
async function enabledPlugins(userDir: string, projectRoot: string | null): Promise<Record<string, boolean>> {
  const files = [join(userDir, 'settings.json')]
  if (projectRoot) files.push(join(projectRoot, '.claude', 'settings.json'), join(projectRoot, '.claude', 'settings.local.json'))
  const merged: Record<string, boolean> = {}
  for (const file of files) {
    const settings = await readJson<{ enabledPlugins?: Record<string, unknown> }>(file)
    for (const [id, value] of Object.entries(settings?.enabledPlugins ?? {})) {
      if (typeof value === 'boolean') merged[id] = value
    }
  }
  return merged
}

interface PluginManifest {
  name?: string
  skills?: string | string[]
  agents?: string | string[]
  commands?: string | string[]
}

/** The plugin's skills/, agents/ and commands/, plus any extra folders its manifest names. */
async function scanPlugin(plugin: InstalledPlugin): Promise<ClaudeConfigItem[]> {
  const manifest = (await readJson<PluginManifest>(join(plugin.installPath, '.claude-plugin', 'plugin.json'))) ?? {}
  const name = manifest.name || plugin.id.split('@')[0]
  const source: Source = { scope: 'plugin', plugin: plugin.id, disabled: plugin.disabled }
  const dirs = (key: 'skills' | 'agents' | 'commands') => {
    const extra = manifest[key]
    const listed = (Array.isArray(extra) ? extra : extra ? [extra] : []).map((p) => resolve(plugin.installPath, p))
    // A manifest path must stay inside the plugin.
    return [...new Set([join(plugin.installPath, key), ...listed])].filter((dir) => isInside(plugin.installPath, dir))
  }
  const tasks: Promise<ClaudeConfigItem[]>[] = [
    ...dirs('skills').map((dir) => skillsIn(dir, source)),
    ...dirs('agents').map((dir) => markdownIn(dir, 'agent', source)),
    ...dirs('commands').map((dir) => markdownIn(dir, 'command', source))
  ]
  const items = (await Promise.all(tasks)).flat()
  return items.map((item) => ({ ...item, name: `${name}:${item.name}` }))
}

// ---------------------------------------------------------------------------------------------
// Reading one file

async function toItem(kind: ClaudeConfigKind, path: string, fallbackName: string, source: Source): Promise<ClaudeConfigItem> {
  return describe(kind, path, fallbackName, source, (await readText(path)) ?? '')
}

function describe(kind: ClaudeConfigKind, path: string, fallbackName: string, source: Source, text: string): ClaudeConfigItem {
  const { data, body } = parseFrontMatter(text)
  const str = (key: string) => (typeof data[key] === 'string' && data[key] ? (data[key] as string) : null)
  // Commands and rules are named after their file; skills and agents may rename themselves.
  const name = (kind === 'skill' || kind === 'agent') && str('name') ? str('name')! : fallbackName
  const description = str('description') ?? firstLine(body)
  const rawPaths = data.paths ?? data.globs
  const paths = kind === 'rule' && rawPaths ? (Array.isArray(rawPaths) ? rawPaths : rawPaths.split(',').map((p) => p.trim()).filter(Boolean)) : null
  return {
    kind,
    scope: source.scope,
    name,
    description: description ? clip(description) : null,
    path,
    plugin: source.plugin,
    disabled: source.disabled,
    paths: paths?.length ? paths : null,
    meta: Object.fromEntries(Object.entries(data).filter(([key]) => !SHOWN_KEYS.has(key)))
  }
}

function clip(text: string): string {
  const flat = text.replace(/\s+/g, ' ').trim()
  return flat.length > MAX_DESCRIPTION ? `${flat.slice(0, MAX_DESCRIPTION - 1)}…` : flat
}

/** First line of prose, as Claude Code does for a command without a description. */
function firstLine(body: string): string | null {
  for (const raw of body.split('\n')) {
    const line = raw.replace(/^#+\s*/, '').trim()
    if (line && !line.startsWith('<!--') && !line.startsWith('@')) return line
  }
  return null
}

/**
 * Just enough YAML for front matter: `key: value` (quoted or not), folded / literal blocks
 * (`>`, `|`) and lists. Anything fancier is kept as raw text.
 */
export function parseFrontMatter(text: string): { data: FrontMatter; body: string } {
  const match = /^﻿?---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(text)
  if (!match) return { data: {}, body: text }
  const data: FrontMatter = {}
  const lines = match[1].split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const keyMatch = /^([\w-]+)\s*:\s*(.*)$/.exec(lines[i])
    if (!keyMatch) continue
    const [, key, rest] = keyMatch
    const value = rest.trim()
    // Indented continuation lines (block scalars, lists, multi-line plain values).
    const block: string[] = []
    while (i + 1 < lines.length && (/^\s+\S/.test(lines[i + 1]) || /^\s*-\s/.test(lines[i + 1]) || lines[i + 1].trim() === '')) {
      if (/^[\w-]+\s*:/.test(lines[i + 1])) break
      block.push(lines[++i])
    }
    if (/^[>|][+-]?$/.test(value)) {
      const joined = block.map((l) => l.trim())
      data[key] = (value.startsWith('>') ? joined.join(' ') : joined.join('\n')).trim()
    } else if (value === '' && block.some((l) => /^\s*-\s/.test(l))) {
      data[key] = block.map((l) => /^\s*-\s+(.*)$/.exec(l)?.[1]).filter((v): v is string => !!v).map(unquote)
    } else if (value.startsWith('[') && value.endsWith(']')) {
      data[key] = value.slice(1, -1).split(',').map((v) => unquote(v.trim())).filter(Boolean)
    } else {
      data[key] = unquote([value, ...block.map((l) => l.trim())].filter(Boolean).join(' '))
    }
  }
  return { data, body: text.slice(match[0].length) }
}

function unquote(value: string): string {
  if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
    const inner = value.slice(1, -1)
    return value.startsWith('"') ? inner.replace(/\\"/g, '"').replace(/\\n/g, '\n') : inner.replace(/''/g, "'")
  }
  return value
}

async function isFile(path: string): Promise<boolean> {
  return stat(path).then((s) => s.isFile(), () => false)
}

/** The start of a text file, or null when it doesn't exist. */
async function readText(path: string): Promise<string | null> {
  let handle
  try {
    handle = await open(path, 'r')
    if (!(await handle.stat()).isFile()) return null
    const buffer = Buffer.alloc(HEAD_BYTES)
    const { bytesRead } = await handle.read(buffer, 0, HEAD_BYTES, 0)
    return buffer.subarray(0, bytesRead).toString('utf8')
  } catch {
    return null
  } finally {
    await handle?.close()
  }
}

async function readJson<T>(path: string): Promise<T | null> {
  try {
    return JSON.parse(await readFile(path, 'utf8')) as T
  } catch {
    return null
  }
}
