import { BrowserWindow } from 'electron'
import { getNotificationWindow } from './windows/notificationWindow'
import { notifyCenterStore } from './services/notifyCenterStore'

/**
 * 通知中心的变更广播：发给主窗口（排除透明通知弹窗）。
 * 之前实现在 main.ts 里用 `win !== mainWindow` 过滤，主窗口引用一散出去
 * 就到处传；改为按"排除通知窗口"过滤，语义等价且无状态耦合。
 */
export function broadcastNotifyCenter(): void {
  const excluded = getNotificationWindow()
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed() || win === excluded) continue
    win.webContents.send('notify-center:update', notifyCenterStore.getEntries())
  }
}
