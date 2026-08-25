export interface SessionNameFields {
  username?: string
  displayName?: string
  display_name?: string
  remark?: string
  nickName?: string
  nick_name?: string
  lastSenderDisplayName?: string
  last_sender_display_name?: string
}

export function normalizeDisplayName(value: unknown, username = ''): string {
  const name = String(value || '').trim()
  const account = String(username || '').trim()
  return !name || name.toLowerCase() === account.toLowerCase() ? '' : name
}

export function resolveContactDisplayName(
  username: string,
  contact: Record<string, unknown> | null,
  mappedName?: string,
  cachedName?: string
): string | undefined {
  const candidates = [
    contact?.remark,
    contact?.remark_name,
    mappedName,
    contact?.nickName,
    contact?.nick_name,
    contact?.nickname,
    contact?.displayName,
    contact?.display_name,
    contact?.alias,
    cachedName
  ]
  for (const candidate of candidates) {
    const name = normalizeDisplayName(candidate, username)
    if (name) return name
  }
  return undefined
}

export function resolveSessionDisplayName(session: SessionNameFields): string {
  const candidates = [
    session.displayName,
    session.display_name,
    session.remark,
    session.nickName,
    session.nick_name,
    session.last_sender_display_name,
    session.lastSenderDisplayName
  ]
  for (const candidate of candidates) {
    const name = normalizeDisplayName(candidate, session.username)
    if (name) return name
  }
  return ''
}

export function resolveGroupDisplayName(session: SessionNameFields): string {
  const candidates = [
    session.displayName,
    session.display_name,
    session.remark,
    session.nickName,
    session.nick_name
  ]
  for (const candidate of candidates) {
    const name = normalizeDisplayName(candidate, session.username)
    if (name) return name
  }
  return ''
}
