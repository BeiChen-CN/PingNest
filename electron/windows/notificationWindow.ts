import { BrowserWindow, ipcMain, screen } from 'electron'
import { join } from 'path'
import { applyWebHardening } from './webSecurity'
import { IPC_CHANNELS } from '../../shared/ipcChannels'
import {
  calculateNotificationOrigin,
  calculateNotificationMaxHeight,
  calculateNotificationWidth,
  normalizeNotificationPosition,
  normalizeNotificationSize,
  normalizeNotificationStyle,
  type NotificationPosition,
  type NotificationWorkArea
} from '../../shared/notificationMetrics'

let notificationWindow: BrowserWindow | null = null
let lastNotificationData: any = null
let onNotificationNavigate: ((sessionId: string) => void) | null = null
interface NotificationLayout {
  position: NotificationPosition
  workArea: NotificationWorkArea
  padding: number
}
let lastNotificationLayout: NotificationLayout | null = null

export function setNotificationNavigateHandler(callback: (sessionId: string) => void): void {
  onNotificationNavigate = callback
}

/** 供广播函数排除通知弹窗（notify-center:update 只发给主窗口） */
export function getNotificationWindow(): BrowserWindow | null {
  return notificationWindow && !notificationWindow.isDestroyed() ? notificationWindow : null
}

export function destroyNotificationWindow(): void {
  lastNotificationData = null
  lastNotificationLayout = null
  if (!notificationWindow || notificationWindow.isDestroyed()) {
    notificationWindow = null
    return
  }
  const win = notificationWindow
  notificationWindow = null
  try {
    win.destroy()
  } catch { /* 窗口可能已被系统销毁 */ }
}

