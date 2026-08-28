import { BrowserWindow, ipcMain, screen } from 'electron'
import { join } from 'path'
import {
  calculateNotificationOrigin,
  calculateNotificationMaxHeight,
  calculateNotificationWidth,
  normalizeNotificationPosition,
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
      nodeIntegration: false
    }
  })

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

export async function showNotification(data: any): Promise<void> {
  let win = notificationWindow
  if (!win || win.isDestroyed()) {
    win = createNotificationWindow()
  }
  if (!win) return

  if (win.webContents.isLoading()) {
    win.once('ready-to-show', () => {
      showAndSend(win as BrowserWindow, data)
    })
  } else {
    showAndSend(win, data)
  }
}

async function showAndSend(win: BrowserWindow, data: any): Promise<void> {
  lastNotificationData = data
  const position = normalizeNotificationPosition(data.position)
  const notificationStyle = normalizeNotificationStyle(data.notificationStyle)

  // 多显示器：优先使用光标所在屏幕的工作区，回退主屏
  const cursorPoint = screen.getCursorScreenPoint()
  const targetDisplay = screen.getDisplayNearestPoint(cursorPoint) || screen.getPrimaryDisplay()
  const workArea = targetDisplay.workArea
  const winWidth = calculateNotificationWidth(position, notificationStyle)
  const winHeight = 150
  const padding = 20
  lastNotificationLayout = { position, workArea: { ...workArea }, padding }
  const origin = calculateNotificationOrigin(position, winWidth, winHeight, workArea, padding)

  win.setBounds({ x: Math.floor(origin.x), y: Math.floor(origin.y), width: winWidth, height: winHeight })
  win.setIgnoreMouseEvents(false)
  win.showInactive()
  win.setAlwaysOnTop(true, 'screen-saver')

  win.webContents.send('notification:show', { ...data, position })
}

export function registerNotificationHandlers(): void {
  ipcMain.handle('notification:show', (_, data) => {
    showNotification(data)
  })

  ipcMain.handle('notification:close', () => {
    if (notificationWindow && !notificationWindow.isDestroyed()) {
      notificationWindow.hide()
      notificationWindow.setIgnoreMouseEvents(true, { forward: true })
    }
  })

  ipcMain.on('notification:ready', (event) => {
    if (lastNotificationData && notificationWindow && !notificationWindow.isDestroyed()) {
      notificationWindow.webContents.send('notification:show', lastNotificationData)
    }
  })

  ipcMain.on('notification:resize', (event, { width, height }) => {
    if (!notificationWindow || notificationWindow.isDestroyed()) return
    if (event.sender !== notificationWindow.webContents) return
    const safeWidth = Math.max(320, Math.min(500, Math.round(Number(width) || 400)))
    const requestedHeight = Math.round(Number(height) || 150)
    const style = normalizeNotificationStyle(lastNotificationData?.notificationStyle)
    const safeHeight = Math.max(80, Math.min(calculateNotificationMaxHeight(style), requestedHeight))
    const layout = lastNotificationLayout
    if (!layout) {
      notificationWindow.setSize(safeWidth, safeHeight)
      return
    }
    const origin = calculateNotificationOrigin(layout.position, safeWidth, safeHeight, layout.workArea, layout.padding)
    notificationWindow.setBounds({ x: Math.floor(origin.x), y: Math.floor(origin.y), width: safeWidth, height: safeHeight })
  })

  ipcMain.on('notification-clicked', (_event, sessionId) => {
    if (onNotificationNavigate) {
      onNotificationNavigate(String(sessionId || ''))
    }
    if (notificationWindow && !notificationWindow.isDestroyed()) {
      notificationWindow.hide()
      notificationWindow.setIgnoreMouseEvents(true, { forward: true })
    }
  })
}
