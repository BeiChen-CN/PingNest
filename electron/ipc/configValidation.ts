import { configService, type ConfigSchema } from '../services/config'
import type { NotificationPosition, NotificationStyle, NotifyRule } from '../../shared/appConfig'

/**
 * config:set 的声明式校验表：每个受约束的键一个校验器，
 * 替代原先 20 个 if 分支；新增配置项时在此登记即可。
 */

type Validator = (value: unknown) => string | null

const BOOLEAN_KEYS: ReadonlySet<string> = new Set([
  'notificationEnabled', 'soundEnabled', 'showNotificationSummary', 'notifyCenterEnabled',
  'startupEnabled', 'closeToTray', 'trayNotifications', 'autoReconnect', 'autoCleanupHistory',
  'onboardingDone'
])

const NOTIFICATION_POSITIONS: NotificationPosition[] = ['top-right', 'top-left', 'bottom-right', 'bottom-left', 'top-center']
const NOTIFICATION_STYLES: NotificationStyle[] = ['standard', 'compact', 'layered', 'minimal']

const validators: Partial<Record<keyof ConfigSchema, Validator>> = {
  reconnectIntervalSeconds: (value) =>
    !Number.isInteger(value) || Number(value) < 1 || Number(value) > 15
      ? '重连间隔必须为 1 到 15 秒'
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
  notificationFilterMode: (value) =>
    value !== 'all' && value !== 'whitelist' && value !== 'blacklist'
      ? '通知范围不受支持'
      : null,
  notificationFilterList: (value) =>
    !Array.isArray(value) || value.some((item) => typeof item !== 'string')
      ? '通知会话列表格式无效'
      : null,
  notifyRules: (value) => validateNotifyRules(value)
}

function validateNotifyRules(value: unknown): string | null {
  if (!Array.isArray(value)) return '通知规则格式无效'
  for (const rule of value) {
    if (!rule || typeof rule !== 'object') return '通知规则格式无效'
    const candidate = rule as Record<string, unknown>
    if (typeof candidate.id !== 'string' || typeof candidate.name !== 'string' || typeof candidate.enabled !== 'boolean') return '通知规则格式无效'
    if (!Array.isArray(candidate.sessionIds) || candidate.sessionIds.some((item) => typeof item !== 'string')) return '通知规则会话格式无效'
    if (!Array.isArray(candidate.keywords) || candidate.keywords.some((item) => typeof item !== 'string')) return '通知规则关键词格式无效'
    if (candidate.matchMode !== 'any' && candidate.matchMode !== 'all') return '通知规则匹配方式无效'
  }
  return null
}

export function validateConfigValue(key: keyof ConfigSchema, value: unknown): string | null {
  if (!Object.prototype.hasOwnProperty.call(configService.getAll(), key)) return '未知配置项'
  if (BOOLEAN_KEYS.has(key) && typeof value !== 'boolean') return '配置值必须是布尔值'
  const validator = validators[key]
  return validator ? validator(value) : null
}
