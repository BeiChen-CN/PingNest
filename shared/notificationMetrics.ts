/**
 * 通知弹窗的几何与归一化逻辑：主进程用它在多显示器上定位窗口，
 * 渲染层用它在测量后上报窗口尺寸，测试直接验证纯函数——
 * 三方必须使用同一份实现，否则样式改了尺寸表没改，弹窗就会被裁剪或留白。
 * 修改尺寸时需同步 NotificationToast.scss 中对应样式类的宽度。
 */

import type { NotificationPosition, NotificationStyle } from './appConfig'

export type { NotificationPosition, NotificationStyle } from './appConfig'

export interface NotificationWorkArea {
  x: number
  y: number
  width: number
  height: number
}

export function normalizeNotificationPosition(value: unknown): NotificationPosition {
  return ['top-center', 'top-right', 'bottom-right', 'top-left', 'bottom-left'].includes(String(value))
    ? value as NotificationPosition
    : 'top-right'
}

export function normalizeNotificationStyle(value: unknown): NotificationStyle {
  return ['standard', 'compact', 'layered', 'minimal', 'island'].includes(String(value))
    ? value as NotificationStyle
    : 'standard'
}

export function calculateNotificationWidth(position: NotificationPosition, style: NotificationStyle): number {
  if (style === 'compact') return 344
  if (style === 'minimal') return 360
  if (style === 'island') return 380
  if (style === 'layered') return position === 'top-center' ? 400 : 420
  return position === 'top-center' ? 360 : 400
}

export function calculateNotificationMaxHeight(style: NotificationStyle): number {
  if (style === 'compact') return 96
  if (style === 'minimal') return 92
  if (style === 'island') return 120
  if (style === 'layered') return 190
  return 180
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
