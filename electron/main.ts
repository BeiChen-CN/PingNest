import { app, BrowserWindow, Notification as SystemNotification } from 'electron'
import type { Tray } from 'electron'
import { join } from 'path'
import { existsSync } from 'fs'
import { configService, getPublicConfig } from './services/config'
import { chatService } from './services/chatService'
import { messagePushService, type MessagePushPayload } from './services/messagePushService'
import { ruleEngine } from './rules/ruleEngine'
import { keyService } from './services/keyService'
import { registerNotificationHandlers, destroyNotificationWindow, setNotificationNavigateHandler, showNotification } from './windows/notificationWindow'
import { notifyCenterStore } from './services/notifyCenterStore'
import { broadcastNotifyCenter } from './notifyBroadcast'
import { registerIpcHandlers } from './ipc'
import { createTray } from './tray'
import { connectAndStart, hasSavedHook } from './connection'
import { cleanupExpiredHistory, syncLoginItemSetting } from './maintenance'

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let isQuitting = false
let trayHintShown = false
let historyFlushedForQuit = false
let historyCleanupTimer: ReturnType<typeof setInterval> | null = null
const launchedAtLogin = process.platform === 'win32' && process.argv.includes('--hidden')

function resolveAppIconPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'icon.ico')
    : join(__dirname, '../public/icon.ico')
}

// ---------- 主窗口 ----------

function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 960,
    minHeight: 640,
    frame: false,
    backgroundColor: '#F6F8F7',
    show: !launchedAtLogin,
    title: 'PingNest',
    icon: resolveAppIconPath(),
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  const devUrl = process.env.VITE_DEV_SERVER_URL
  if (devUrl) {
    win.loadURL(devUrl)
  } else {
    win.loadFile(join(__dirname, '../dist/index.html'))
  }

  win.on('closed', () => {
    mainWindow = null
  })
  win.on('close', (event) => {
    if (isQuitting) return
    if (configService.get('closeToTray') && tray && !tray.isDestroyed()) {
      event.preventDefault()
      win.hide()
      if (!trayHintShown && configService.get('trayNotifications') && SystemNotification.isSupported()) {
        trayHintShown = true
        new SystemNotification({
          title: 'PingNest 仍在运行',
          body: '微信通知监听已转入系统托盘。'
        }).show()
      }
      return
    }
    isQuitting = true
    app.quit()
  })
  return win
}

function ensureMainWindow(): BrowserWindow {
  if (!mainWindow || mainWindow.isDestroyed()) {
    mainWindow = createMainWindow()
  }
  return mainWindow
}

function showMainWindow(): void {
  const win = ensureMainWindow()
  win.show()
  win.focus()
}

function toggleMainWindow(): void {
  const win = ensureMainWindow()
  if (win.isVisible()) {
    win.hide()
  } else {
    win.show()
    win.focus()
  }
}

// ---------- 通知分发 ----------

function handleMessagePush(payload: MessagePushPayload): void {
  const effect = ruleEngine.match(payload)
  const cfg = configService.getAll()

  // 通知中心记录（持久化）
  if (cfg.notifyCenterEnabled) {
    notifyCenterStore.add({
      id: 'nc_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
      payload: payload as unknown as Record<string, unknown>,
      effect: (effect || {}) as Record<string, unknown>,
      receivedAt: Date.now(),
      read: false
    })
    broadcastNotifyCenter()
  }

  // 弹窗
  if (effect.muted) return
  if (!cfg.notificationEnabled) return

  const title = payload.groupName
    ? payload.sourceName + ' @ ' + payload.groupName
    : payload.sourceName
  const position = effect.position || cfg.notificationPosition
  const durationMs = effect.durationMs || cfg.notificationDurationMs || 5000

  showNotification({
    sessionId: payload.sessionId,
    sessionType: payload.sessionType,
    title,
    content: payload.content,
    avatarUrl: payload.avatarUrl,
    timestamp: payload.timestamp,
    event: payload.event,
    position,
    notificationStyle: cfg.notificationStyle,
    accentColor: effect.accentColor,
    durationMs,
    mergeWindowMs: cfg.mergeWindowMs,
    opacity: cfg.notificationOpacity,
    showSummary: cfg.showNotificationSummary,
    clickBehavior: cfg.notificationClickBehavior,
    soundEnabled: cfg.soundEnabled,
    sound: effect.sound
  }).catch((e) => console.error('[main] showNotification failed:', e))
}

