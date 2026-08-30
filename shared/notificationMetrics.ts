/**
 * 通知弹窗的几何与归一化逻辑：主进程用它在多显示器上定位窗口，
 * 渲染层用它在测量后上报窗口尺寸，测试直接验证纯函数——
 * 三方必须使用同一份实现，否则样式改了尺寸表没改，弹窗就会被裁剪或留白。
 * 修改尺寸时需同步 NotificationToast.scss 中对应样式类的宽度。
 *
 * 2026 重设计：九套全新样式（tidal/terminal/mail/neon/wave/hex/scroll/halo/capsule），
 * 视觉与动效基准见 public/notification-styles-2026.html 提案页。
 */

import type { NotificationCardSize, NotificationPosition, NotificationStyle } from './appConfig'

export type { NotificationCardSize, NotificationPosition, NotificationStyle } from './appConfig'

const NOTIFICATION_CARD_SIZES: NotificationCardSize[] = ['large', 'medium', 'small']

export function normalizeNotificationSize(value: unknown): NotificationCardSize {
  return NOTIFICATION_CARD_SIZES.includes(String(value) as NotificationCardSize)
    ? value as NotificationCardSize
    : 'medium'
}

/** 卡片大小 → CSS zoom 系数（渲染层缩放与窗口尺寸计算共用同一份） */
export function notificationScaleFactor(size: NotificationCardSize): number {
  if (size === 'large') return 1.15
  if (size === 'small') return 0.85
  return 1
}

export interface NotificationWorkArea {
  x: number
  y: number
  width: number
  height: number
}

const NOTIFICATION_POSITIONS = ['top-center', 'top-right', 'top-left', 'bottom-right', 'bottom-left']

const NOTIFICATION_STYLES: NotificationStyle[] = [
  'tidal', 'terminal', 'mail', 'neon', 'wave', 'hex', 'scroll', 'halo', 'capsule'
]

/** 旧样式 → 新样式的迁移映射（旧 ID 不再存在，读取配置时静默迁移） */
const LEGACY_STYLE_MAP: Record<string, NotificationStyle> = {
  island: 'capsule',
  standard: 'tidal',
  compact: 'terminal',
  layered: 'tidal',
  minimal: 'halo'
}

export function normalizeNotificationPosition(value: unknown): NotificationPosition {
  return NOTIFICATION_POSITIONS.includes(String(value))
    ? value as NotificationPosition
    : 'top-right'
}

export function normalizeNotificationStyle(value: unknown): NotificationStyle {
  const raw = String(value)
  if ((NOTIFICATION_STYLES as string[]).includes(raw)) return raw as NotificationStyle
  const legacy = LEGACY_STYLE_MAP[raw]
  if (legacy) return legacy
  return 'capsule'
}

/** 每套样式的窗口宽度（hex 随堆叠数量增长，形成蜂窝横排） */
const STYLE_WIDTH: Record<NotificationStyle, number> = {
  tidal: 400,
  terminal: 460,
  mail: 430,
  neon: 420,
  wave: 400,
  hex: 128,
  scroll: 330,
  halo: 400,
  capsule: 430
}

export function calculateNotificationWidth(
  position: NotificationPosition,
  style: NotificationStyle,
  stackSize = 1,
  cardSize: NotificationCardSize = 'medium'
): number {
  void position
  const scale = notificationScaleFactor(cardSize)
  if (style === 'hex') {
    // 蜂窝横排：116px 蜂室 + 10px 间距（与渲染层 .notification-card 固定宽 116、gap 10 对齐）
    const size = Math.max(1, Math.min(6, Math.floor(Number(stackSize) || 1)))
    return Math.round((116 * size + 10 * (size - 1)) * scale)
  }
  return Math.round(STYLE_WIDTH[style] * scale)
}

/** 每套样式的单卡最大高度；堆叠时按卡片数与间距（10px，与渲染层 gap 一致）放大 */
export function calculateNotificationMaxHeight(
  style: NotificationStyle,
  stackSize = 1,
  cardSize: NotificationCardSize = 'medium'
): number {
  const perCard = STYLE_MAX_HEIGHT[style]
  const size = Math.max(1, Math.min(6, Math.floor(Number(stackSize) || 1)))
  return Math.round((perCard * size + 10 * (size - 1)) * notificationScaleFactor(cardSize))
}

const STYLE_MAX_HEIGHT: Record<NotificationStyle, number> = {
  tidal: 156,
  terminal: 104,
  mail: 204,
  neon: 150,
  wave: 152,
  hex: 148,
  scroll: 150,
  halo: 116,
  capsule: 92
}

export function calculateNotificationOrigin(
  position: NotificationPosition,
  width: number,
  height: number,
  workArea: NotificationWorkArea,
  padding: number
): { x: number; y: number } {
  switch (position) {
    case 'top-center':
      return { x: workArea.x + (workArea.width - width) / 2, y: workArea.y + padding }
    case 'top-right':
      return { x: workArea.x + workArea.width - width - padding, y: workArea.y + padding }
    case 'bottom-right':
      return { x: workArea.x + workArea.width - width - padding, y: workArea.y + workArea.height - height - padding }
    case 'top-left':
      return { x: workArea.x + padding, y: workArea.y + padding }
    case 'bottom-left':
      return { x: workArea.x + padding, y: workArea.y + workArea.height - height - padding }
  }
}
