/**
 * 撤回消息识别（纯函数，可单测）。
 * 依赖微信系统消息的文本特征（"撤回了一条消息"等）与 localType 10000/10002，
 * 属于对微信版本行为的启发式匹配——微信改版时优先检查这里。
 */

export function isRevokeSystemMessage(message: any): boolean {
  const localType = Number(message.localType || 0)
  const content = String(message.rawContent || '') + '\n' + String(message.parsedContent || '')
  if (content.includes('revokemsg') || content.includes('<replacemsg')) return true
  if (content.includes('撤回了一条消息') || content.includes('尝试撤回此消息')) return true
  if ((localType === 10000 || localType === 10002) && content.includes('撤回')) return true
  return false
}

export function isSelfRevokeMessage(message: any): boolean {
  const content = String(message.rawContent || '') + '\n' + String(message.parsedContent || '')
  return content.includes('你撤回')
}

export function extractReplaceMsg(content: string): string | null {
  const match = /<replacemsg><!\[CDATA\[([\s\S]*?)\]\]><\/replacemsg>/i.exec(content)
  if (match) return match[1].trim()
  const plain = /<replacemsg>([\s\S]*?)<\/replacemsg>/i.exec(content)
  if (plain) return plain[1].trim()
  return null
}

/** 在同一批消息里找被撤回的原消息（时间早于撤回消息的最后一条收到的非撤回消息） */
export function findRevokedOriginalInMessages(messages: any[], revokeMessage: any): any | null {
  const revokeCreateTime = Number(revokeMessage.createTime || 0)
  let best: any | null = null
  for (const message of messages) {
    if (message.messageKey === revokeMessage.messageKey) continue
    if (Number(message.isSend) === 1) continue
    if (isRevokeSystemMessage(message)) continue
    const createTime = Number(message.createTime || 0)
    if (revokeCreateTime > 0 && createTime > revokeCreateTime) continue
    if (!best || createTime >= Number(best.createTime || 0)) best = message
  }
  return best
}
