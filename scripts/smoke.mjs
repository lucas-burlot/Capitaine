// Headless end-to-end check (Linux): opens a project, spawns two shells, switches projects, screenshots.
// Usage: npm run build && npm run smoke   — screenshots land in ./smoke-shots
import { _electron as electron } from 'playwright-core'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir, homedir } from 'node:os'
import { join, resolve } from 'node:path'

const appDir = resolve(import.meta.dirname, '..')
const shots = join(appDir, 'smoke-shots')
const userData = mkdtempSync(join(tmpdir(), 'capitaine-smoke-'))
mkdirSync(shots, { recursive: true })

// Scratch git repo for the file explorer: one modified, one untracked and one ignored entry.
const gitDemo = mkdtempSync(join(tmpdir(), 'capitaine-gitdemo-'))
const git = (...args) => execFileSync('git', ['-c', 'user.email=smoke@test', '-c', 'user.name=smoke', ...args], { cwd: gitDemo })
mkdirSync(join(gitDemo, 'src'))
mkdirSync(join(gitDemo, 'dist'))
writeFileSync(join(gitDemo, 'tracked.txt'), 'v1\n')
writeFileSync(join(gitDemo, 'my file.txt'), 'with a space\n')
writeFileSync(join(gitDemo, 'src/app.ts'), 'export {}\n')
writeFileSync(join(gitDemo, '.gitignore'), 'dist/\n*.out\n')
writeFileSync(join(gitDemo, 'dist/bundle.js'), '//\n')
writeFileSync(
  join(gitDemo, 'notes.md'),
  '---\nname: notes\n---\n# Titre principal\n\nDu **gras**, un [lien relatif](other.md) et une [ancre](#tableau).\n\n- [x] fait\n- [ ] à faire\n\n## Tableau\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n```ts\nconst x: number = 1\n```\n\n<img src=x onerror="window.__xss=1">\n'
)
writeFileSync(join(gitDemo, 'other.md'), '# Autre fichier\n')
writeFileSync(join(gitDemo, 'App.vue'), '<template>\n  <p :title="t">{{ t }}</p>\n</template>\n<script setup lang="ts">\nconst t: string = "x"\n</script>\n')
writeFileSync(join(gitDemo, '.env.local'), '# local\nPORT=3000\nURL="http://${HOST}"\n')
git('init', '-q')
git('add', '.')
git('commit', '-qm', 'init')
// A stash, then a staged file, for the git panel.
writeFileSync(join(gitDemo, 'src/app.ts'), 'export const stashed = 1\n')
git('stash', 'push', '-q', '-m', 'wip refacto')
writeFileSync(join(gitDemo, 'staged.txt'), 'prêt à commiter\n')
git('add', 'staged.txt')
writeFileSync(join(gitDemo, 'tracked.txt'), 'v2\n')
writeFileSync(join(gitDemo, 'new.txt'), 'untracked\n')
writeFileSync(join(userData, 'projects.json'), JSON.stringify({
  version: 1,
  projects: [
    { id: 'p1', name: 'capitaine', path: appDir, createdAt: 1 },
    { id: 'p2', name: 'home', path: homedir(), createdAt: 2 },
    { id: 'p3', name: 'gitdemo', path: gitDemo, createdAt: 3 }
  ]
}))

// An empty Claude config dir: the usage footer must handle "not logged in" without touching the network.
const claudeConfig = mkdtempSync(join(tmpdir(), 'capitaine-claude-'))
// A simulated update (no network, no install) to exercise the update card.
const updateFixture = join(userData, 'update.json')
writeFileSync(updateFixture, JSON.stringify({ version: '9.9.9', notes: ['fix(linux): icônes à toutes les tailles', 'feat(updates): carte de mise à jour'] }))
const app = await electron.launch({
  executablePath: join(appDir, 'node_modules/electron/dist', process.platform === 'win32' ? 'electron.exe' : 'electron'),
  args: [...(process.platform === 'linux' ? ['--ozone-platform=headless'] : []), appDir, `--user-data-dir=${userData}`],
  env: { ...process.env, CLAUDE_CONFIG_DIR: claudeConfig, CAPITAINE_UPDATE_FIXTURE: updateFixture },
  timeout: 30000
})
const page = await app.firstWindow()
page.on('pageerror', (e) => console.log('[pageerror]', e.message))
const shot = async (name) => {
  const b64 = await app.evaluate(async ({ BrowserWindow }) =>
    (await BrowserWindow.getAllWindows()[0].webContents.capturePage()).toPNG().toString('base64'))
  writeFileSync(join(shots, `${name}.png`), Buffer.from(b64, 'base64'))
}
const tabTitles = () => page.$$eval('main header span.truncate', (els) => els.slice(1).map((e) => e.textContent))

