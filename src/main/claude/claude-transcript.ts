import { readFile } from 'node:fs/promises'
import type { ChatHistory, ChatWireMessage } from '../../shared/types'
import { transcriptPath } from './claude-sessions'

/**
 * Reads a saved conversation back for the chat view. Claude appends every record of a session to
 * `<config>/projects/<folder>/<id>.jsonl`, linked by `parentUuid`; after a rewind or an edit the
 * file holds several branches, so only the chain ending at the latest record is kept.
 */

// Past this, older messages stay in the file but aren't drawn.
const MAX_RECORDS = 4000
const KEPT_TYPES = new Set(['user', 'assistant', 'system'])

interface TranscriptRecord {
  type?: string
  subtype?: string
  uuid?: string
  parentUuid?: string | null
  /** Set on compaction boundaries: the conversation continues from there. */
  logicalParentUuid?: string | null
  isSidechain?: boolean
  isMeta?: boolean
  [key: string]: unknown
}

export async function readChatHistory(sessionId: string): Promise<ChatHistory> {
  const file = transcriptPath(sessionId)
  if (!file) return { records: [], truncated: false }
  const text = await readFile(file, 'utf8')
  const byUuid = new Map<string, TranscriptRecord>()
  let leaf: TranscriptRecord | null = null
  for (const line of text.split('\n')) {
    if (!line.trim()) continue
    let record: TranscriptRecord
    try {
      record = JSON.parse(line) as TranscriptRecord
    } catch {
      continue
    }
    if (typeof record.uuid !== 'string' || record.isSidechain) continue
    byUuid.set(record.uuid, record)
    leaf = record
  }

  const chain: TranscriptRecord[] = []
  const seen = new Set<string>()
  let cursor = leaf
  while (cursor && typeof cursor.uuid === 'string' && !seen.has(cursor.uuid)) {
    seen.add(cursor.uuid)
    chain.push(cursor)
    const parent: string | null | undefined = cursor.parentUuid ?? cursor.logicalParentUuid
    cursor = parent ? (byUuid.get(parent) ?? null) : null
  }
  chain.reverse()

  const records = chain.filter(isShown)
  const truncated = records.length > MAX_RECORDS
  return { records: (truncated ? records.slice(-MAX_RECORDS) : records) as ChatWireMessage[], truncated }
}

function isShown(record: TranscriptRecord): boolean {
  // Prompts typed while Claude was busy are stored as queued-command attachments.
  if (record.type === 'attachment') {
    const attachment = record.attachment as { type?: string; commandMode?: string } | undefined
    return attachment?.type === 'queued_command' && attachment.commandMode === 'prompt'
  }
  if (!KEPT_TYPES.has(String(record.type)) || record.isMeta) return false
  if (record.type === 'system') return record.subtype === 'compact_boundary'
  // Injected context (compaction summaries, synthetic notes) isn't part of what was said.
  if (record.type === 'user' && (record.isSynthetic || record.isCompactSummary)) return hasToolResult(record)
  return true
}

function hasToolResult(record: TranscriptRecord): boolean {
  const content = (record.message as { content?: unknown } | undefined)?.content
  return Array.isArray(content) && content.some((block) => (block as { type?: string })?.type === 'tool_result')
}
