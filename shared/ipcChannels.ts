/**
 * IPC 通道名单一来源：preload（渲染侧）与 ipcMain（主进程侧）都从这里引用，
 * 删除或改名通道时 typecheck 直接报错，避免三处手写字符串漂移。
 * 本文件必须保持零依赖（主进程/渲染层/构建均可直接使用）。
 */
export const IPC_CHANNELS = {
  /** 通知弹窗（主进程 ↔ 通知窗口） */
  notification: {
    /** 主进程 → 通知窗口：展示一条通知 */
    show: 'notification:show',
    /** 通知窗口 → 主进程：渲染就绪（主进程补发 lastNotificationData） */
    ready: 'notification:ready',
    close: 'notification:close',
    clicked: 'notification-clicked',
    resize: 'notification:resize'
  },
  app: {
    getStatus: 'app:getStatus',
    connect: 'app:connect',
    reconnect: 'app:reconnect',
    hook: 'app:hook',
    /** 主进程 → 渲染层：Hook 进度推送 */
    hookProgress: 'app:hookProgress',
    removeHook: 'app:removeHook',
    disconnect: 'app:disconnect'
  },
  window: {
    minimize: 'window:minimize',
    toggleMaximize: 'window:toggleMaximize',
    close: 'window:close'
  },
  config: {
    get: 'config:get',
    set: 'config:set'
  },
  notifyCenter: {
    list: 'notify:list',
    markRead: 'notify:markRead',
    markSessionRead: 'notify:markSessionRead',
    remove: 'notify:remove',
    clear: 'notify:clear',
    /** 主进程 → 渲染层：通知中心增量补丁（见 notifyBroadcast.ts） */
    update: 'notify-center:update'
  },
  /** 主进程 → 主窗口：点击通知后定位历史会话 */
  navigateToSession: 'navigate-to-session'
} as const
