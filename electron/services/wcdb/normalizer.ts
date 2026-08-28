/**
 * WCDB 返回数据的字段归一：兼容 WeFlow 保护版与 EchoTrace legacy 版两套
 * 原生构建（snake_case / camelCase / 计算字段），统一为推送服务期望的形状。
 */

/** server_id 超过 int53 时 JSON.parse 会丢精度，先归一为字符串再解析。 */
export function parseMessageJson(jsonStr: string): any {
  const raw = String(jsonStr || '')
  if (!raw) return []
  const needsInt64Normalize = /"server_id"\s*:\s*-?\d{16,}/.test(raw)
  if (!needsInt64Normalize) return JSON.parse(raw)
  const normalized = raw.replace(/("server_id"\s*:\s*)(-?\d{16,})/g, '$1"$2"')
  return JSON.parse(normalized)
}

/** Normalize EchoTrace snake_case/computed fields to the push service shape. */
export function normalizeMessages(messages: any[], sessionId: string): any[] {
  if (!Array.isArray(messages)) return []
  return messages.map((message: any) => {
    if (!message || typeof message !== 'object') return message
    const localId = Number(message.localId ?? message.local_id ?? message.msg_id ?? message.id ?? 0)
    const createTime = Number(message.createTime ?? message.create_time ?? message.timestamp ?? 0)
    const serverId = message.serverId ?? message.server_id ?? message.serverIdRaw ?? ''
    const rawContent = message.rawContent ?? message.raw_content ?? message.message_content ?? message.msg_content ?? message.content ?? ''
    const parsedContent = message.parsedContent ?? message.parsed_content ?? rawContent
    const isSend = message.isSend ?? message.is_send ?? message.computed_is_send ?? message.computedIsSend ?? null
    const messageKey = String(message.messageKey ?? message.message_key ?? '') || [sessionId, localId, createTime, String(serverId)].join(':')
    return {
      ...message,
      messageKey,
      localId,
      createTime,
      serverId: serverId === '' ? undefined : serverId,
      serverIdRaw: serverId === '' ? undefined : String(serverId),
      isSend,
      rawContent: String(rawContent ?? ''),
      parsedContent: String(parsedContent ?? ''),
      localType: Number(message.localType ?? message.local_type ?? message.type ?? 0)
    }
  })
}

export function normalizeSessions(sessions: any[]): any[] {
  if (!Array.isArray(sessions)) return []
  return sessions.map((session: any) => {
    if (!session || typeof session !== 'object') return session
    const username = String(session.username ?? session.user_name ?? session.session_id ?? session.sessionId ?? session.wxid ?? '').trim()
    const lastTimestamp = Number(session.lastTimestamp ?? session.last_timestamp ?? session.last_msg_time ?? session.last_message_time ?? session.last_create_time ?? 0)
    const unreadCount = Number(session.unreadCount ?? session.unread_count ?? session.unread ?? 0)
    return {
      ...session,
      username,
      last_timestamp: lastTimestamp,
      unread_count: unreadCount
    }
  }).filter((session: any) => session.username)
}
