import { app } from 'electron'
import { configService } from './services/config'
import { notifyCenterStore } from './services/notifyCenterStore'

/** 按保留期清理过期通知历史，返回清理条数。 */
export function cleanupExpiredHistory(): number {
  if (!configService.get('autoCleanupHistory')) return 0
  return notifyCenterStore.cleanupOlderThan(configService.get('historyRetentionDays'))
}

/** 把开机自启设置同步到系统登录项（仅打包版生效）。 */
export function syncLoginItemSetting(): void {
  if (!app.isPackaged) return
  const args = process.platform === 'win32' ? ['--hidden'] : undefined
  app.setLoginItemSettings({
    openAtLogin: configService.get('startupEnabled') === true,
    args
  })
}
