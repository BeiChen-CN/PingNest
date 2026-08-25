export interface SqlMessageContent {
  rawContent: string
  parsedContent: string
}

/**
 * Keep text needed by the push layer to recognize revoke system messages.
 * Binary/media payloads stay hidden from the renderer as before.
 */
export function mapSqlMessageContent(localType: number, value: unknown): SqlMessageContent {
  const content = String(value ?? '')
  const keepRaw = localType === 1 || localType === 10000 || localType === 10002
  return {
    rawContent: keepRaw ? content : '',
    parsedContent: keepRaw ? content : ''
  }
}
