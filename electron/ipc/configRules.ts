import type { NotificationPosition, NotificationStyle } from '../../shared/appConfig'
import { normalizeMotionScheme } from '../../shared/motionScheme.ts'

/**
 * config:set 的声明式校验表（纯函数，零依赖，可被 node:test 直接加载）：
 * 每个受约束的键一个校验器；新增配置项时在此登记即可。
 * configValidation.ts 负责提供"合法键集合"并转发到这里。
 */

export type ConfigValidator = (value: unknown) => string | null

export const BOOLEAN_KEYS: ReadonlySet<string> = new Set([
  'notificationEnabled', 'soundEnabled', 'showNotificationSummary', 'notifyCenterEnabled',
  'startupEnabled', 'closeToTray', 'trayNotifications', 'autoReconnect', 'autoCleanupHistory',
  'onboardingDone'
])

const NOTIFICATION_POSITIONS: NotificationPosition[] = ['top-right', 'top-left', 'bottom-right', 'bottom-left', 'top-center']
const NOTIFICATION_STYLES: NotificationStyle[] = ['tidal', 'terminal', 'mail', 'neon', 'wave', 'hex', 'scroll', 'halo', 'capsule']

const validators: Partial<Record<string, ConfigValidator>> = {
  reconnectIntervalSeconds: (value) =>
    !Number.isInteger(value) || Number(value) < 1 || Number(value) > 15
      ? '重连间隔必须为 1 到 15 秒'
      : null,
  pollIntervalSeconds: (value) =>
    !Number.isInteger(value) || Number(value) < 1 || Number(value) > 15
      ? '轮询间隔必须为 1 到 15 秒'
      : null,
  historyRetentionDays: (value) =>
    ![7, 30, 90].includes(Number(value)) ? '历史保留天数不受支持' : null,
  notificationDurationMs: (value) =>
    !Number.isInteger(value) || Number(value) < 3000 || Number(value) > 15000
      ? '通知持续时间超出范围'
      : null,
  notificationOpacity: (value) =>
    !Number.isInteger(value) || Number(value) < 70 || Number(value) > 100
      ? '通知透明度超出范围'
      : null,
  mergeWindowMs: (value) =>
    !Number.isFinite(value) || Number(value) < 0 || Number(value) > 60_000
      ? '消息聚合时间超出范围'
      : null,
  notificationClickBehavior: (value) =>
    value !== 'open-app' && value !== 'open-wechat' && value !== 'none'
      ? '通知点击行为不受支持'
      : null,
  notificationPosition: (value) =>
    !NOTIFICATION_POSITIONS.includes(String(value) as NotificationPosition)
      ? '通知位置不受支持'
      : null,
  notificationStyle: (value) =>
    !NOTIFICATION_STYLES.includes(String(value) as NotificationStyle)
      ? '通知样式不受支持'
      : null,
  notificationQueueSize: (value) =>
    !Number.isInteger(value) || Number(value) < 1 || Number(value) > 6
      ? '同屏通知卡片数必须为 1 到 6'
      : null,
  motionScheme: (value) =>
    normalizeMotionScheme(value) !== value
      ? '动效风格不受支持'
      : null,
  notificationSize: (value) =>
    value !== 'large' && value !== 'medium' && value !== 'small'
      ? '卡片大小仅支持 大 / 中 / 小'
      : null,
  notificationFilterMode: (value) =>
    value !== 'all' && value !== 'whitelist' && value !== 'blacklist'
      ? '通知范围不受支持'
      : null,
  notificationFilterList: (value) =>
    !Array.isArray(value) || value.some((item) => typeof item !== 'string')
      ? '通知会话列表格式无效'
      : null,
  notifyRules: (value) => validateNotifyRules(value),
  // 连接相关键只允许字符串（空串合法，供"清除"语义使用）；类型不合法会一路
  // 写进持久化配置并在 join()/凭据使用处抛错，因此必须在这里拦截。
  dbPath: (value) => (typeof value === 'string' ? null : '数据目录格式无效'),
  decryptKey: (value) => (typeof value === 'string' ? null : '连接凭据格式无效'),
  myWxid: (value) => (typeof value === 'string' ? null : '微信账号格式无效'),
  myWxName: (value) => (typeof value === 'string' ? null : '账号昵称格式无效')
}

export function validateNotifyRules(value: unknown): string | null {
  if (!Array.isArray(value)) return '通知规则格式无效'
  for (const rule of value) {
    if (!rule || typeof rule !== 'object') return '通知规则格式无效'
    const candidate = rule as Record<string, unknown>
    if (typeof candidate.id !== 'string' || typeof candidate.name !== 'string' || typeof candidate.enabled !== 'boolean') return '通知规则格式无效'
    if (!Array.isArray(candidate.sessionIds) || candidate.sessionIds.some((item) => typeof item !== 'string')) return '通知规则会话格式无效'
    if (!Array.isArray(candidate.keywords) || candidate.keywords.some((item) => typeof item !== 'string')) return '通知规则关键词格式无效'
    if (candidate.matchMode !== 'any' && candidate.matchMode !== 'all') return '通知规则匹配方式无效'
    if (candidate.muted !== undefined && typeof candidate.muted !== 'boolean') return '通知规则静音标记无效'
    if (candidate.accentColor !== undefined && (typeof candidate.accentColor !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(candidate.accentColor))) return '通知规则强调色无效'
    if (candidate.durationMs !== undefined && (!Number.isInteger(Number(candidate.durationMs)) || Number(candidate.durationMs) < 0 || Number(candidate.durationMs) > 60_000)) return '通知规则停留时长无效'
    if (candidate.position !== undefined && !NOTIFICATION_POSITIONS.includes(String(candidate.position) as NotificationPosition)) return '通知规则位置无效'
    if (candidate.sound !== undefined && typeof candidate.sound !== 'string') return '通知规则提示音无效'
  }
  return null
}

export function validateConfigValue(key: string, value: unknown, knownKeys: ReadonlySet<string> | readonly string[]): string | null {
  const keys = knownKeys instanceof Set ? knownKeys : new Set(knownKeys)
  if (!keys.has(String(key))) return '未知配置项'
  if (BOOLEAN_KEYS.has(key) && typeof value !== 'boolean') return '配置值必须是布尔值'
  const validator = validators[key]
  return validator ? validator(value) : null
}