await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1300, 800))
await page.waitForSelector('aside nav >> text=capitaine', { timeout: 15000 })
const updateCard = page.locator('[role=dialog][aria-label="Mise à jour de Capitaine"]')
await updateCard.waitFor({ timeout: 10000 })
const updateChecks = {}
const cardText = await updateCard.innerText()
updateChecks.cardAnnounces = cardText.includes('Nouvelle version disponible') && cardText.includes('9.9.9') && cardText.includes('Tu utilises la')
updateChecks.notesWithoutPrefix = cardText.includes('Icônes à toutes les tailles') && !cardText.includes('fix(linux)')
updateChecks.noAutoDownload = !cardText.includes('Téléchargement')
await shot('00-update-available')
await updateCard.locator('button:has-text("Plus tard")').click()
updateChecks.laterHides = (await updateCard.count()) === 0
updateChecks.footerShowsAvailable = (await page.locator('footer').innerText()).includes('9.9.9 disponible')
await page.click('button:has-text("Nouveau terminal")')
await page.waitForSelector('.xterm', { timeout: 10000 })
await page.waitForTimeout(1500)
await page.keyboard.type('echo "hello from $(pwd)"\n', { delay: 10 })
await page.click('button[title^="Nouvel onglet"]')
await page.waitForTimeout(1200)
await page.keyboard.type('for i in 1 2 3; do echo tick $i; sleep 0.3; done\n', { delay: 10 })
await page.click('aside nav >> text=home')
await page.waitForTimeout(1500)
await shot('01-other-project')
await page.click('aside nav >> text=capitaine')
await page.waitForTimeout(800)
await shot('02-terminal')
const before = await tabTitles()
await page.keyboard.type('exit\n', { delay: 10 })
await page.waitForTimeout(1000)
const after = await tabTitles()

// Agent status: replay Claude's OSC 7501 sequence in the remaining terminal.
const sidebarHas = (text) =>
  page.waitForFunction((t) => document.querySelector('aside')?.innerText.includes(t), text, { timeout: 15000 })
await page.keyboard.type('node scripts/fake-agent.mjs\n', { delay: 5 })
const agentChecks = {}
for (const [name, text] of [['subagents', 'Explorer le code'], ['blocked', 'Attend ta réponse'], ['done', 'Terminé']]) {
  agentChecks[name] = await sidebarHas(text).then(() => true, () => false)
  await shot(`03-agent-${name}`)
}
agentChecks.cleared = await page
  .waitForFunction(() => !document.querySelector('aside')?.innerText.includes('Agents'), null, { timeout: 15000 })
  .then(() => true, () => false)

// Splits: two terminals side by side, then a third below the right one.
const visiblePanes = () =>
  page.$$eval('[data-terminal-id]:not([aria-hidden="true"])', (els) =>
    els.map((el) => {
      const r = el.getBoundingClientRect()
      return { x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) }
    })
  )
await page.click('button[title^="Diviser à droite"]')
await page.waitForTimeout(1200)
await page.keyboard.type('echo "panneau de droite"\n', { delay: 5 })
const sideBySide = await visiblePanes()
await page.click('button[title^="Diviser en bas"]')
await page.waitForTimeout(1200)
await page.keyboard.type('echo "en bas à droite"\n', { delay: 5 })
const threePanes = await visiblePanes()
await shot('04-splits')

