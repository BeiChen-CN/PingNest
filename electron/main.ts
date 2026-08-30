import { app, BrowserWindow, Notification as SystemNotification, nativeTheme } from 'electron'
import type { Tray } from 'electron'
import { join } from 'path'
import { existsSync } from 'fs'
import { configService, getPublicConfig } from './services/config'
import { notificationScaleFactor } from '../shared/notificationMetrics'
import { chatService } from './services/chatService'
import { messagePushService, type MessagePushPayload } from './services/messagePushService'
import { RuleEngine } from './rules/ruleEngine'
import { keyService } from './services/keyService'
import { registerNotificationHandlers, destroyNotificationWindow, setNotificationNavigateHandler, showNotification, getNotificationWindow } from './windows/notificationWindow'
import { applyWebHardening } from './windows/webSecurity'
import { notifyCenterStore } from './services/notifyCenterStore'
import { broadcastNotifyCenterPatch } from './notifyBroadcast'
import { registerIpcHandlers } from './ipc'
import { createTray } from './tray'
import { connectAndStart, hasSavedHook } from './connection'
import { cleanupExpiredHistory, syncLoginItemSetting } from './maintenance'
import { configureFileSink, createLogger } from './logger'
import { IPC_CHANNELS } from '../shared/ipcChannels'

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let isQuitting = false
let trayHintShown = false
let historyFlushedForQuit = false
let historyCleanupTimer: ReturnType<typeof setInterval> | null = null
const logger = createLogger('main')
// 规则引擎单例在入口组装（ruleEngine 模块保持零 electron 依赖以便单测）
const ruleEngine = new RuleEngine(configService)
const launchedAtLogin = process.platform === 'win32' && process.argv.includes('--hidden')

function resolveAppIconPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'icon.ico')
    : join(__dirname, '../public/icon.ico')
}

// 深色模式跟随系统（UX-04）：渲染层走 CSS prefers-color-scheme token 覆盖，
// 这里只负责原生窗口背景色（避免暗色系统下窗口加载瞬间的白闪）。
function windowBackgroundColor(): string {
  return nativeTheme.shouldUseDarkColors ? '#14170f' : '#f3f1e6'
}

// ---------- 主窗口 ----------

function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 960,
    minHeight: 640,
    frame: false,
    backgroundColor: windowBackgroundColor(),
    show: !launchedAtLogin,
    title: 'PingNest',
    icon: resolveAppIconPath(),
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  applyWebHardening(win)

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
    const entry = notifyCenterStore.add({
      id: 'nc_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
      payload: payload as unknown as Record<string, unknown>,
      effect: (effect || {}) as Record<string, unknown>,
      receivedAt: Date.now(),
      read: false
    })
    broadcastNotifyCenterPatch({ added: [entry] })
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
    groupName: payload.groupName,
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
    sound: effect.sound,
    queueSize: cfg.notificationQueueSize,
    cardSize: cfg.notificationSize,
    sizeScale: notificationScaleFactor(cfg.notificationSize)
  }).catch((e) => logger.error('showNotification failed:', e))
}

function openMainWindowForNotification(sessionId: string): void {
  const win = ensureMainWindow()
  if (win.isMinimized()) win.restore()
  win.show()
  win.focus()
  win.webContents.send(IPC_CHANNELS.navigateToSession, sessionId)
}

function handleNotificationNavigate(sessionId: string): void {
  const normalizedSessionId = String(sessionId || '').trim()
  if (normalizedSessionId) {
    const updated = notifyCenterStore.markSessionRead(normalizedSessionId)
    if (updated.length > 0) broadcastNotifyCenterPatch({ updated })
  }

  const behavior = configService.get('notificationClickBehavior')
  if (behavior === 'none') return

  if (behavior === 'open-wechat') {
    void keyService.focusWeChatWindow().then((focused) => {
      if (focused) {
        logger.info('通知点击：已激活微信主窗口，会话=' + normalizedSessionId)
        return
      }
      logger.warn('通知点击：未找到可激活的微信主窗口，会话=' + normalizedSessionId)
      openMainWindowForNotification(sessionId)
    }).catch(() => {
      logger.warn('通知点击：激活微信窗口异常，会话=' + normalizedSessionId)
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
    // PINGNEST_LOG_FILE=1 时主进程日志落盘到 userData/logs/main.log
    if (process.env.PINGNEST_LOG_FILE === '1') {
      configureFileSink('main', join(app.getPath('userData'), 'logs'))
    }
    cleanupExpiredHistory()
    syncLoginItemSetting()
    historyCleanupTimer = setInterval(() => {
      const removed = cleanupExpiredHistory()
      if (removed.length > 0) broadcastNotifyCenterPatch({ removedIds: removed.map((entry) => entry.id) })
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
        if (!result.success) logger.warn('恢复微信监听失败:', result.error)
      })
    }

  app.on('activate', () => {
    ensureMainWindow()
  })

  // 系统主题切换：已存在的窗口同步背景色。
  // 注意必须排除透明通知窗口——setBackgroundColor 会把 transparent 窗口变成
  // 不透明（浅色主题下就是一层白色画布，圆角卡片四角露白）。
  nativeTheme.on('updated', () => {
    const color = windowBackgroundColor()
    const transparentNotification = getNotificationWindow()
    for (const win of BrowserWindow.getAllWindows()) {
      if (win.isDestroyed() || win === transparentNotification) continue
      try { win.setBackgroundColor(color) } catch { /* 个别窗口类型不支持时忽略 */ }
    }
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
  // 关闭 SQLite 句柄触发 WAL checkpoint，减少 -wal 文件残留
  notifyCenterStore.close()
  destroyNotificationWindow()
})
