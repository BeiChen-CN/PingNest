/**
 * 消息内容的展示层约定：主进程构造通知文案、渲染层识别占位文本，
 * 两端共享同一份 token 与转换函数，避免字符串隐式耦合。
 */

/** 微信本地消息类型 → 展示占位文本 */
export const MESSAGE_PLACEHOLDER = {
  image: '[图片]',
  voice: '[语音]',
  video: '[视频]',
  emoticon: '[表情]',
  card: '[名片]',
  location: '[位置]',
  generic: '[消息]'
} as const

export interface PushDisplayMessage {
  localType?: number | string
  rawContent?: string
  parsedContent?: string
  cardNickname?: string
  linkTitle?: string
  fileName?: string
}

/**
 * 把一条消息转换为通知里展示的单行文本。
 * 与微信 localType 约定对应：1 文本、3 图片、34 语音、43 视频、47 表情、
 * 42 名片、48 位置、49 链接/文件等。
 */
export function getMessageDisplayContent(message: PushDisplayMessage): string | null {
  const normalizeTextContent = (value: string | null | undefined): string | null => {
    const text = String(value || '')
    if (!text) return null
    return text.replace(/^[\s]*([a-zA-Z0-9_@-]+):(?!\/\/)(?:\s*(?:\r?\n|<br\s*\/?>)\s*|\s*)/i, '').trim()
  }
  switch (Number(message.localType || 0)) {
    case 1:
      return normalizeTextContent(message.parsedContent || message.rawContent)
    case 3:
      return MESSAGE_PLACEHOLDER.image
    case 34:
      return MESSAGE_PLACEHOLDER.voice
    case 43:
      return MESSAGE_PLACEHOLDER.video
    case 47:
      return MESSAGE_PLACEHOLDER.emoticon
    case 42:
      return message.cardNickname || MESSAGE_PLACEHOLDER.card
    case 48:
      return MESSAGE_PLACEHOLDER.location
    case 49:
      return message.linkTitle || message.fileName || MESSAGE_PLACEHOLDER.generic
    default:
      return normalizeTextContent(message.parsedContent || message.rawContent) || null
  }
}
