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

export interface HistoryStorageStatus {
  /** 历史读写已停用（加密历史无法解密或损坏备份失败） */
  degraded: boolean
  reason: string | null
  corruptBackupAt: number | null
  /** 当前写入是否为系统加密格式（false = 明文落盘） */
  writeEncrypted: boolean
}

export interface AppStatus {
  connected: boolean
  wcdbReady: boolean
  wechatRunning: boolean
  hasFullConfig: boolean
  hookReady: boolean
  config: AppConfig
  /** 消息同步连续失败的原因；null = 同步正常（单次抖动不上报） */
  pushError?: string | null
  /** 本地历史持久化状态（主进程旧版本可能不返回该字段） */
  history?: HistoryStorageStatus
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

/** 主进程 notify-center:update 的增量载荷（与 electron/notifyBroadcast.ts 结构对齐） */
export interface NotifyCenterPatch {
  kind: 'patch'
  added?: NotifyCenterEntry[]
  updated?: NotifyCenterEntry[]
  removedIds?: string[]
  clear?: boolean
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
