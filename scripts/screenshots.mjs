// Regenerates the README images (docs/assets) from a scripted demo, headless (Linux).
// Usage: npm run build && node scripts/screenshots.mjs
// Everything runs in a throwaway directory: demo projects, a bash HOME with a plain prompt, fake agents
// replaying Claude Code's status reports, and a usage fixture instead of the real quota.
import { _electron as electron } from 'playwright-core'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const appDir = resolve(import.meta.dirname, '..')
const assets = join(appDir, 'docs/assets')
const root = mkdtempSync(join(tmpdir(), 'capitaine-shots-'))
const home = join(root, 'home')
const projectsDir = join(home, 'code')
mkdirSync(assets, { recursive: true })
mkdirSync(projectsDir, { recursive: true })

// --- A quiet bash: short coloured prompt, no history files -------------------------------------
writeFileSync(
  join(home, '.bash_profile'),
  `export PS1='\\[\\e[38;5;110m\\]\\W\\[\\e[0m\\] \\[\\e[38;5;179m\\]❯\\[\\e[0m\\] '\nexport HISTFILE=/dev/null\n`
)

// --- Demo repos --------------------------------------------------------------------------------
const write = (dir, files) => {
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(dir, path, '..'), { recursive: true })
    writeFileSync(join(dir, path), content)
  }
}
const gitIn = (dir) => (...args) =>
  execFileSync('git', ['-c', 'user.email=demo@capitaine.dev', '-c', 'user.name=Demo', '-c', 'init.defaultBranch=main', ...args], {
    cwd: dir,
    stdio: 'pipe'
  })

const api = join(projectsDir, 'acme-api')
const remote = join(root, 'acme-api.git')
mkdirSync(api)
execFileSync('git', ['init', '-q', '--bare', remote])
const g = gitIn(api)
g('init', '-q')
write(api, {
  'package.json': '{\n  "name": "acme-api",\n  "type": "module",\n  "scripts": { "dev": "tsx watch src/server.ts", "test": "vitest" }\n}\n',
  'README.md': '# acme-api\n\nREST API for the Acme dashboard.\n',
  '.gitignore': 'node_modules/\ndist/\n.env\n',
  'src/server.ts': "import { createServer } from './app'\n\ncreateServer().listen(3000)\n",
  'src/db/schema.ts':
    "import { pool } from './pool'\n\nexport async function findUser(id: string) {\n  const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [id])\n  return rows[0] ?? null\n}\n\nexport async function listUsers(limit = 50) {\n  const { rows } = await pool.query('SELECT * FROM users ORDER BY created_at DESC LIMIT $1', [limit])\n  return rows\n}\n",
  'src/routes/users.ts':
    "import { Router } from 'express'\nimport { findUser, listUsers } from '../db/schema'\n\nexport const users = Router()\n\nusers.get('/', async (_req, res) => {\n  res.json(await listUsers())\n})\n\nusers.get('/:id', async (req, res) => {\n  const user = await findUser(req.params.id)\n  if (!user) return res.status(404).end()\n  res.json(user)\n})\n",
  'src/legacy/sql.ts': "// Hand-written SQL helpers, superseded by Drizzle.\nexport const raw = (q: string) => q\n"
})
g('add', '.')
g('commit', '-qm', 'feat: users API')
g('remote', 'add', 'origin', remote)
g('push', '-q', '-u', 'origin', 'main')
g('switch', '-q', '-c', 'feat/drizzle-migration')
g('push', '-q', '-u', 'origin', 'feat/drizzle-migration')
write(api, { 'drizzle.config.ts': "export default { schema: './src/db/tables.ts', dialect: 'postgresql' }\n" })
g('add', '.')
g('commit', '-qm', 'chore: add drizzle config')
write(api, { 'src/db/tables.ts': "import { pgTable, text, timestamp } from 'drizzle-orm/pg-core'\n\nexport const users = pgTable('users', {\n  id: text('id').primaryKey(),\n  email: text('email').notNull(),\n  createdAt: timestamp('created_at').defaultNow()\n})\n" })
g('add', '.')
g('commit', '-qm', 'feat(db): users table')
// A stash, then the agent's work in progress: staged, modified, new and deleted files.
write(api, { 'src/routes/users.ts': "// pagination WIP\n" })
g('stash', 'push', '-q', '-m', 'wip: pagination des utilisateurs')
write(api, {
  'src/db/schema.ts':
    "import { eq, desc } from 'drizzle-orm'\nimport { db } from './drizzle'\nimport { users } from './tables'\n\nexport async function findUser(id: string) {\n  const [user] = await db.select().from(users).where(eq(users.id, id))\n  return user ?? null\n}\n\nexport async function listUsers(limit = 50) {\n  return db.select().from(users).orderBy(desc(users.createdAt)).limit(limit)\n}\n"
})
g('add', 'src/db/schema.ts')
write(api, {
  'src/routes/users.ts':
    "import { Router } from 'express'\nimport { z } from 'zod'\nimport { findUser, listUsers } from '../db/schema'\n\nexport const users = Router()\n\nconst query = z.object({ limit: z.coerce.number().int().min(1).max(200).default(50) })\n\nusers.get('/', async (req, res) => {\n  const { limit } = query.parse(req.query)\n  res.json(await listUsers(limit))\n})\n\nusers.get('/:id', async (req, res) => {\n  const user = await findUser(req.params.id)\n  if (!user) return res.status(404).json({ error: 'Utilisateur introuvable' })\n  res.json(user)\n})\n",
  'src/db/drizzle.ts': "import { drizzle } from 'drizzle-orm/node-postgres'\nimport { pool } from './pool'\n\nexport const db = drizzle(pool)\n",
  'tests/users.test.ts': "import { describe, it, expect } from 'vitest'\n\ndescribe('GET /users', () => {\n  it('caps the page size', async () => {\n    expect(200).toBe(200)\n  })\n})\n"
})
rmSync(join(api, 'src/legacy/sql.ts'))

