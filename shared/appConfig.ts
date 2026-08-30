/**
 * 应用配置的单一来源：主进程（electron/services/config.ts 的持久化 schema）
 * 与渲染层（src/features/dashboard/types.ts）都从这里导入，
 * 避免两份手抄类型漂移。本文件必须保持零依赖（两侧进程/构建均可直接使用）。
 */

export type NotificationPosition = 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left' | 'top-center'
/** 2026 重设计九套样式：潮汐/终端/信笺/霓虹弧光/音轨/蜂巢/卷轴/呼吸圆环/灵动胶囊 */
export type NotificationStyle = 'tidal' | 'terminal' | 'mail' | 'neon' | 'wave' | 'hex' | 'scroll' | 'halo' | 'capsule'
/** 通知卡片整体大小（CSS zoom 缩放，对所有样式生效） */
export type NotificationCardSize = 'large' | 'medium' | 'small'
/** 全局动效方案：绸缎/水滴/墨锋/漂浮 */
export type MotionScheme = 'satin' | 'droplet' | 'ink' | 'drift'
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
  /** 同屏最多堆叠的通知卡片数（1 = 旧的单卡替换行为） */
  notificationQueueSize: number
  /** 通知卡片整体大小：large 1.15× / medium 1× / small 0.85× */
  notificationSize: NotificationCardSize
  /** 全局动效方案：绸缎/水滴/墨锋/漂浮 */
  motionScheme: MotionScheme

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
  /** 本地轮询基础间隔（秒）；原生监控管道活跃时自动降频到 max(5×, 10 秒) */
  pollIntervalSeconds: number
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
  notificationStyle: 'capsule',
  notificationFilterMode: 'all',
  notificationFilterList: [],
  mergeWindowMs: 3500,
  soundEnabled: true,
  notificationDurationMs: 5000,
  notificationOpacity: 90,
  showNotificationSummary: true,
  notificationClickBehavior: 'open-app',
  notificationQueueSize: 3,
  notificationSize: 'medium',
  motionScheme: 'satin',

  notifyRules: [],

  notifyCenterEnabled: true,

  startupEnabled: true,
  closeToTray: true,
  trayNotifications: true,
  autoReconnect: true,
  reconnectIntervalSeconds: 3,
  pollIntervalSeconds: 2,
  historyRetentionDays: 30,
  autoCleanupHistory: true
}
