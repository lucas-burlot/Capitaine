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
git('init', '-q')
git('add', '.')
git('commit', '-qm', 'init')
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

const app = await electron.launch({
  executablePath: join(appDir, 'node_modules/electron/dist', process.platform === 'win32' ? 'electron.exe' : 'electron'),
  args: [...(process.platform === 'linux' ? ['--ozone-platform=headless'] : []), appDir, `--user-data-dir=${userData}`],
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
await page.waitForSelector('text=capitaine', { timeout: 15000 })
await page.click('button:has-text("Nouveau terminal")')
await page.waitForSelector('.xterm', { timeout: 10000 })
await page.waitForTimeout(1500)
await page.keyboard.type('echo "hello from $(pwd)"\n', { delay: 10 })
await page.click('button[title^="Nouvel onglet"]')
await page.waitForTimeout(1200)
await page.keyboard.type('for i in 1 2 3; do echo tick $i; sleep 0.3; done\n', { delay: 10 })
await page.click('text=home')
await page.waitForTimeout(1500)
await shot('01-other-project')
await page.click('text=capitaine')
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
await app.close()
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
