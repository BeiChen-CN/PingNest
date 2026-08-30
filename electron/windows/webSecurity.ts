import type { BrowserWindow } from 'electron'

/**
 * 渲染进程安全基线（两个窗口共用）：
 * - 沙箱在 webPreferences 中显式声明 sandbox: true；
 * - 这里统一拦截 window.open 与一切 JS/用户触发的导航。
 * 应用是单页 HashRouter，从不发生真实导航；loadURL 不触发 will-navigate，
 * 因此阻止全部 will-navigate 不会影响正常加载与 HMR（HMR 走 reload 而非导航）。
 */
export function applyWebHardening(win: BrowserWindow): void {
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (event) => {
    event.preventDefault()
  })
}
