import { app, BrowserWindow, ipcMain } from 'electron'
import { configService, getPublicConfig, type ConfigSchema } from '../services/config'
import { keyService } from '../services/keyService'
import { chatService } from '../services/chatService'
import { dbWorkerClient } from '../services/dbWorkerClient'
import { messagePushService } from '../services/messagePushService'
import { notifyCenterStore } from '../services/notifyCenterStore'
import { connectAndStart, hasSavedHook, hookAndConnect, reconnectAndStart, removeSavedHook } from '../connection'
import { broadcastNotifyCenterPatch } from '../notifyBroadcast'
import { cleanupExpiredHistory } from '../maintenance'
import { validateConfigValue } from './configValidation'
import { IPC_CHANNELS } from '../../shared/ipcChannels'

interface IpcDeps {
  getMainWindow: () => BrowserWindow | null
}

/**
 * IPC handler 注册，按域分组：app（连接状态）、config（配置读写）、
 * notify（通知中心）、window（主窗口控制）。
 */
export function registerIpcHandlers(deps: IpcDeps): void {
  registerAppHandlers()
  registerConfigHandlers()
  registerNotifyHandlers()
  registerWindowHandlers(deps)
}

// 微信 PID 查询走 tasklist 子进程，开销不低；状态接口被渲染层高频轮询，
// 这里做 10 秒 TTL 缓存（通知点击激活窗口走 keyService 的独立路径，不受影响）。
let wechatPidCache: { pid: number | null; checkedAt: number } | null = null
const WECHAT_PID_CACHE_TTL_MS = 10_000

async function findWeChatPidCached(): Promise<number | null> {
  const now = Date.now()
  if (wechatPidCache && now - wechatPidCache.checkedAt < WECHAT_PID_CACHE_TTL_MS) {
    return wechatPidCache.pid
  }
  const pid = await keyService.findWeChatPid(0)
  wechatPidCache = { pid, checkedAt: now }
  return pid
}

function registerAppHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.app.getStatus, async () => {
    const cfg = configService.getAll()
    const wechatPid = await findWeChatPidCached()
    const workerReady = await Promise.race([
      dbWorkerClient.isReady().catch(() => ({ ready: false })),
      new Promise<{ ready: boolean }>((resolve) => setTimeout(() => resolve({ ready: false }), 1500))
    ])
    const hookReady = hasSavedHook(cfg)
    return {
      connected: chatService.isConnected(),
      wcdbReady: workerReady.ready === true,
      wechatRunning: wechatPid !== null,
      hasFullConfig: hookReady,
      hookReady,
      pushError: messagePushService.getDegradedReason(),
      history: notifyCenterStore.getPersistenceStatus(),
      config: getPublicConfig(cfg)
    }
  })

  ipcMain.handle(IPC_CHANNELS.app.connect, async () => {
    return connectAndStart()
  })

  ipcMain.handle(IPC_CHANNELS.app.reconnect, async () => {
    return reconnectAndStart()
  })

  ipcMain.handle(IPC_CHANNELS.app.hook, async (event) => {
    return hookAndConnect((progress) => event.sender.send(IPC_CHANNELS.app.hookProgress, progress))
  })

  ipcMain.handle(IPC_CHANNELS.app.removeHook, async () => {
    await removeSavedHook()
    return { success: true }
  })

  ipcMain.handle(IPC_CHANNELS.app.disconnect, async () => {
    messagePushService.stop()
    await chatService.close()
    return { success: true }
  })
}

function registerConfigHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.config.get, async () => {
    return getPublicConfig(configService.getAll())
  })

  ipcMain.handle(IPC_CHANNELS.config.set, async (_event, key: keyof ConfigSchema, value: unknown) => {
    try {
      const validationError = validateConfigValue(key, value)
      if (validationError) return { success: false, error: validationError }
      const previousValue = configService.get(key)
      configService.set(key, value as never)
      if (key === 'startupEnabled') {
        const loginItemArgs = process.platform === 'win32' ? ['--hidden'] : undefined
        app.setLoginItemSettings({ openAtLogin: value === true, args: loginItemArgs })
        const loginItemSettings = app.getLoginItemSettings({ args: loginItemArgs })
        if (app.isPackaged && loginItemSettings.openAtLogin !== (value === true)) {
          configService.set(key, previousValue as never)
          return { success: false, error: '系统未能应用开机启动设置' }
        }
      }
      if (key === 'notificationEnabled' || key === 'notifyCenterEnabled' || key === 'dbPath' || key === 'decryptKey' || key === 'myWxid') {
        messagePushService.handleConfigChanged()
      }
      if (key === 'autoReconnect' || key === 'reconnectIntervalSeconds') {
        await chatService.updateMonitorOptions()
        messagePushService.handleReconnectOptionsChanged()
      }
      if (key === 'autoCleanupHistory' || key === 'historyRetentionDays') {
        const removed = cleanupExpiredHistory()
        if (removed.length > 0) broadcastNotifyCenterPatch({ removedIds: removed.map((entry) => entry.id) })
      }
      return { success: true }
    } catch (e) {
      return { success: false, error: String(e) }
    }
  })
}

function registerNotifyHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.notifyCenter.list, async () => {
    return notifyCenterStore.getEntries()
  })

  ipcMain.handle(IPC_CHANNELS.notifyCenter.markRead, async (_event, id: string) => {
    const updated = notifyCenterStore.markRead(String(id || ''))
    if (updated) broadcastNotifyCenterPatch({ updated: [updated] })
    return { success: true }
  })

  ipcMain.handle(IPC_CHANNELS.notifyCenter.markSessionRead, async (_event, sessionId: string) => {
    const updated = notifyCenterStore.markSessionRead(String(sessionId || ''))
    if (updated.length > 0) broadcastNotifyCenterPatch({ updated })
    return { success: true }
  })

  ipcMain.handle(IPC_CHANNELS.notifyCenter.remove, async (_event, id: string) => {
    const removedId = notifyCenterStore.remove(String(id || ''))
    if (removedId) broadcastNotifyCenterPatch({ removedIds: [removedId] })
    return { success: true }
  })

  ipcMain.handle(IPC_CHANNELS.notifyCenter.clear, async () => {
    notifyCenterStore.clear()
    broadcastNotifyCenterPatch({ clear: true })
    return { success: true }
  })
}

function registerWindowHandlers(deps: IpcDeps): void {
  ipcMain.on(IPC_CHANNELS.window.minimize, () => deps.getMainWindow()?.minimize())
  ipcMain.on(IPC_CHANNELS.window.toggleMaximize, () => {
    const win = deps.getMainWindow()
    if (!win) return
    win.isMaximized() ? win.unmaximize() : win.maximize()
  })
  ipcMain.on(IPC_CHANNELS.window.close, () => deps.getMainWindow()?.close())
}
