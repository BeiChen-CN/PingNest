import { Menu, Tray, nativeImage } from 'electron'
import { existsSync } from 'fs'

interface TrayDeps {
  resolveIconPath: () => string
  /** 打开主界面（show + focus） */
  showMainWindow: () => void
  /** 托盘图标点击：可见则隐藏，否则显示（保持驻留交互习惯） */
  toggleMainWindow: () => void
  reconnect: () => void
  quit: () => void
}

/**
 * 系统托盘：驻留入口与快捷操作。
 * 行为依赖通过参数注入，避免反向依赖 main.ts 的内部状态。
 */
export function createTray(deps: TrayDeps): Tray | null {
  const iconPath = deps.resolveIconPath()
  if (!existsSync(iconPath)) {
    console.error('[main] 托盘图标不存在:', iconPath)
    return null
  }
  const icon = nativeImage.createFromPath(iconPath)
  if (icon.isEmpty()) {
    console.error('[main] 托盘图标加载失败:', iconPath)
    return null
  }
  const tray = new Tray(icon)
  tray.setToolTip('PingNest 微信通知伴侣')

  const menu = Menu.buildFromTemplate([
    {
      label: '打开主界面',
      click: deps.showMainWindow
    },
    {
      label: '重新连接微信',
      click: deps.reconnect
    },
    { type: 'separator' },
    {
      label: '退出',
      click: deps.quit
    }
  ])
  tray.setContextMenu(menu)
  tray.on('click', deps.toggleMainWindow)
  return tray
}
