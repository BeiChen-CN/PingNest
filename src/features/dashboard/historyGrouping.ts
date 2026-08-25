import type { NotifyCenterEntry } from './types'

export interface HistoryConversation {
  id: string
  name: string
  type: string
  entries: NotifyCenterEntry[]
  latestEntry: NotifyCenterEntry
  unreadCount: number
  lastMessageAt: number
}

/** Normalize legacy notification records so filters match the actual conversation kind. */
export function normalizeHistorySessionType(entry: NotifyCenterEntry): 'private' | 'group' | 'official' | 'other' {
  const sessionId = String(entry.payload.sessionId || '').trim().toLowerCase()
  const rawType = String(entry.payload.sessionType || '').trim().toLowerCase()
  if (rawType === 'group' || sessionId.endsWith('@chatroom')) return 'group'
  if (rawType === 'official' || sessionId.startsWith('gh_')) return 'official'
  if (rawType === 'private' || rawType === 'friend' || rawType === 'contact' || rawType === 'single') return 'private'
  // Older records used "other" when the session metadata did not expose its type.
  // A non-group, non-official session with an id is a private conversation.
  if (sessionId) return 'private'
  return 'other'
}

export function historyMessageTime(entry: NotifyCenterEntry): number {
  const timestamp = Number(entry.payload.timestamp || 0)
  return timestamp > 0 ? timestamp * 1000 : entry.receivedAt
}

export function historyConversationId(entry: NotifyCenterEntry): string {
  const sessionId = String(entry.payload.sessionId || '').trim()
  if (sessionId) return sessionId
  const type = normalizeHistorySessionType(entry)
  return `${type}:${entry.payload.groupName || entry.payload.sourceName || entry.id}`
}

export function groupHistoryEntries(entries: NotifyCenterEntry[]): HistoryConversation[] {
  const grouped = new Map<string, NotifyCenterEntry[]>()
  for (const entry of entries) {
    const id = historyConversationId(entry)
    const current = grouped.get(id)
    if (current) current.push(entry)
    else grouped.set(id, [entry])
  }

  return Array.from(grouped, ([id, conversationEntries]) => {
    const sorted = [...conversationEntries].sort((a, b) => historyMessageTime(b) - historyMessageTime(a))
    const latestEntry = sorted[0]
    const type = normalizeHistorySessionType(latestEntry)
    const isGroup = type === 'group'
    const namedEntry = sorted.find((entry) => isGroup
      ? Boolean(entry.payload.groupName && String(entry.payload.groupName).trim() !== String(entry.payload.sourceName || '').trim())
      : Boolean(entry.payload.sourceName))
    const groupName = isGroup
      ? namedEntry?.payload.groupName || (sorted.every((entry) => !entry.payload.groupName) ? sorted[0]?.payload.sourceName : '群聊')
      : undefined
    return {
      id,
      name: String(isGroup ? groupName || '群聊' : namedEntry?.payload.sourceName || id),
      type,
      entries: sorted,
      latestEntry,
      unreadCount: sorted.filter((entry) => !entry.read).length,
      lastMessageAt: historyMessageTime(latestEntry)
    }
  }).sort((a, b) => b.lastMessageAt - a.lastMessageAt)
}