function openMainWindowForNotification(sessionId: string): void {
  const win = ensureMainWindow()
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
  win.webContents.send('navigate-to-session', sessionId)
}

function handleNotificationNavigate(sessionId: string): void {
  const normalizedSessionId = String(sessionId || '').trim()
  if (normalizedSessionId) {
    notifyCenterStore.markSessionRead(normalizedSessionId)
    broadcastNotifyCenter()
  }

  const behavior = configService.get('notificationClickBehavior')
  if (behavior === 'none') return

  if (behavior === 'open-wechat') {
    void keyService.focusWeChatWindow().then((focused) => {
      if (focused) {
        console.info('[main] 通知点击：已激活微信主窗口，会话=' + normalizedSessionId)
        return
      }
      console.warn('[main] 通知点击：未找到可激活的微信主窗口，会话=' + normalizedSessionId)
      openMainWindowForNotification(sessionId)
    }).catch(() => {
      console.warn('[main] 通知点击：激活微信窗口异常，会话=' + normalizedSessionId)
      openMainWindowForNotification(sessionId)
    })
    return
  }

  openMainWindowForNotification(sessionId)
}

// ---------- 生命周期 ----------

const gotSingleInstanceLock = app.requestSingleInstanceLock()
if (!gotSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const win = ensureMainWindow()
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
  })

  app.whenReady().then(async () => {
    registerNotificationHandlers()
    registerIpcHandlers({ getMainWindow: () => mainWindow })
    await notifyCenterStore.init()
    cleanupExpiredHistory()
    syncLoginItemSetting()
    historyCleanupTimer = setInterval(() => {
      if (cleanupExpiredHistory() > 0) broadcastNotifyCenter()
    }, 60 * 60 * 1000)
    mainWindow = createMainWindow()
    tray = createTray({
      resolveIconPath: resolveAppIconPath,
      showMainWindow,
      toggleMainWindow,
      reconnect: () => void connectAndStart(),
      quit: () => {
        isQuitting = true
        app.quit()
      }
    })

    setNotificationNavigateHandler(handleNotificationNavigate)

    messagePushService.on('message.new', (payload: MessagePushPayload) => handleMessagePush(payload))
    messagePushService.on('message.revoke', (payload: MessagePushPayload) => handleMessagePush(payload))

    // 数据库监控事件 → 消息推送服务
    chatService.addDbMonitorListener((type, json) => {
      messagePushService.handleDbMonitorChange(type, json)
    })

    if (hasSavedHook(configService.getAll())) {
      void connectAndStart().then((result) => {
        if (!result.success) console.warn('[main] 恢复微信监听失败:', result.error)
      })
    }

    app.on('activate', () => {
      ensureMainWindow()
    })
  })

  app.on('before-quit', (event) => {
    isQuitting = true
    if (historyFlushedForQuit) return
    event.preventDefault()
    historyFlushedForQuit = true
    if (historyCleanupTimer) {
      clearInterval(historyCleanupTimer)
      historyCleanupTimer = null
    }
    messagePushService.stop()
    cleanupExpiredHistory()
    void notifyCenterStore.flush().finally(() => app.quit())
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      // 常驻托盘，不退出
    }
  })
}

app.on('quit', () => {
  messagePushService.stop()
  void chatService.close()
  destroyNotificationWindow()
})
