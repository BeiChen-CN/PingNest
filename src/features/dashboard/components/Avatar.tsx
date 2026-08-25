import type { NotifyCenterEntry } from '../types'

export function Avatar({ entry, size = 32 }: { entry: NotifyCenterEntry; size?: number }) {
  const title = entry.payload.groupName || entry.payload.sourceName || '?'
  return entry.payload.avatarUrl
    ? <img className="avatar" src={entry.payload.avatarUrl} alt={title} width={size} height={size} />
    : <span className="avatar fallback" style={{ width: size, height: size }}>{title.charAt(0)}</span>
}

export function formatTime(value: number): string {
  const date = new Date(value)
  return date.toDateString() === new Date().toDateString()
    ? date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
    : date.toLocaleDateString([], { month: '2-digit', day: '2-digit' })
}
