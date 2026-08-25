export type PageId = 'overview' | 'history' | 'rules' | 'appearance' | 'settings' | 'about'
export type NotificationStyle = 'standard' | 'compact' | 'layered' | 'minimal'

export interface NotifyRule {
  id: string
  name: string
  enabled: boolean
  muted: boolean
  sessionIds: string[]
  keywords: string[]
  matchMode: 'any' | 'all'
}

export interface AppConfig {
  dbPath: string
  decryptKey: string
  myWxid: string
  myWxName: string
  onboardingDone: boolean
  notificationEnabled: boolean
  notificationPosition: 'top-right' | 'top-left' | 'bottom-right' | 'bottom-left' | 'top-center'
  notificationStyle: NotificationStyle
  notificationFilterMode: 'all' | 'whitelist' | 'blacklist'
  notificationFilterList: string[]
  mergeWindowMs: number
  soundEnabled: boolean
  notificationDurationMs: number
  notificationOpacity: number
  showNotificationSummary: boolean
  notificationClickBehavior: 'open-app' | 'none'
  notifyRules: NotifyRule[]
  notifyCenterEnabled: boolean
  startupEnabled: boolean
  closeToTray: boolean
  trayNotifications: boolean
  autoReconnect: boolean
  reconnectIntervalSeconds: number
  historyRetentionDays: number
  autoCleanupHistory: boolean
}

export interface AppStatus {
  connected: boolean
  wcdbReady: boolean
  wechatRunning: boolean
  hasFullConfig: boolean
  hookReady: boolean
  config: AppConfig
}

export type HookStage = 'idle' | 'detecting' | 'waiting-wechat' | 'hooking' | 'verifying' | 'success' | 'error'

export interface HookProgress {
  stage: HookStage
  message: string
}

export interface NotifyCenterEntry {
  id: string
  payload: {
    sessionId: string
    sessionType?: string
    avatarUrl?: string
    sourceName: string
    groupName?: string
    content: string | null
    timestamp: number
    event: string
  }
  effect: Record<string, unknown>
  receivedAt: number
  read: boolean
}

export type SaveConfig = <K extends keyof AppConfig>(key: K, value: AppConfig[K]) => Promise<boolean>

export const PAGE_PATHS: Record<PageId, string> = {
  overview: '/',
  history: '/history',
  rules: '/rules',
  appearance: '/appearance',
  settings: '/settings',
  about: '/about'
}

export const DEFAULT_CONFIG: AppConfig = {
  dbPath: '', decryptKey: '', myWxid: '', myWxName: '', onboardingDone: false,
  notificationEnabled: true,
  notificationPosition: 'top-right', notificationStyle: 'standard', notificationFilterMode: 'all', notificationFilterList: [],
  mergeWindowMs: 3500, soundEnabled: true, notificationDurationMs: 5000,
  notificationOpacity: 90, showNotificationSummary: true,
  notificationClickBehavior: 'open-app', notifyRules: [], notifyCenterEnabled: true,
  startupEnabled: false, closeToTray: true, trayNotifications: true, autoReconnect: true,
  reconnectIntervalSeconds: 3, historyRetentionDays: 30, autoCleanupHistory: true
}
