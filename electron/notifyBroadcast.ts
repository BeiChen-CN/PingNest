import { BrowserWindow } from 'electron'
import { getNotificationWindow } from './windows/notificationWindow'
import type { NotifyCenterEntry } from './services/notifyCenterStore'
import { IPC_CHANNELS } from '../shared/ipcChannels'

export interface NotifyCenterPatch {
  kind: 'patch'
  /** 新增的通知记录（如一条新消息入中心） */
  added?: NotifyCenterEntry[]
  /** 已就地更新的记录（已读标记、群名回填等） */
  updated?: NotifyCenterEntry[]
  /** 被删除的记录 ID */
  removedIds?: string[]
  /** 历史被整体清空 */
  clear?: boolean
}

/**
 * 通知中心的增量广播：发给主窗口（排除透明通知弹窗）。
 * 只携带变更条目——万条级历史时单条消息的广播 payload 从全量数组的 MB 级
 * 降到单条记录的 KB 级；渲染层按 ID 合并，形状异常时回退全量拉取。
 */
export function broadcastNotifyCenterPatch(patch: Omit<NotifyCenterPatch, 'kind'>): void {
  const payload: NotifyCenterPatch = { kind: 'patch', ...patch }
  const excluded = getNotificationWindow()
  for (const win of BrowserWindow.getAllWindows()) {
    if (win.isDestroyed() || win === excluded) continue
    win.webContents.send(IPC_CHANNELS.notifyCenter.update, payload)
  }
}
