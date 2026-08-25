import { app, safeStorage } from 'electron'
import Store from 'electron-store'

export interface NotifyRule {
  id: string
  name: string
  enabled: boolean
  /** 匹配范围：sessionId 精确匹配（联系人/群） */
  sessionIds: string[]
  /** 关键词（内容包含任一即命中） */
  keywords: string[]
  /** 匹配类型：any（会话或关键词命中即生效）| all（全部条件满足） */
  matchMode: 'any' | 'all'
  /** 覆盖的主题 */
  themeId?: string
  /** 强调色 */
  accentColor?: string
  /** 停留时长 ms */
  durationMs?: number
  /** 位置覆盖 */
  position?: 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left' | 'top-center'
  /** 提示音文件路径或内置音效名 */
  sound?: string
  /** 命中后只写入通知中心，不显示桌面弹窗 */
  muted?: boolean
}

export type NotificationPosition = 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left' | 'top-center'
export type NotificationStyle = 'standard' | 'compact' | 'layered' | 'minimal'
export type ThemeMode = 'light' | 'dark' | 'system'

export interface ConfigSchema {
  // 连接
  dbPath: string
  decryptKey: string
  myWxid: string
  myWxName: string
  onboardingDone: boolean

  // 通知
  notificationEnabled: boolean
  notificationPosition: NotificationPosition
  notificationStyle: NotificationStyle
  notificationFilterMode: 'all' | 'whitelist' | 'blacklist'
  notificationFilterList: string[]
  mergeWindowMs: number
  soundEnabled: boolean
  notificationDurationMs: number
  notificationOpacity: number
  showNotificationSummary: boolean
  notificationClickBehavior: 'open-app' | 'open-wechat' | 'none'

  // 规则
  notifyRules: NotifyRule[]

  // 通知中心
  notifyCenterEnabled: boolean

  // 系统
  startupEnabled: boolean
  closeToTray: boolean
  trayNotifications: boolean
  autoReconnect: boolean
  reconnectIntervalSeconds: number
  historyRetentionDays: number
  autoCleanupHistory: boolean
}

const DEFAULTS: ConfigSchema = {
  dbPath: '',
  decryptKey: '',
  myWxid: '',
  myWxName: '',
  onboardingDone: false,

  notificationEnabled: true,
  notificationPosition: 'top-right',
  notificationStyle: 'standard',
  notificationFilterMode: 'all',
  notificationFilterList: [],
  mergeWindowMs: 3500,
  soundEnabled: true,
  notificationDurationMs: 5000,
  notificationOpacity: 90,
  showNotificationSummary: true,
  notificationClickBehavior: 'open-app',

  notifyRules: [],

  notifyCenterEnabled: true,

  startupEnabled: true,
  closeToTray: true,
  trayNotifications: true,
  autoReconnect: true,
  reconnectIntervalSeconds: 3,
  historyRetentionDays: 30,
  autoCleanupHistory: true
}

// 敏感字段：decryptKey 用 safeStorage 加密存储
const ENCRYPTED_KEYS = new Set(['decryptKey'])

function encryptValue(key: string, value: unknown): unknown {
  if (!ENCRYPTED_KEYS.has(key)) return value
  if (typeof value !== 'string' || !value) return value
  try {
    if (safeStorage.isEncryptionAvailable()) {
      return 'enc:' + safeStorage.encryptString(value).toString('base64')
    }
  } catch { }
  return value
}

function decryptValue(key: string, value: unknown): unknown {
  if (!ENCRYPTED_KEYS.has(key)) return value
  if (typeof value !== 'string') return value
  if (value.startsWith('enc:')) {
    try {
      if (safeStorage.isEncryptionAvailable()) {
        return safeStorage.decryptString(Buffer.from(value.slice(4), 'base64'))
      }
    } catch (e) {
      console.warn('[ConfigService] ' + key + ' 解密失败（可能由管理员权限写入）:', e)
    }
    return ''
  }
  return value
}

export class ConfigService {
  private static instance: ConfigService
  private store: any

  private constructor() {
    this.store = new Store({
      name: 'config',
      defaults: DEFAULTS as unknown as Record<string, unknown>
    })
  }

  static getInstance(): ConfigService {
    if (!ConfigService.instance) {
      ConfigService.instance = new ConfigService()
    }
    return ConfigService.instance
  }

  get<K extends keyof ConfigSchema>(key: K): ConfigSchema[K] {
    const raw = this.store.get(key as string)
    return decryptValue(key as string, raw) as ConfigSchema[K]
  }

  set<K extends keyof ConfigSchema>(key: K, value: ConfigSchema[K]): void {
    this.store.set(key as string, encryptValue(key as string, value))
  }

  getCacheBasePath(): string {
    return app.getPath('userData')
  }

  getAll(): ConfigSchema {
    const result: Record<string, unknown> = {}
    for (const key of Object.keys(DEFAULTS) as (keyof ConfigSchema)[]) {
      result[key] = this.get(key)
    }
    return result as unknown as ConfigSchema
  }

  clear(): void {
    this.store.clear()
  }
}

export const configService = ConfigService.getInstance()