const web = join(projectsDir, 'web-dashboard')
mkdirSync(web)
const gw = gitIn(web)
gw('init', '-q')
write(web, { 'app/page.tsx': 'export default function Home() {\n  return <main>Dashboard</main>\n}\n', 'package.json': '{ "name": "web-dashboard" }\n' })
gw('add', '.')
gw('commit', '-qm', 'init')
write(web, { 'app/page.tsx': 'export default function Home() {\n  return <main className="grid gap-6">Dashboard</main>\n}\n' })

const infra = join(projectsDir, 'infra-terraform')
mkdirSync(infra)
const gi = gitIn(infra)
gi('init', '-q')
write(infra, { 'main.tf': 'terraform {\n  required_version = ">= 1.9"\n}\n' })
gi('add', '.')
gi('commit', '-qm', 'init')

// --- App data: projects, panel widths, quota fixture ------------------------------------------
const userData = join(root, 'user-data')
mkdirSync(userData)
writeFileSync(
  join(userData, 'projects.json'),
  JSON.stringify({
    version: 1,
    projects: [
      { id: 'api', name: 'acme-api', path: api, createdAt: 1 },
      { id: 'web', name: 'web-dashboard', path: web, createdAt: 2 },
      { id: 'infra', name: 'infra-terraform', path: infra, createdAt: 3 }
    ]
  })
)
const inMinutes = (m) => new Date(Date.now() + m * 60_000).toISOString()
const usageFixture = join(root, 'usage.json')
writeFileSync(
  usageFixture,
  JSON.stringify({
    five_hour: { utilization: 34, resets_at: inMinutes(133) },
    seven_day: { utilization: 18, resets_at: inMinutes(4 * 1440 + 300) },
    seven_day_fable: { utilization: 6, resets_at: inMinutes(4 * 1440 + 300) }
  })
)

// --- Demo agent: prints a plausible session and reports its status like Claude Code (OSC 7501) -
const demoAgent = join(root, 'demo-agent.mjs')
writeFileSync(
  demoAgent,
  String.raw`
const scenario = process.argv[2]
const out = (s) => process.stdout.write(s)
const osc = (body) => out('\x1b]7501;' + body + '\x07')
const b64 = (t) => Buffer.from(t).toString('base64')
const c = { dim: '\x1b[2m', bold: '\x1b[1m', reset: '\x1b[0m', gold: '\x1b[38;5;179m', blue: '\x1b[38;5;110m', green: '\x1b[38;5;114m', violet: '\x1b[38;5;141m', red: '\x1b[38;5;174m' }
const line = (s = '') => out(s + '\r\n')
const box = (rows, width = 46) => {
  line(c.dim + '╭' + '─'.repeat(width) + '╮' + c.reset)
  for (const [text, style = ''] of rows) {
    line(c.dim + '│ ' + c.reset + style + text + c.reset + ' '.repeat(Math.max(0, width - 1 - [...text].length)) + c.dim + '│' + c.reset)
  }
  line(c.dim + '╰' + '─'.repeat(width) + '╯' + c.reset)
}
const scenarios = {
  migrate() {
    out('\x1b]0;Migration Postgres → Drizzle\x07')
    osc('state=working:app=claude-code')
    osc('state=working:app=claude-code:id=sql:title=' + b64('Explorer les requêtes SQL'))
    osc('state=working:app=claude-code:id=tests:title=' + b64('Écrire les tests de migration'))
    line(c.gold + '✻ ' + c.reset + c.bold + 'Migration Postgres → Drizzle' + c.reset)
    line(c.dim + '  acme-api · feat/drizzle-migration' + c.reset)
    line()
    line(c.blue + '● ' + c.reset + 'Lecture de ' + c.bold + 'src/db/schema.ts' + c.reset + c.dim + ' (142 lignes)' + c.reset)
    line(c.blue + '● ' + c.reset + 'Lecture de ' + c.bold + 'src/routes/users.ts' + c.reset)
    line(c.green + '● ' + c.reset + 'Création de ' + c.bold + 'src/db/drizzle.ts' + c.reset + '  ' + c.green + '+4' + c.reset)
    line(c.gold + '● ' + c.reset + 'Modification de ' + c.bold + 'src/db/schema.ts' + c.reset + '  ' + c.green + '+9 ' + c.red + '−7' + c.reset)
    line(c.violet + '● ' + c.reset + 'Lancement de 2 sous-agents')
    line('  ' + c.dim + '⎿ ' + c.reset + 'Explorer les requêtes SQL')
    line('  ' + c.dim + '⎿ ' + c.reset + 'Écrire les tests de migration')
    line()
    line(c.gold + '✻ Réflexion…' + c.reset + c.dim + ' (2 min · esc pour interrompre)' + c.reset)
  },
  review() {
    out('\x1b]0;Revue de sécurité des routes\x07')
    osc('state=blocked:app=claude-code:kind=question:msg=' + b64("answer: Supprimer l'ancienne table users_legacy ? (Oui · Non)"))
    line(c.gold + '✻ ' + c.reset + c.bold + 'Revue de sécurité des routes' + c.reset)
    line()
    line(c.blue + '● ' + c.reset + 'Lecture de ' + c.bold + 'src/routes/*.ts' + c.reset + c.dim + ' (6 fichiers)' + c.reset)
    line(c.green + '● ' + c.reset + 'Validation des paramètres ajoutée avec zod')
    line(c.gold + '● ' + c.reset + 'La table ' + c.bold + 'users_legacy' + c.reset + " n'est plus lue nulle part")
    line()
    box([
      ["Supprimer l'ancienne table users_legacy ?", c.bold],
      [''],
      ['❯ 1. Oui, l’ajouter à la migration', c.gold],
      ['  2. Non, la garder pour l’instant']
    ])
  },
  done() {
    out('\x1b]0;Refonte de la page d’accueil\x07')
    osc('state=done:app=claude-code')
    line(c.gold + '✻ ' + c.reset + c.bold + 'Refonte de la page d’accueil' + c.reset)
    line()
    line(c.gold + '● ' + c.reset + 'Modification de ' + c.bold + 'app/page.tsx' + c.reset + '  ' + c.green + '+84 ' + c.red + '−37' + c.reset)
    line(c.green + '● ' + c.reset + 'Tests : 24 réussis')
    line()
    line(c.green + '✓ Terminé' + c.reset + c.dim + ' en 6 min 12 s' + c.reset)
  }
}
scenarios[scenario]()
if (process.stdin.isTTY) process.stdin.setRawMode(true)
process.stdin.resume()
setInterval(() => {}, 1 << 30)
`
)