// Drag the vertical divider 200px left, and widen the sidebar by 120px.
const divider = await page.$('[title^="Glisser pour redimensionner · double-clic pour égaliser"]')
const box = await divider.boundingBox()
await page.mouse.move(box.x + box.width / 2, box.y + 100)
await page.mouse.down()
await page.mouse.move(box.x + box.width / 2 - 200, box.y + 100, { steps: 8 })
await page.mouse.up()
const handle = await page.$('[title^="Glisser pour redimensionner · double-clic pour réinitialiser"]')
const hb = await handle.boundingBox()
const sidebarBefore = (await page.$eval('aside', (el) => el.getBoundingClientRect().width))
await page.mouse.move(hb.x + 2, hb.y + 300)
await page.mouse.down()
await page.mouse.move(hb.x + 122, hb.y + 300, { steps: 8 })
await page.mouse.up()
const sidebarAfter = await page.$eval('aside', (el) => el.getBoundingClientRect().width)
await page.waitForTimeout(500)
const afterDrag = await visiblePanes()
await shot('05-resized')

// File explorer on the scratch repo.
const row = (name) =>
  page.evaluate((n) => {
    const item = [...document.querySelectorAll('[role=treeitem]')].find((r) => r.querySelector('span.truncate')?.textContent === n)
    if (!item) return null
    return { label: item.querySelector('span.truncate').className, badge: item.lastElementChild?.textContent ?? '', row: item.className }
  }, name)
// Polls from Node: simple and independent of the page's frame/CSP state.
const waitRow = async (name, predicate = () => true, timeout = 8000) => {
  for (const deadline = Date.now() + timeout; Date.now() < deadline; await page.waitForTimeout(150)) {
    const info = await row(name)
    if (info && predicate(info)) return true
  }
  return false
}
await page.click('aside >> text=gitdemo')
const explorerChecks = {}
// The explorer sits on the right of the terminals, and its handle (on its left edge) widens it when dragged left.
const explorerBox = () => page.$eval('section:has([role=tree])', (el) => el.getBoundingClientRect().toJSON())
const terminalsBox = await page.$eval('main', (el) => el.getBoundingClientRect().toJSON())
const explorerBefore = await explorerBox()
explorerChecks.onTheRight = explorerBefore.left >= terminalsBox.right - 1 && Math.round(explorerBefore.right) === 1300
const explorerHandle = await page.$('section:has([role=tree]) > [title^="Glisser pour redimensionner"]')
const eh = await explorerHandle.boundingBox()
await page.mouse.move(eh.x + 2, eh.y + 300)
await page.mouse.down()
await page.mouse.move(eh.x - 98, eh.y + 300, { steps: 8 })
await page.mouse.up()
explorerChecks.resizeFromLeftEdge = Math.round((await explorerBox()).width - explorerBefore.width) === 100
explorerChecks.modified = await waitRow('tracked.txt', (r) => r.badge === 'M')
explorerChecks.untracked = await waitRow('new.txt', (r) => r.badge === 'U')
explorerChecks.ignored = await waitRow('dist', (r) => r.row.includes('opacity-45'))
await page.click('[role=treeitem]:has-text("src")')
explorerChecks.expand = await waitRow('app.ts')
writeFileSync(join(gitDemo, 'src/live.ts'), 'export const live = 1\n')
explorerChecks.liveRefresh = await waitRow('live.ts', (r) => r.badge === 'U')

// Drop a file whose name has a space onto a terminal: the shell must receive it as one argument.
await page.click('button:has-text("Nouveau terminal")')
await page.waitForTimeout(1500)
await page.keyboard.type('printf %s ', { delay: 5 })
const dropped = join(gitDemo, 'my file.txt')
await page.evaluate((path) => {
  const target = document.querySelector('[data-terminal-id]:not([aria-hidden="true"])')
  const data = new DataTransfer()
  data.setData('application/x-capitaine-paths', JSON.stringify([path]))
  for (const type of ['dragover', 'drop']) target.dispatchEvent(new DragEvent(type, { dataTransfer: data, bubbles: true, cancelable: true }))
}, dropped)
await page.keyboard.type('> dropped.out\n', { delay: 5 })
await page.waitForTimeout(1200)
explorerChecks.dropQuoted = (() => {
  try {
    return readFileSync(join(gitDemo, 'dropped.out'), 'utf8') === dropped
  } catch {
    return false
  }
})()

