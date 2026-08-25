export interface SessionBaseline {
  lastTimestamp: number
  unreadCount: number
}

export function shouldInspectSession(
  previous: SessionBaseline | undefined,
  currentTimestamp: number,
  currentUnread: number
): boolean {
  if (!previous) return true
  return currentUnread > previous.unreadCount || currentTimestamp > previous.lastTimestamp
}

export function calculateMessageQuerySince(
  previous: SessionBaseline | undefined,
  sessionTimestamp: number,
  lookbackSeconds: number,
  nowSeconds: number
): number {
  const anchor = previous?.lastTimestamp || sessionTimestamp || nowSeconds
  return Math.max(0, anchor - lookbackSeconds)
}
