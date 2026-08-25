export type NotificationPosition = 'top-center' | 'top-right' | 'bottom-right' | 'top-left' | 'bottom-left'
export type NotificationStyle = 'standard' | 'compact' | 'layered' | 'minimal'

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
  return ['standard', 'compact', 'layered', 'minimal'].includes(String(value))
    ? value as NotificationStyle
    : 'standard'
}

export function calculateNotificationWidth(position: NotificationPosition, style: NotificationStyle): number {
  if (style === 'compact') return 344
  if (style === 'minimal') return 360
  if (style === 'layered') return position === 'top-center' ? 400 : 420
  return position === 'top-center' ? 360 : 400
}

export function calculateNotificationMaxHeight(style: NotificationStyle): number {
  if (style === 'compact') return 96
  if (style === 'minimal') return 92
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