function createNotificationWindow(): BrowserWindow | null {
  if (notificationWindow && !notificationWindow.isDestroyed()) return notificationWindow

  const isDev = !!process.env.VITE_DEV_SERVER_URL
  const iconPath = isDev
    ? join(__dirname, '../public/icon.ico')
    : join(process.resourcesPath, 'icon.ico')

  const win = new BrowserWindow({
    width: 400,
    height: 126,
    type: 'toolbar',
    frame: false,
    transparent: true,
    resizable: false,
    show: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    focusable: false,
    icon: iconPath,
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  applyWebHardening(win)
  // 关闭 DWM 系统阴影：透明通知窗口显示空内容时不会再出现方形框影
  win.setHasShadow(false)
  win.setIgnoreMouseEvents(true, { forward: true })

  const loadUrl = isDev
    ? process.env.VITE_DEV_SERVER_URL + '#/notification-window'
    : 'file://' + join(__dirname, '../dist/index.html') + '#/notification-window'

  win.loadURL(loadUrl)

  win.on('closed', () => {
    notificationWindow = null
    lastNotificationLayout = null
  })

  notificationWindow = win
  return win
}

// 内容先行、显示在后：数据先推给渲染层，渲染层画好卡片回传尺寸（resize 通道）
// 时窗口才真正显示——避免空窗口先弹出一个方框、内容一秒后才闪现的割裂感。
let awaitingFirstPaint = false
let fallbackTimer: ReturnType<typeof setTimeout> | null = null

function applyLayoutAndDeliver(win: BrowserWindow, data: any): void {
  lastNotificationData = data
  const position = normalizeNotificationPosition(data.position)
  const notificationStyle = normalizeNotificationStyle(data.notificationStyle)

  // 多显示器：优先使用光标所在屏幕的工作区，回退主屏
  const cursorPoint = screen.getCursorScreenPoint()
  const targetDisplay = screen.getDisplayNearestPoint(cursorPoint) || screen.getPrimaryDisplay()
  const workArea = targetDisplay.workArea
  const stackSize = Math.max(1, Math.min(6, Math.floor(Number(data.queueSize) || 3)))
  const cardSize = normalizeNotificationSize(data.cardSize)
  const winWidth = calculateNotificationWidth(position, notificationStyle, stackSize, cardSize)
  const winHeight = 150
  const padding = 20
  lastNotificationLayout = { position, workArea: { ...workArea }, padding }
  const origin = calculateNotificationOrigin(position, winWidth, winHeight, workArea, padding)

  win.setBounds({ x: Math.floor(origin.x), y: Math.floor(origin.y), width: winWidth, height: winHeight })
  win.webContents.send(IPC_CHANNELS.notification.show, { ...data, position })
}

function present(win: BrowserWindow): void {
  win.setIgnoreMouseEvents(false)
  win.showInactive()
  win.setAlwaysOnTop(true, 'screen-saver')
}

export async function showNotification(data: any): Promise<void> {
  let win = notificationWindow
  if (!win || win.isDestroyed()) {
    win = createNotificationWindow()
  }
  if (!win) return

  applyLayoutAndDeliver(win, data)
  awaitingFirstPaint = true
  if (fallbackTimer) clearTimeout(fallbackTimer)
  // 兜底：渲染层异常导致始终未回传尺寸时，1.8s 后强制显示（shadow 已关闭，
  // 空窗口完全透明，不会出现方框），避免通知被吞。
  fallbackTimer = setTimeout(() => {
    fallbackTimer = null
    if (awaitingFirstPaint && notificationWindow && !notificationWindow.isDestroyed()) {
      awaitingFirstPaint = false
      present(notificationWindow)
    }
  }, 1800)
}

export function registerNotificationHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.notification.close, () => {
    if (notificationWindow && !notificationWindow.isDestroyed()) {
      notificationWindow.hide()
      notificationWindow.setIgnoreMouseEvents(true, { forward: true })
    }
  })

  ipcMain.on(IPC_CHANNELS.notification.ready, (event) => {
    if (lastNotificationData && notificationWindow && !notificationWindow.isDestroyed()) {
      // 渲染层（重）挂载完成：重发最新数据，等待其画好后经 resize 通道显示
      awaitingFirstPaint = true
      event.sender.send(IPC_CHANNELS.notification.show, { ...lastNotificationData, position: lastNotificationLayout?.position })
    }
  })

  ipcMain.on(IPC_CHANNELS.notification.resize, (event, { width, height }) => {
    if (!notificationWindow || notificationWindow.isDestroyed()) return
    if (event.sender !== notificationWindow.webContents) return
    const safeWidth = Math.max(80, Math.min(920, Math.round(Number(width) || 400)))
    const requestedHeight = Math.round(Number(height) || 150)
    const style = normalizeNotificationStyle(lastNotificationData?.notificationStyle)
    // 堆叠队列：上限 = 单卡上限 × 同屏卡片数，同时不超过所在工作区高度
    const stackSize = Math.max(1, Math.min(6, Math.floor(Number(lastNotificationData?.queueSize) || 3)))
    const stackMax = calculateNotificationMaxHeight(style, stackSize, normalizeNotificationSize(lastNotificationData?.cardSize))
    const workAreaCap = lastNotificationLayout
      ? Math.max(160, lastNotificationLayout.workArea.height - lastNotificationLayout.padding * 2)
      : stackMax
    const safeHeight = Math.max(80, Math.min(stackMax + 12, workAreaCap, requestedHeight))
    const layout = lastNotificationLayout
    if (!layout) {
      notificationWindow.setSize(safeWidth, safeHeight)
      return
    }
    const origin = calculateNotificationOrigin(layout.position, safeWidth, safeHeight, layout.workArea, layout.padding)
    notificationWindow.setBounds({ x: Math.floor(origin.x), y: Math.floor(origin.y), width: safeWidth, height: safeHeight })
    // 渲染层已画好卡片并回传尺寸 → 此刻才是显示窗口的正确时机（内容先行）
    if (awaitingFirstPaint && !notificationWindow.webContents.isLoading()) {
      awaitingFirstPaint = false
      if (fallbackTimer) { clearTimeout(fallbackTimer); fallbackTimer = null }
      notificationWindow.setIgnoreMouseEvents(false)
      notificationWindow.showInactive()
      notificationWindow.setAlwaysOnTop(true, 'screen-saver')
    }
  })

  // 点击导航后窗口可见性由渲染层自管理：堆叠队列里其余卡片继续展示，
  // 全部卡片退场后渲染层主动调用 notification:close 隐藏窗口。
  ipcMain.on(IPC_CHANNELS.notification.clicked, (_event, sessionId) => {
    if (onNotificationNavigate) {
      onNotificationNavigate(String(sessionId || ''))
    }
  })
}