await page.click('[role=treeitem]:has-text("app.ts")', { button: 'right' })
await page.click('text=Copier le chemin relatif')
explorerChecks.copyRelative = (await app.evaluate(({ clipboard }) => clipboard.readText())) === 'src/app.ts'
await shot('06-explorer')

// In-app editor: open by double-click, edit, save, outside changes, unsaved-changes prompts.
const editorChecks = {}
const editorText = () =>
  page.evaluate(() => {
    const view = document.querySelector('[data-editor-tab].flex .view-lines')
    return view ? view.innerText.replace(/\u00a0/g, ' ') : null
  })
const waitFor = async (fn, timeout = 8000) => {
  for (const deadline = Date.now() + timeout; Date.now() < deadline; await page.waitForTimeout(150)) if (await fn()) return true
  return false
}
const dirtyTab = () => page.$('main header [title^="Modifications non enregistrées"]').then(Boolean)
const tracked = join(gitDemo, 'tracked.txt')
await page.dblclick('[role=treeitem]:has-text("tracked.txt")')
editorChecks.opens = await waitFor(async () => (await editorText())?.includes('v2'), 20000)
console.log('  editor:', 'opens', editorChecks.opens)
await page.click('[data-editor-tab].flex .view-lines')
await page.keyboard.press('Control+End')
await page.keyboard.type('édité', { delay: 10 })
editorChecks.dirtyDot = await waitFor(dirtyTab)
console.log('  editor:', 'dirtyDot', editorChecks.dirtyDot)
await page.keyboard.press('Control+s')
editorChecks.savedToDisk = await waitFor(() => readFileSync(tracked, 'utf8') === 'v2\nédité')
console.log('  editor:', 'savedToDisk', editorChecks.savedToDisk)
editorChecks.cleanAfterSave = await waitFor(async () => !(await dirtyTab()))
console.log('  editor:', 'cleanAfterSave', editorChecks.cleanAfterSave)

writeFileSync(tracked, 'écrit par un agent\n')
editorChecks.reloadsOutsideChange = await waitFor(async () => (await editorText())?.includes('écrit par un agent'))
console.log('  editor:', 'reloadsOutsideChange', editorChecks.reloadsOutsideChange)

await page.keyboard.type('X', { delay: 10 })
writeFileSync(tracked, 'agent, encore\n')
editorChecks.conflictBanner = await waitFor(() => page.$('text=Garder la mienne').then(Boolean))
console.log('  editor:', 'conflictBanner', editorChecks.conflictBanner)
await shot('07-editor-conflict')
await page.click('text=Garder la mienne')

await page.click('main header [title^="Modifications non enregistrées"]')
editorChecks.closePrompt = await waitFor(() => page.$('text=Ne pas enregistrer').then(Boolean))
console.log('  editor:', 'closePrompt', editorChecks.closePrompt)
await page.click('text=Ne pas enregistrer')
editorChecks.tabClosed = await waitFor(async () => !(await page.$('[data-editor-tab]')))
console.log('  editor:', 'tabClosed', editorChecks.tabClosed)
editorChecks.diskUntouched = readFileSync(tracked, 'utf8') === 'agent, encore\n'
console.log('  editor:', 'diskUntouched', editorChecks.diskUntouched)

// Closing the window with an unsaved file is vetoed until you decide.
await page.dblclick('[role=treeitem]:has-text("tracked.txt")')
await waitFor(async () => (await editorText())?.includes('agent'), 20000)
await page.click('[data-editor-tab].flex .view-lines')
await page.keyboard.type('Y', { delay: 10 })
await waitFor(dirtyTab)
await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].close())
editorChecks.windowCloseVetoed = await waitFor(() => page.$('text=La fenêtre va se fermer').then(Boolean))
console.log('  editor:', 'windowCloseVetoed', editorChecks.windowCloseVetoed)
await page.click('button:has-text("Annuler")')
await page.keyboard.press('Control+z')
editorChecks.undoClearsDirty = await waitFor(async () => !(await dirtyTab()))
console.log('  editor:', 'undoClearsDirty', editorChecks.undoClearsDirty)