// --- Drive the app -----------------------------------------------------------------------------
const app = await electron.launch({
  executablePath: join(appDir, 'node_modules/electron/dist/electron'),
  args: ['--ozone-platform=headless', '--force-device-scale-factor=2', appDir, `--user-data-dir=${userData}`],
  env: { ...process.env, HOME: home, SHELL: '/bin/bash', CAPITAINE_USAGE_FIXTURE: usageFixture, CLAUDE_CONFIG_DIR: join(root, 'no-claude') },
  timeout: 30000
})
const page = await app.firstWindow()
const wait = (ms) => page.waitForTimeout(ms)
await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].setSize(1600, 820))
await page.evaluate(() => {
  localStorage.setItem('capitaine.sidebarWidth', '270')
  localStorage.setItem('capitaine.explorerWidth', '340')
  localStorage.setItem('capitaine.rightPanelView', 'git')
  localStorage.setItem('capitaine.explorerOpen', '1')
})
await page.reload()
await page.waitForSelector('aside nav >> text=acme-api')

const run = async (scenario) => {
  await wait(900)
  await page.keyboard.type(`clear; node ${demoAgent} ${scenario}\n`, { delay: 2 })
}
await page.click('aside nav >> text=web-dashboard')
await page.click('button:has-text("Nouveau terminal")')
await run('done')
await page.click('aside nav >> text=acme-api')
await page.click('button:has-text("Nouveau terminal")')
await run('migrate')
await page.click('button[title^="Diviser à droite"]')
await run('review')
await wait(4000)

const shot = async (name, width = 2400) => {
  const b64 = await app.evaluate(async ({ BrowserWindow }, w) => {
    const image = await BrowserWindow.getAllWindows()[0].webContents.capturePage()
    return image.resize({ width: w, quality: 'best' }).toPNG().toString('base64')
  }, width)
  writeFileSync(join(assets, `${name}.png`), Buffer.from(b64, 'base64'))
  console.log('wrote', join('docs/assets', `${name}.png`))
}
await shot('hero')

// Diff of a change from the Git panel.
await page.locator('[aria-label="Changements git"] [role=button]', { hasText: 'users.ts' }).first().click()
await page.waitForSelector('[data-diff-tab].flex .monaco-diff-editor', { timeout: 20000 })
await wait(2500)
await shot('diff')

// Logo for the README header, from the app icon.
const logo = await app.evaluate(({ nativeImage }, path) => nativeImage.createFromPath(path).resize({ width: 256, quality: 'best' }).toPNG().toString('base64'), join(appDir, 'resources/icon.png'))
writeFileSync(join(assets, 'logo.png'), Buffer.from(logo, 'base64'))
console.log('wrote docs/assets/logo.png')

await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().forEach((w) => w.destroy()))
await app.close()
rmSync(root, { recursive: true, force: true })
