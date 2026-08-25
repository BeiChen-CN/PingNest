import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('electronAPI', {
  notification: {
    onShow: (callback: (data: any) => void) => {
      const listener = (_event: any, data: any) => callback(data)
      ipcRenderer.on('notification:show', listener)
      return () => ipcRenderer.removeListener('notification:show', listener)
    },
    ready: () => ipcRenderer.send('notification:ready'),
    close: () => ipcRenderer.invoke('notification:close'),
    click: (sessionId: string) => ipcRenderer.send('notification-clicked', sessionId),
    resize: (width: number, height: number) => ipcRenderer.send('notification:resize', { width, height })
  },
  app: {
    getStatus: () => ipcRenderer.invoke('app:getStatus'),
    connect: () => ipcRenderer.invoke('app:connect'),
    reconnect: () => ipcRenderer.invoke('app:reconnect'),
    autoSetup: () => ipcRenderer.invoke('app:autoSetup'),
    hook: () => ipcRenderer.invoke('app:hook'),
    removeHook: () => ipcRenderer.invoke('app:removeHook'),
    onHookProgress: (callback: (progress: any) => void) => {
      const listener = (_event: any, progress: any) => callback(progress)
      ipcRenderer.on('app:hookProgress', listener)
      return () => ipcRenderer.removeListener('app:hookProgress', listener)
    },
    disconnect: () => ipcRenderer.invoke('app:disconnect'),
    minimize: () => ipcRenderer.send('window:minimize'),
    toggleMaximize: () => ipcRenderer.send('window:toggleMaximize'),
    closeWindow: () => ipcRenderer.send('window:close')
  },
  config: {
    get: () => ipcRenderer.invoke('config:get'),
    set: (key: string, value: unknown) => ipcRenderer.invoke('config:set', key, value)
  },
  notifyCenter: {
    list: () => ipcRenderer.invoke('notify:list'),
    markRead: (id: string) => ipcRenderer.invoke('notify:markRead', id),
    markSessionRead: (sessionId: string) => ipcRenderer.invoke('notify:markSessionRead', sessionId),
    remove: (id: string) => ipcRenderer.invoke('notify:remove', id),
    clear: () => ipcRenderer.invoke('notify:clear'),
    onUpdate: (callback: (entries: any[]) => void) => {
      const listener = (_event: any, entries: any[]) => callback(entries)
      ipcRenderer.on('notify-center:update', listener)
      return () => ipcRenderer.removeListener('notify-center:update', listener)
    }
  },
  onNavigateToSession: (callback: (sessionId: string) => void) => {
    const listener = (_event: any, sessionId: string) => callback(sessionId)
    ipcRenderer.on('navigate-to-session', listener)
    return () => ipcRenderer.removeListener('navigate-to-session', listener)
  }
})
