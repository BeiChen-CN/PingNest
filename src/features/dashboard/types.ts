export type PageId = 'overview' | 'history' | 'rules' | 'appearance' | 'settings' | 'about'

// 配置类型与默认值统一维护在 shared/appConfig.ts（与主进程持久化 schema 同源）。
import { DEFAULT_CONFIG, type AppConfig } from '../../../shared/appConfig'
export { DEFAULT_CONFIG }
export type {
  AppConfig,
  NotificationClickBehavior,
  NotificationFilterMode,
  NotificationPosition,
  NotificationStyle,
  NotifyRule
} from '../../../shared/appConfig'

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