// Markdown: edit / side by side / preview, live while typing, Ctrl+Shift+V, links.
const markdownChecks = {}
const previewText = (selector) =>
  page.evaluate((sel) => document.querySelector(`[data-editor-tab].flex .markdown-body ${sel}`)?.textContent ?? null, selector)
await page.dblclick('[role=treeitem]:has-text("notes.md")')
markdownChecks.modeBar = await waitFor(() => page.$('[data-editor-tab].flex [role=tab]:has-text("Aperçu")').then(Boolean), 20000)
await page.click('[data-editor-tab].flex [role=tab]:has-text("Aperçu")')
markdownChecks.rendersHeading = await waitFor(async () => (await previewText('h1')) === 'Titre principal')
markdownChecks.editorHidden = await page.$eval('[data-editor-tab].flex', (el) => !el.querySelector('.monaco-editor')?.checkVisibility())
markdownChecks.table = (await previewText('td')) === '1'
markdownChecks.taskList = await page.$$eval('[data-editor-tab].flex .markdown-body input[type=checkbox]', (els) => els.length === 2)
markdownChecks.frontMatterAsCode = (await previewText('pre code'))?.includes('name: notes') ?? false
markdownChecks.codeColorized = await waitFor(() => page.$('[data-editor-tab].flex .markdown-body pre code span[class*="mtk"]').then(Boolean))
markdownChecks.sanitized = await page.evaluate(() => !window.__xss && !document.querySelector('.markdown-body img[onerror]'))
await shot('08-markdown-preview')
await page.click('[data-editor-tab].flex [role=tab]:has-text("Côte à côte")')
await page.click('[data-editor-tab].flex .view-lines')
await page.keyboard.press('Control+End')
await page.keyboard.type('\n## Ajout en direct', { delay: 5 })
markdownChecks.liveUpdate = await waitFor(async () =>
  page.evaluate(() => [...document.querySelectorAll('[data-editor-tab].flex .markdown-body h2')].some((h) => h.textContent === 'Ajout en direct'))
)
markdownChecks.splitShowsBoth = await page.$eval('[data-editor-tab].flex', (el) =>
  !!el.querySelector('.monaco-editor')?.checkVisibility() && !!el.querySelector('.markdown-body')?.checkVisibility()
)
await shot('09-markdown-split')
await page.click('[data-editor-tab].flex [role=tab]:has-text("Éditer")')
await page.click('[data-editor-tab].flex .view-lines')
await page.keyboard.press('Control+Shift+v')
markdownChecks.shortcutToPreview = await waitFor(() => page.$('[data-editor-tab].flex [role=tab][aria-selected=true]:has-text("Aperçu")').then(Boolean))
await page.click('[data-editor-tab].flex .markdown-body a:has-text("lien relatif")')
markdownChecks.relativeLinkOpensFile = await waitFor(async () => (await previewText('h1')) === 'Autre fichier')
console.log('markdown checks:', markdownChecks)
if (Object.values(markdownChecks).includes(false)) {
  console.error('FAIL: markdown preview')
  process.exit(1)
}
// Syntax colors for languages Monaco doesn't ship (Vue, .env): more than plain gray.
const tokenColors = () =>
  page.evaluate(() => new Set([...document.querySelectorAll('[data-editor-tab].flex .view-lines span span')].map((el) => getComputedStyle(el).color)).size)
