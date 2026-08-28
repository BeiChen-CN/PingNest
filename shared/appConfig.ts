/**
 * 应用配置的单一来源：主进程（electron/services/config.ts 的持久化 schema）
 * 与渲染层（src/features/dashboard/types.ts）都从这里导入，
 * 避免两份手抄类型漂移。本文件必须保持零依赖（两侧进程/构建均可直接使用）。
 */

export type NotificationPosition = 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left' | 'top-center'
/** island：灵动胶囊（居中展开/收起） */
export type NotificationStyle = 'standard' | 'compact' | 'layered' | 'minimal' | 'island'
export type NotificationFilterMode = 'all' | 'whitelist' | 'blacklist'
export type NotificationClickBehavior = 'open-app' | 'open-wechat' | 'none'

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
  /** 命中后只写入通知中心，不显示桌面弹窗 */
  muted: boolean
  /** 强调色覆盖 */
  accentColor?: string
  /** 停留时长覆盖（ms） */
  durationMs?: number
  /** 位置覆盖 */
  position?: NotificationPosition
  /** 提示音文件路径或内置音效名 */
  sound?: string
}

export interface AppConfig {
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
  notificationFilterMode: NotificationFilterMode
  notificationFilterList: string[]
  mergeWindowMs: number
  soundEnabled: boolean
  notificationDurationMs: number
  notificationOpacity: number
  showNotificationSummary: boolean
  notificationClickBehavior: NotificationClickBehavior

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

export const DEFAULT_CONFIG: AppConfig = {
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
