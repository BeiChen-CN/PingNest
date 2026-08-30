import { contextBridge, ipcRenderer } from 'electron'
import { IPC_CHANNELS } from '../shared/ipcChannels'

contextBridge.exposeInMainWorld('electronAPI', {
  notification: {
    onShow: (callback: (data: any) => void) => {
      const listener = (_event: any, data: any) => callback(data)
      ipcRenderer.on(IPC_CHANNELS.notification.show, listener)
      return () => ipcRenderer.removeListener(IPC_CHANNELS.notification.show, listener)
    },
    ready: () => ipcRenderer.send(IPC_CHANNELS.notification.ready),
    close: () => ipcRenderer.invoke(IPC_CHANNELS.notification.close),
    click: (sessionId: string) => ipcRenderer.send(IPC_CHANNELS.notification.clicked, sessionId),
    resize: (width: number, height: number) => ipcRenderer.send(IPC_CHANNELS.notification.resize, { width, height })
  },
  app: {
    getStatus: () => ipcRenderer.invoke(IPC_CHANNELS.app.getStatus),
    connect: () => ipcRenderer.invoke(IPC_CHANNELS.app.connect),
    reconnect: () => ipcRenderer.invoke(IPC_CHANNELS.app.reconnect),
    hook: () => ipcRenderer.invoke(IPC_CHANNELS.app.hook),
    removeHook: () => ipcRenderer.invoke(IPC_CHANNELS.app.removeHook),
    onHookProgress: (callback: (progress: any) => void) => {
      const listener = (_event: any, progress: any) => callback(progress)
      ipcRenderer.on(IPC_CHANNELS.app.hookProgress, listener)
      return () => ipcRenderer.removeListener(IPC_CHANNELS.app.hookProgress, listener)
    },
    disconnect: () => ipcRenderer.invoke(IPC_CHANNELS.app.disconnect),
    minimize: () => ipcRenderer.send(IPC_CHANNELS.window.minimize),
    toggleMaximize: () => ipcRenderer.send(IPC_CHANNELS.window.toggleMaximize),
    closeWindow: () => ipcRenderer.send(IPC_CHANNELS.window.close)
  },
  config: {
    get: () => ipcRenderer.invoke(IPC_CHANNELS.config.get),
    set: (key: string, value: unknown) => ipcRenderer.invoke(IPC_CHANNELS.config.set, key, value)
  },
  notifyCenter: {
    list: () => ipcRenderer.invoke(IPC_CHANNELS.notifyCenter.list),
    markRead: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.notifyCenter.markRead, id),
    markSessionRead: (sessionId: string) => ipcRenderer.invoke(IPC_CHANNELS.notifyCenter.markSessionRead, sessionId),
    remove: (id: string) => ipcRenderer.invoke(IPC_CHANNELS.notifyCenter.remove, id),
    clear: () => ipcRenderer.invoke(IPC_CHANNELS.notifyCenter.clear),
    onUpdate: (callback: (entries: any[]) => void) => {
      const listener = (_event: any, entries: any[]) => callback(entries)
      ipcRenderer.on(IPC_CHANNELS.notifyCenter.update, listener)
      return () => ipcRenderer.removeListener(IPC_CHANNELS.notifyCenter.update, listener)
    }
  },
  onNavigateToSession: (callback: (sessionId: string) => void) => {
    const listener = (_event: any, sessionId: string) => callback(sessionId)
    ipcRenderer.on(IPC_CHANNELS.navigateToSession, listener)
    return () => ipcRenderer.removeListener(IPC_CHANNELS.navigateToSession, listener)
  }
})
