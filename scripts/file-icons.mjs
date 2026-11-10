// Regenerates the file and folder icons from Material Icon Theme (MIT, github.com/material-extensions/vscode-material-icon-theme).
// Usage: node scripts/file-icons.mjs   — writes src/renderer/public/file-icons/*.svg and src/renderer/src/features/files/file-icons.json
// Needs network (open-vsx.org) and the `unzip` command. Bump VERSION to update the icons.
import { execFileSync } from 'node:child_process'
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

/** Extensions of VS Code's built-in languages, for languages the theme maps by id only. */
const LANGUAGE_EXTENSIONS = {
  typescript: ['ts', 'mts', 'cts'],
  javascript: ['js', 'mjs', 'cjs'],
  typescriptreact: ['tsx'],
  javascriptreact: ['jsx'],
  json: ['json'],
  jsonc: ['jsonc'],
  markdown: ['md', 'markdown', 'mdown', 'mkd'],
  html: ['html', 'htm', 'xhtml'],
  css: ['css'],
  scss: ['scss'],
  less: ['less'],
  python: ['py', 'pyw', 'pyi'],
  shellscript: ['sh', 'bash', 'zsh', 'ksh', 'fish'],
  bat: ['bat', 'cmd'],
  powershell: ['ps1', 'psm1', 'psd1'],
  ruby: ['rb', 'gemspec', 'rake'],
  go: ['go'],
  rust: ['rs'],
  java: ['java'],
  csharp: ['cs', 'csx'],
  cpp: ['cpp', 'cc', 'cxx', 'hpp', 'hh', 'hxx'],
  c: ['c', 'h'],
  php: ['php'],
  sql: ['sql'],
  yaml: ['yml', 'yaml'],
  xml: ['xml', 'xsd', 'plist'],
  ini: ['ini', 'cfg', 'conf'],
  properties: ['properties'],
  diff: ['diff', 'patch'],
  plaintext: ['txt'],
  log: ['log'],
  dockerfile: ['dockerfile']
}

/** File names VS Code detects a language for. */
const LANGUAGE_FILENAMES = {
  dockerfile: 'dockerfile',
  containerfile: 'dockerfile',
  makefile: 'makefile',
  gnumakefile: 'makefile',
  '.gitattributes': 'git',
  '.gitmodules': 'git',
  '.editorconfig': 'editorconfig'
}

const VERSION = '5.38.0'
const appDir = resolve(import.meta.dirname, '..')
const iconsOut = join(appDir, 'src/renderer/public/file-icons')
const manifestOut = join(appDir, 'src/renderer/src/features/files/file-icons.json')

const work = mkdtempSync(join(tmpdir(), 'capitaine-icons-'))
try {
  const url = `https://open-vsx.org/api/PKief/material-icon-theme/${VERSION}/file/PKief.material-icon-theme-${VERSION}.vsix`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`${url}: ${res.status}`)
  const vsix = join(work, 'theme.vsix')
  writeFileSync(vsix, Buffer.from(await res.arrayBuffer()))
  execFileSync('unzip', ['-q', vsix, 'extension/dist/material-icons.json', 'extension/icons/*', 'extension/LICENSE.txt', '-d', work])

  const theme = JSON.parse(readFileSync(join(work, 'extension/dist/material-icons.json'), 'utf8'))
  const used = new Set()
  const use = (id) => {
    if (!theme.iconDefinitions[id]) throw new Error(`unknown icon ${id}`)
    used.add(id)
    return id
  }
  const lower = (map) => Object.fromEntries(Object.entries(map).map(([k, id]) => [k.toLowerCase(), use(id)]))

  const ext = lower(theme.fileExtensions)
  const names = lower(theme.fileNames)
  // VS Code also picks icons from the detected language: the editor's built-in languages, for what the theme doesn't list.
  for (const [lang, exts] of Object.entries(LANGUAGE_EXTENSIONS)) {
    const id = theme.languageIds[lang]
    if (id) for (const e of exts) ext[e] ??= use(id)
  }
  for (const [name, lang] of Object.entries(LANGUAGE_FILENAMES)) {
    const id = theme.languageIds[lang]
    if (id) names[name] ??= use(id)
  }
  const folders = {}
  for (const [name, id] of Object.entries(theme.folderNames)) {
    const open = theme.folderNamesExpanded[name]
    folders[name.toLowerCase()] = open ? [use(id), use(open)] : [use(id), use(id)]
  }

  const manifest = {
    version: VERSION,
    file: use(theme.file),
    folder: use(theme.folder),
    folderOpen: use(theme.folderExpanded),
    ext,
    names,
    folders
  }

  rmSync(iconsOut, { recursive: true, force: true })
  mkdirSync(iconsOut, { recursive: true })
  for (const id of used) {
    const src = join(work, 'extension/dist', theme.iconDefinitions[id].iconPath)
    copyFileSync(src, join(iconsOut, `${id}.svg`))
  }
  copyFileSync(join(work, 'extension/LICENSE.txt'), join(iconsOut, 'LICENSE.txt'))
  writeFileSync(manifestOut, `${JSON.stringify(manifest)}\n`)
  console.log(`material-icon-theme ${VERSION}: ${used.size} icons, ${Object.keys(ext).length} extensions, ${Object.keys(names).length} file names, ${Object.keys(folders).length} folders`)
} finally {
  rmSync(work, { recursive: true, force: true })
}