for (const [name, key] of [['App.vue', 'vue'], ['.env.local', 'dotenv']]) {
  await page.dblclick(`[role=treeitem]:has(span.truncate:text-is("${name}"))`)
  markdownChecks[`${key}Colored`] = await waitFor(async () => (await tokenColors()) >= 4, 10000)
}
console.log('language checks:', { vue: markdownChecks.vueColored, dotenv: markdownChecks.dotenvColored })
if (!markdownChecks.vueColored || !markdownChecks.dotenvColored) {
  console.error('FAIL: syntax colors')
  process.exit(1)
}
for (const name of ['App.vue', '.env.local']) {
  await page.click(`main header [title$="${name}"] button`)
  await waitFor(async () => !(await page.$(`main header [title$="${name}"]`)))
}
// Back to plain editing for the rest of the run, and close the Markdown tabs without saving.
await page.click('[data-editor-tab].flex [role=tab]:has-text("Éditer")')
for (const name of ['other.md', 'notes.md']) {
  await page.click(`main header [title$="${name}"] button`)
  if (await waitFor(() => page.$('text=Ne pas enregistrer').then(Boolean), 1500)) await page.click('text=Ne pas enregistrer')
  await waitFor(async () => !(await page.$(`main header [title$="${name}"]`)))
}
// Git panel: changes / staged / stash, diffs, staging.
const gitChecks = {}
const gitPanel = page.locator('[aria-label="Changements git"]')
const gitRow = (name) => gitPanel.locator('[role=button]', { hasText: name }).first()
const diffText = () =>
  page.evaluate(() => {
    const view = document.querySelector('[data-diff-tab].flex .monaco-diff-editor')
    return view ? view.innerText.replace(/\u00a0/g, ' ') : null
  })
