import { cp, lstat, mkdir, rename, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, join } from 'node:path'

/** A single file or folder name: no separator, not `.` / `..`, nothing Windows refuses. */
export function checkName(name: string): string {
  const trimmed = name.trim()
  if (!trimmed) throw new Error('Le nom est vide')
  if (trimmed === '.' || trimmed === '..') throw new Error('Nom invalide')
  if (/[\\/]/.test(trimmed)) throw new Error('Le nom ne peut pas contenir / ou \\')
  if (process.platform === 'win32' && /[<>:"|?*]/.test(trimmed)) throw new Error('Le nom ne peut pas contenir < > : " | ? *')
  return trimmed
}

const exists = (path: string) => lstat(path).then(() => true, () => false)

/** New empty file or folder `name` in `dir`; refuses to replace anything. Resolves with its path. */
export async function createEntry(dir: string, name: string, kind: 'file' | 'directory'): Promise<string> {
  const path = join(dir, checkName(name))
  if (await exists(path)) throw new Error(`« ${basename(path)} » existe déjà`)
  if (kind === 'directory') await mkdir(path)
  else await writeFile(path, '', { flag: 'wx' })
  return path
}

/** Renames in place (same folder). Resolves with the new path. */
export async function renameEntry(path: string, name: string): Promise<string> {
  const target = join(dirname(path), checkName(name))
  if (target === path) return path
  // A change of case only is the same entry on case-insensitive disks (macOS, Windows).
  if (target.toLowerCase() !== path.toLowerCase() && (await exists(target))) throw new Error(`« ${basename(target)} » existe déjà`)
  await rename(path, target)
  return target
}

/** Copies a file or folder next to itself ("name copie.ext", "name copie 2.ext"…). Resolves with the copy's path. */
export async function duplicateEntry(path: string): Promise<string> {
  const info = await lstat(path)
  const ext = info.isDirectory() ? '' : extname(path)
  const stem = basename(path, ext)
  for (let n = 1; n < 1000; n++) {
    const target = join(dirname(path), `${stem} copie${n > 1 ? ` ${n}` : ''}${ext}`)
    if (await exists(target)) continue
    await cp(path, target, { recursive: true, errorOnExist: true, force: false, verbatimSymlinks: true })
    return target
  }
  throw new Error('Trop de copies existent déjà')
}
