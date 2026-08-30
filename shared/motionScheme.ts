/**
 * 全局动效方案：四种语言（绸缎/水滴/墨锋/漂浮），
 * 用户在外观页选择，经 data-motion 属性驱动 CSS 变量整套切换。
 * 本文件零依赖，主进程校验与渲染层共用。
 */

import type { MotionScheme } from './appConfig'

export const MOTION_SCHEMES: Array<{ value: MotionScheme; label: string; description: string }> = [
  { value: 'satin', label: '绸缎', description: '长缓出滑行 · 优雅流畅' },
  { value: 'droplet', label: '水滴', description: '弹性回弹 · 灵动活泼' },
  { value: 'ink', label: '墨锋', description: '短促利落 · 冷静克制' },
  { value: 'drift', label: '漂浮', description: '柔缓浮现 · 失重仪式感' }
]

const VALUES = MOTION_SCHEMES.map((scheme) => scheme.value)

export function normalizeMotionScheme(value: unknown): MotionScheme {
  return VALUES.includes(String(value) as MotionScheme) ? String(value) as MotionScheme : 'satin'
}
