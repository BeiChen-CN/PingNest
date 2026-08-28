import { app, BrowserWindow, ipcMain } from 'electron'
import { configService, getPublicConfig, type ConfigSchema } from '../services/config'
import { keyService } from '../services/keyService'
import { chatService } from '../services/chatService'
import { dbWorkerClient } from '../services/dbWorkerClient'
import { messagePushService } from '../services/messagePushService'
import { notifyCenterStore } from '../services/notifyCenterStore'
import { connectAndStart, hasSavedHook, hookAndConnect, reconnectAndStart, removeSavedHook } from '../connection'
import { broadcastNotifyCenter } from '../notifyBroadcast'
import { cleanupExpiredHistory } from '../maintenance'
import { validateConfigValue } from './configValidation'

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

function registerAppHandlers(): void {
  ipcMain.handle('app:getStatus', async () => {
    const cfg = configService.getAll()
    const wechatPid = await keyService.findWeChatPid(0)
    const workerReady = await Promise.race([
      dbWorkerClient.isReady().catch(() => ({ ready: false })),
      new Promise<{ ready: boolean }>((resolve) => setTimeout(() => resolve({ ready: false }), 1500))
    ])
    return {
      connected: chatService.isConnected(),
      wcdbReady: workerReady.ready === true,
      wechatRunning: wechatPid !== null,
      hasFullConfig: !!(cfg.dbPath && cfg.decryptKey && cfg.myWxid),
      hookReady: hasSavedHook(cfg),
      config: getPublicConfig(cfg)
    }
  })

  ipcMain.handle('app:connect', async () => {
    return connectAndStart()
  })

  ipcMain.handle('app:reconnect', async () => {
    return reconnectAndStart()
  })

  ipcMain.handle('app:hook', async (event) => {
    return hookAndConnect((progress) => event.sender.send('app:hookProgress', progress))
  })

  ipcMain.handle('app:removeHook', async () => {
    await removeSavedHook()
    return { success: true }
  })

  ipcMain.handle('app:disconnect', async () => {
    messagePushService.stop()
    await chatService.close()
    return { success: true }
  })
}

function registerConfigHandlers(): void {
  ipcMain.handle('config:get', async () => {
    return getPublicConfig(configService.getAll())
  })

  ipcMain.handle('config:set', async (_event, key: keyof ConfigSchema, value: unknown) => {
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
        if (cleanupExpiredHistory() > 0) broadcastNotifyCenter()
      }
      return { success: true }
    } catch (e) {
      return { success: false, error: String(e) }
    }
  })
}

function registerNotifyHandlers(): void {
  ipcMain.handle('notify:list', async () => {
    return notifyCenterStore.getEntries()
  })

  ipcMain.handle('notify:markRead', async (_event, id: string) => {
    notifyCenterStore.markRead(String(id || ''))
    broadcastNotifyCenter()
    return { success: true }
  })

  ipcMain.handle('notify:markSessionRead', async (_event, sessionId: string) => {
    notifyCenterStore.markSessionRead(String(sessionId || ''))
    broadcastNotifyCenter()
    return { success: true }
  })

  ipcMain.handle('notify:remove', async (_event, id: string) => {
    notifyCenterStore.remove(String(id || ''))
    broadcastNotifyCenter()
    return { success: true }
  })

  ipcMain.handle('notify:clear', async () => {
    notifyCenterStore.clear()
    broadcastNotifyCenter()
    return { success: true }
  })
}

function registerWindowHandlers(deps: IpcDeps): void {
  ipcMain.on('window:minimize', () => deps.getMainWindow()?.minimize())
  ipcMain.on('window:toggleMaximize', () => {
    const win = deps.getMainWindow()
    if (!win) return
    win.isMaximized() ? win.unmaximize() : win.maximize()
  })
  ipcMain.on('window:close', () => deps.getMainWindow()?.close())
}
