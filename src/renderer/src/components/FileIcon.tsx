import { File, FileCode, FileCog, FileImage, FileText, Folder, FolderOpen } from 'lucide-react'
import type { DirEntry } from '@shared/types'

const CODE_EXT = /\.(c|cc|cpp|cs|css|go|h|hpp|html|java|jsx?|kt|lua|mjs|cjs|php|py|rb|rs|scss|sh|sql|svelte|swift|tsx?|vue|zsh|bash)$/i
const CONFIG_EXT = /(\.(json|jsonc|ya?ml|toml|ini|xml|env|lock|conf)$)|(^\.[\w.-]+rc$)|(^\.env)/i
const TEXT_EXT = /\.(md|mdx|txt|rst|log|csv)$/i
const IMAGE_EXT = /\.(png|jpe?g|gif|svg|webp|ico|icns|bmp|avif)$/i

export function EntryIcon({ entry, expanded }: { entry: Pick<DirEntry, 'name' | 'isDirectory'>; expanded?: boolean }) {
  const cls = 'shrink-0'
  if (entry.isDirectory) {
    const Icon = expanded ? FolderOpen : Folder
    return <Icon size={14} className={`${cls} text-accent/80`} />
  }
  if (CODE_EXT.test(entry.name)) return <FileCode size={14} className={`${cls} text-sky-300/80`} />
  if (CONFIG_EXT.test(entry.name)) return <FileCog size={14} className={`${cls} text-violet-300/80`} />
  if (TEXT_EXT.test(entry.name)) return <FileText size={14} className={`${cls} text-slate-300/80`} />
  if (IMAGE_EXT.test(entry.name)) return <FileImage size={14} className={`${cls} text-emerald-300/80`} />
  return <File size={14} className={`${cls} text-faint`} />
}
