import type { AppConfig, AppStatus, HookProgress, NotifyCenterEntry, NotifyCenterPatch } from '../features/dashboard/types'
import type { NotificationData } from '../components/NotificationToast'

export {}
declare global {
  interface Window {
    electronAPI?: {
      notification: {
        onShow: (callback: (data: NotificationData) => void) => (() => void) | undefined
        ready: () => void
        close: () => Promise<void>
        click: (sessionId: string) => void
        resize: (width: number, height: number) => void
      }
      app: {
        getStatus: () => Promise<AppStatus>
      connect: () => Promise<{ success: boolean; error?: string }>
      reconnect: () => Promise<{ success: boolean; error?: string }>
        hook: () => Promise<{ success: boolean; error?: string; account?: string }>
        removeHook: () => Promise<{ success: boolean; error?: string }>
        onHookProgress: (callback: (progress: HookProgress) => void) => (() => void) | undefined
        disconnect: () => Promise<{ success: boolean }>
        minimize: () => void
        toggleMaximize: () => void
        closeWindow: () => void
      }
      config: {
        get: () => Promise<AppConfig>
        set: <K extends keyof AppConfig>(key: K, value: AppConfig[K]) => Promise<{ success: boolean; error?: string }>
      }
      notifyCenter: {
        list: () => Promise<NotifyCenterEntry[]>
        markRead: (id: string) => Promise<{ success: boolean }>
        markSessionRead: (sessionId: string) => Promise<{ success: boolean }>
        remove: (id: string) => Promise<{ success: boolean }>
        clear: () => Promise<{ success: boolean }>
        onUpdate: (callback: (patch: NotifyCenterPatch) => void) => (() => void) | undefined
      }
      onNavigateToSession: (callback: (sessionId: string) => void) => (() => void) | undefined
    }
  }
}
