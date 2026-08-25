export type MessageSendState = 0 | 1 | null

export function normalizeMessageSendState(value: unknown): MessageSendState {
  if (value === true) return 1
  if (value === false) return 0
  if (value === null || value === undefined || value === '') return null
  const numeric = Number(value)
  if (numeric === 1) return 1
  if (numeric === 0) return 0
  return null
}

export function resolveSqlMessageSendState(myRowId: number | null, realSenderId: number): MessageSendState {
  if (!Number.isFinite(myRowId) || Number(myRowId) <= 0 || !Number.isFinite(realSenderId) || realSenderId <= 0) {
    return null
  }
  return realSenderId === myRowId ? 1 : 0
}

export function shouldPushIncomingMessage(value: unknown, unreadIncreased: boolean): boolean {
  const sendState = normalizeMessageSendState(value)
  if (sendState === 1) return false
  if (sendState === 0) return true
  return unreadIncreased
}