await page.click('[role=tab][aria-label="Git"]')
gitChecks.sections = await waitFor(async () => {
  const text = await gitPanel.innerText().catch(() => '')
  return /Indexés/i.test(text) && text.includes('staged.txt') && /Modifications/i.test(text) && text.includes('tracked.txt') && text.includes('new.txt')
})
gitChecks.branch = await waitFor(async () => /master|main/.test(await gitPanel.innerText()))
gitChecks.badge = await waitFor(async () => /\d/.test(await page.locator('[role=tab][aria-label="Git"]').innerText()))
await gitRow('tracked.txt').click()
gitChecks.diffOpens = await waitFor(async () => {
  const text = await diffText()
  return !!text && text.includes('v1') && text.includes('agent, encore')
}, 20000)
// Hover-only buttons: dispatch the click (headless pointer hover isn't reliable).
await gitRow('tracked.txt').locator('[title="Indexer"]').dispatchEvent('click')
gitChecks.stageMovesFile = await waitFor(async () => {
  const text = await gitPanel.innerText()
  const staged = text.slice(text.search(/Indexés/i), text.search(/Modifications/i))
  return staged.includes('tracked.txt')
})
gitChecks.diffNoticesMove = await waitFor(() => page.$('text=plus dans cette zone').then(Boolean))
await gitPanel.locator('[title="Tout désindexer"]').dispatchEvent('click')
gitChecks.unstageAll = await waitFor(async () => !/Indexés/i.test(await gitPanel.innerText()))
// Folder tree: single-child folders merge into one row, folders collapse, a whole folder stages at once.
mkdirSync(join(gitDemo, 'lib/deep'), { recursive: true })
writeFileSync(join(gitDemo, 'lib/deep/x.ts'), 'export {}\n')
const folderRow = (name) => gitPanel.locator(`[role=treeitem][title^="${name}\\A "]`).first()
gitChecks.treeMergesFolders = await waitFor(async () => (await folderRow('lib/deep').count()) > 0 && (await folderRow('lib/deep').innerText()).includes('lib/deep'))
gitChecks.treeHidesDir = await waitFor(async () => (await gitRow('live.ts').innerText()).trim().startsWith('live.ts'))
await folderRow('src').click()
gitChecks.treeCollapses = await waitFor(async () => !(await gitPanel.innerText()).includes('live.ts'))
await folderRow('src').click()
gitChecks.treeExpands = await waitFor(async () => (await gitPanel.innerText()).includes('live.ts'))
await folderRow('lib/deep').locator('[title="Indexer le dossier"]').dispatchEvent('click')
gitChecks.treeStagesFolder = await waitFor(async () => {
  const text = await gitPanel.innerText()
  return /Indexés/i.test(text) && text.slice(text.search(/Indexés/i), text.search(/Modifications/i)).includes('x.ts')
})
await gitPanel.locator('[title="Afficher en liste"]').first().dispatchEvent('click')
gitChecks.listMode = await waitFor(async () => (await gitPanel.locator('[role=treeitem]').count()) === 0 && (await gitPanel.innerText()).includes('lib/deep'))
await shot('08-git-list')
await gitPanel.locator('[title="Afficher par dossiers"]').first().dispatchEvent('click')
await shot('08-git-tree')
await gitPanel.locator('[title="Tout désindexer"]').dispatchEvent('click')
gitChecks.treeUnstageAll = await waitFor(async () => !/Indexés/i.test(await gitPanel.innerText()))
gitChecks.stashListed = await waitFor(async () => (await gitPanel.innerText()).includes('wip refacto'))
await gitRow('wip refacto').click()
gitChecks.stashFiles = await waitFor(async () => (await gitPanel.locator('[title^="src/app.ts"]').count()) > 0)
await gitPanel.locator('[title^="src/app.ts"]').click()
gitChecks.stashDiff = await waitFor(async () => (await diffText())?.includes('stashed'), 20000)
await shot('08-git')
// Sidebar branch line and the Claude usage footer.
gitChecks.sidebarBranch = await waitFor(async () => /master|main/.test(await page.locator('aside nav').innerText()))
const footer = page.locator('footer[aria-label="Quota Claude"]')
gitChecks.footerNotLoggedIn = await waitFor(async () => (await footer.innerText()).includes('Non connecté'))
await footer.locator('[aria-label="Rafraîchir le quota"]').click()
gitChecks.footerRefresh = await waitFor(async () => (await footer.innerText()).includes('Non connecté'))
// Update card: reopened from the footer, downloaded on request, installed "next launch".
await footer.locator('[aria-label="Mise à jour disponible"]').click()
updateChecks.footerReopensCard = await waitFor(async () => (await updateCard.count()) === 1)
await updateCard.locator('button:has-text("Télécharger")').click()
updateChecks.downloadProgress = await waitFor(async () => (await updateCard.innerText().catch(() => '')).includes('Téléchargement'), 3000)
updateChecks.ready = await waitFor(async () => (await updateCard.innerText().catch(() => '')).includes('Redémarrer maintenant'))
updateChecks.footerReady = (await footer.innerText()).includes('Redémarrer pour 9.9.9')
await shot('11-update-ready')
await updateCard.locator('button:has-text("Au prochain lancement")').click()
updateChecks.nextLaunchCloses = (await updateCard.count()) === 0
console.log('update checks:', updateChecks)
console.log('git checks:', gitChecks)

// Orca-style title bar: brand, window buttons, sidebar toggle, shortcuts matched in main.
const chromeChecks = {}
chromeChecks.brand = await waitFor(async () => (await page.locator('aside').innerText()).includes('Capitaine'))
if (process.platform !== 'darwin') {
  chromeChecks.windowButtons = (await page.locator('[role=group][aria-label="Fenêtre"] button').count()) === 3
  const isMaximized = () => app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMaximized())
  await page.click('[aria-label="Agrandir"]')
  chromeChecks.maximize = await waitFor(isMaximized)
  // Headless, the virtual screen is 1×1 px, so a "maximized" window is too: click through the DOM.
  await page.locator('[aria-label="Restaurer"]').dispatchEvent('click')
  chromeChecks.restore = await waitFor(async () => !(await isMaximized()))
  const tabsBefore = await page.locator('main header .group.h-8').count()
  // Through the window's real input path (Playwright's keys skip main's before-input-event).
  await app.evaluate(({ BrowserWindow }) => {
    const contents = BrowserWindow.getAllWindows()[0].webContents
    contents.sendInputEvent({ type: 'keyDown', keyCode: 'T', modifiers: ['control', 'shift'] })
    contents.sendInputEvent({ type: 'keyUp', keyCode: 'T', modifiers: ['control', 'shift'] })
  })
  chromeChecks.shortcutViaMain = await waitFor(async () => (await page.locator('main header .group.h-8').count()) === tabsBefore + 1)
}
// Where the window can be grabbed: Chromium uses the innermost element that sets an app-region.
const draggableAt = (x, y) =>
  page.evaluate(([px, py]) => {
    for (let node = document.elementFromPoint(px, py); node; node = node.parentElement) {
      const region = getComputedStyle(node).getPropertyValue('-webkit-app-region') || getComputedStyle(node).webkitAppRegion
      if (region === 'drag') return true
      if (region === 'no-drag') return false
    }
    return false
  }, [x, y])
const centerOf = async (selector) => {
  const box = await page.locator(selector).first().boundingBox()
  return box ? [box.x + box.width / 2, box.y + box.height / 2, box.width] : null
}
const tabBarGap = await centerOf('main header [data-window-drag]')
chromeChecks.tabBarDraggable = !!tabBarGap && tabBarGap[2] >= 96 && (await draggableAt(tabBarGap[0], tabBarGap[1]))
const panelGap = await centerOf('section [data-window-drag]')
chromeChecks.rightPanelDraggable = !!panelGap && (await draggableAt(panelGap[0], panelGap[1]))
const aTab = await centerOf('main header .group.h-8')
chromeChecks.tabsNotDraggable = !!aTab && !(await draggableAt(aTab[0], aTab[1]))
const brand = await centerOf('aside img')
chromeChecks.brandDraggable = !!brand && (await draggableAt(brand[0] + 40, brand[1]))

await page.click('[aria-label="Masquer la barre latérale"]')
chromeChecks.sidebarHidden = await waitFor(async () => (await page.locator('aside').count()) === 0)
chromeChecks.brandInTabBar = (await page.locator('main header [aria-label="Afficher la barre latérale"]').count()) === 1
await shot('09-sidebar-collapsed')
await page.click('[aria-label="Afficher la barre latérale"]')
chromeChecks.sidebarBack = await waitFor(async () => (await page.locator('aside').count()) === 1)
await shot('10-title-bar')
console.log('chrome checks:', chromeChecks)

// destroy() skips beforeunload: a leftover unsaved buffer must never hang the test run.
await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.destroy()))
await app.close()
console.log('editor checks:', editorChecks)
if (Object.values(updateChecks).includes(false)) {
  console.error('FAIL: update card')
  process.exit(1)
}
if (Object.values(chromeChecks).includes(false)) {
  console.error('FAIL: title bar')
  process.exit(1)
}
if (Object.values(gitChecks).includes(false)) {
  console.error('FAIL: git panel')
  process.exit(1)
}
if (Object.values(editorChecks).includes(false)) {
  console.error('FAIL: editor')
  process.exit(1)
}
console.log('explorer checks:', explorerChecks)
if (Object.values(explorerChecks).includes(false)) {
  console.error('FAIL: file explorer')
  process.exit(1)
}

const splitChecks = {
  sideBySide: sideBySide.length === 2 && sideBySide[0].y === sideBySide[1].y && sideBySide[1].x > sideBySide[0].x,
  threePanes: threePanes.length === 3 && threePanes.filter((p) => p.x === threePanes[1].x).length === 2,
  dividerDragged: afterDrag[0].w < threePanes[0].w - 100,
  sidebarResized: Math.round(sidebarAfter - sidebarBefore) === 120
}
console.log('split checks:', splitChecks, { sideBySide, threePanes, afterDrag, sidebarBefore, sidebarAfter })
if (Object.values(splitChecks).includes(false)) {
  console.error('FAIL: split / resize')
  process.exit(1)
}
console.log('agent checks:', agentChecks)
if (Object.values(agentChecks).includes(false)) {
  console.error('FAIL: agent status not shown as expected')
  process.exit(1)
}

console.log('tabs before exit:', before.length, '→ after:', after.length)
if (before.length !== 2 || after.length !== 1) {
  console.error('FAIL: expected 2 terminals, then 1 after `exit`')
  process.exit(1)
}
console.log('OK — screenshots in', shots)
