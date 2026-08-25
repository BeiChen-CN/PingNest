import { app, BrowserWindow, Tray, Menu, Notification as SystemNotification, ipcMain, nativeImage, utilityProcess } from 'electron'
import { join } from 'path'
import { existsSync } from 'fs'
import { configService, type ConfigSchema } from './services/config'
import { dbPathService } from './services/dbPathService'
import { keyService } from './services/keyService'
import { chatService } from './services/chatService'
import { dbWorkerClient } from './services/dbWorkerClient'
import { messagePushService, type MessagePushPayload } from './services/messagePushService'
import { ruleEngine, type RuleEffect } from './rules/ruleEngine'
import { registerNotificationHandlers, destroyNotificationWindow, setNotificationNavigateHandler, showNotification } from './windows/notificationWindow'
import { notifyCenterStore } from './services/notifyCenterStore'
import { normalizeDisplayName } from './services/displayName'

let mainWindow: BrowserWindow | null = null
let tray: Tray | null = null
let isQuitting = false
let trayHintShown = false
let historyFlushedForQuit = false
let hookInProgress = false
let historyCleanupTimer: ReturnType<typeof setInterval> | null = null

type HookStage = 'detecting' | 'waiting-wechat' | 'hooking' | 'verifying' | 'success' | 'error'
interface HookProgress {
  stage: HookStage
  message: string
}

function resolveAppIconPath(): string {
  return app.isPackaged
    ? join(process.resourcesPath, 'icon.ico')
    : join(__dirname, '../public/icon.ico')
}

// ---------- 窗口 ----------

function createMainWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1180,
    height: 760,
    minWidth: 960,
    minHeight: 640,
    frame: false,
    backgroundColor: '#F6F8F7',
    title: 'PingNest',
    icon: resolveAppIconPath(),
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  })

  const devUrl = process.env.VITE_DEV_SERVER_URL
  if (devUrl) {
    win.loadURL(devUrl)
  } else {
    win.loadFile(join(__dirname, '../dist/index.html'))
  }

  win.on('closed', () => {
    mainWindow = null
  })
  win.on('close', (event) => {
    if (isQuitting) return
    if (configService.get('closeToTray') && tray && !tray.isDestroyed()) {
      event.preventDefault()
      win.hide()
      if (!trayHintShown && configService.get('trayNotifications') && SystemNotification.isSupported()) {
        trayHintShown = true
        new SystemNotification({
          title: 'PingNest 仍在运行',
          body: '微信通知监听已转入系统托盘。'
        }).show()
      }
      return
    }
    isQuitting = true
    app.quit()
  })
  return win
}

function ensureMainWindow(): BrowserWindow {
  if (!mainWindow || mainWindow.isDestroyed()) {
    mainWindow = createMainWindow()
  }
  return mainWindow
}

// ---------- 托盘 ----------

function createTray(): void {
  const iconPath = resolveAppIconPath()
  if (!existsSync(iconPath)) {
    console.error('[main] 托盘图标不存在:', iconPath)
    return
  }
  const icon = nativeImage.createFromPath(iconPath)
  if (icon.isEmpty()) {
    console.error('[main] 托盘图标加载失败:', iconPath)
    return
  }
  tray = new Tray(icon)
  tray.setToolTip('PingNest 微信通知伴侣')

  const menu = Menu.buildFromTemplate([
    {
      label: '打开主界面',
      click: () => {
        const win = ensureMainWindow()
        win.show()
        win.focus()
      }
    },
    {
      label: '重新连接微信',
      click: () => {
        void connectAndStart()
      }
    },
    { type: 'separator' },
    {
      label: '退出',
      click: () => {
        isQuitting = true
        app.quit()
      }
    }
  ])
  tray.setContextMenu(menu)
  tray.on('click', () => {
    const win = ensureMainWindow()
    win.isVisible() ? win.hide() : (win.show(), win.focus())
  })
}

// ---------- 密钥获取（独立进程，避免 wx_key.dll 污染主进程导致 wcdb_init 失败） ----------

function resolveKeyDllPath(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath as string, 'resources', 'key', 'win32', 'x64', 'wx_key.dll')
  }
  // dev：dist-electron/../resources = 项目根/resources
  return join(__dirname, '..', 'resources', 'key', 'win32', 'x64', 'wx_key.dll')
}

function getKeyViaWorker(
  timeoutMs: number,
  onStatus?: (message: string, level: number) => void
): Promise<{ success: boolean; key?: string; error?: string; logs?: string[] }> {
  return new Promise((resolve) => {
    let settled = false
    const worker = utilityProcess.fork(join(__dirname, 'keyWorker.js'), [], {
      serviceName: 'pingnest-key',
      env: {
        ...process.env,
        WX_KEY_DLL_PATH: resolveKeyDllPath(),
        APP_IS_PACKAGED: app.isPackaged ? 'true' : 'false'
      }
    })

    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      try { worker.kill() } catch { }
      resolve({ success: false, error: '获取密钥超时（进程无响应）' })
    }, timeoutMs + 8000)

    worker.on('message', (msg: any) => {
      if (!msg) return
      if (msg.type === 'status') {
        onStatus?.(String(msg.message || ''), Number(msg.level || 0))
      } else if (msg.type === 'result') {
        if (settled) return
        settled = true
        clearTimeout(timer)
        try { worker.kill() } catch { }
        resolve(msg.result || { success: false, error: '密钥进程返回空结果' })
      }
    })

    worker.on('exit', () => {
      clearTimeout(timer)
      if (!settled) {
        settled = true
        resolve({ success: false, error: '密钥进程异常退出' })
      }
    })

    worker.postMessage({ id: 1, type: 'getKey', payload: { timeoutMs } })
  })
}

// ---------- 连接引导 ----------

async function connectAndStart(): Promise<{ success: boolean; error?: string }> {
  const connectResult = await chatService.connect()
  if (connectResult.success) {
    await backfillSavedAccountName()
    await backfillGroupNames()
    messagePushService.start()
    return { success: true }
  }
  return connectResult
}

async function reconnectAndStart(): Promise<{ success: boolean; error?: string }> {
  messagePushService.stop()
  const reconnectResult = await chatService.reconnect()
  if (!reconnectResult.success) return reconnectResult
  await backfillSavedAccountName()
  await backfillGroupNames()
  messagePushService.start()
  return { success: true }
}

function getPublicConfig(cfg: ConfigSchema): ConfigSchema {
  return { ...cfg, decryptKey: '' }
}

async function backfillGroupNames(): Promise<void> {
  const groupIds = new Set(
    notifyCenterStore.getEntries()
      .filter((entry) => entry.payload?.sessionType === 'group' && entry.payload?.sessionId)
      .map((entry) => String(entry.payload.sessionId))
  )
  let changed = false
  for (const sessionId of groupIds) {
    const groupInfo = await chatService.getContactAvatar(sessionId)
    const groupName = groupInfo?.displayName
    if (groupName) changed = notifyCenterStore.updateGroupName(sessionId, groupName) || changed
  }
  if (changed) broadcastNotifyCenter()
}

function hasSavedHook(cfg: ConfigSchema): boolean {
  return !!(cfg.dbPath && cfg.decryptKey && cfg.myWxid)
}

function normalizeAccountName(value: string | undefined, wxid: string): string {
  return normalizeDisplayName(value, wxid)
}

async function resolveAccountName(wxid: string, scannedName?: string): Promise<string> {
  const localName = normalizeAccountName(scannedName, wxid)
  if (localName) return localName
  const profile = await chatService.getContactAvatar(wxid)
  return normalizeAccountName(profile?.displayName, wxid)
}

async function backfillSavedAccountName(): Promise<void> {
  const cfg = configService.getAll()
  if (!cfg.myWxid || cfg.myWxName) return
  const name = await resolveAccountName(cfg.myWxid)
  if (name) configService.set('myWxName', name)
}

async function hookAndConnect(onProgress?: (progress: HookProgress) => void): Promise<{ success: boolean; error?: string; account?: string }> {
  if (hookInProgress) return { success: false, error: '连接正在进行，请稍候' }
  hookInProgress = true

  const previous = configService.getAll()
  const hadWorkingConfig = hasSavedHook(previous)
  let connectionInterrupted = false
  const report = (stage: HookStage, message: string) => onProgress?.({ stage, message })

  try {
    report('detecting', '正在查找微信账号')
    const detected = await dbPathService.autoDetect()
    const dbPath = detected.success && detected.path ? detected.path : previous.dbPath
    if (!dbPath) throw new Error(detected.error || '未找到微信数据，请确认已登录微信')

    const accounts = dbPathService.scanWxids(dbPath)
    const selectedAccount = accounts[0]
    const myWxid = selectedAccount?.wxid || previous.myWxid
    if (!myWxid) throw new Error('未识别到微信账号，请先登录微信')

    report('waiting-wechat', '正在确认微信运行状态')
    const wechatPid = await keyService.findWeChatPid()
    if (wechatPid === null) throw new Error('未检测到微信，请启动并登录微信后重试')

    report('hooking', '正在建立本地连接')
    const keyResult = await getKeyViaWorker(60_000, (message, level) => {
      if (level === 2) return
      report('hooking', message || '正在建立本地连接')
    })
    if (!keyResult.success || !keyResult.key) {
      throw new Error(keyResult.error || '连接未完成，请保持微信登录后重试')
    }

    report('verifying', '正在检查连接')
    messagePushService.stop()
    await chatService.close()
    connectionInterrupted = true
    const verifyResult = await chatService.connectWithCredentials(myWxid, dbPath, keyResult.key)
    if (!verifyResult.success) throw new Error(verifyResult.error || '连接已建立，但暂时无法读取通知')
    const myWxName = await resolveAccountName(myWxid, selectedAccount?.nickname)

    configService.set('dbPath', dbPath)
    configService.set('decryptKey', keyResult.key)
    configService.set('myWxid', myWxid)
    configService.set('myWxName', myWxName)
    configService.set('onboardingDone', true)
    messagePushService.start()
    report('success', '微信连接成功')
    return { success: true, account: myWxid }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    if (connectionInterrupted) {
      await chatService.close()
      configService.set('dbPath', previous.dbPath)
      configService.set('decryptKey', previous.decryptKey)
      configService.set('myWxid', previous.myWxid)
      configService.set('myWxName', previous.myWxName)
      configService.set('onboardingDone', previous.onboardingDone)
      if (hadWorkingConfig) await connectAndStart()
    }
    report('error', message)
    return { success: false, error: message }
  } finally {
    hookInProgress = false
  }
}

async function removeSavedHook(): Promise<void> {
  messagePushService.stop()
  await chatService.close()
  configService.set('dbPath', '')
  configService.set('decryptKey', '')
  configService.set('myWxid', '')
  configService.set('myWxName', '')
  configService.set('onboardingDone', false)
}

// ---------- 通知分发 ----------

function handleMessagePush(payload: MessagePushPayload): void {
  const effect = ruleEngine.match(payload)
  const cfg = configService.getAll()

  // 通知中心记录（持久化）
  if (cfg.notifyCenterEnabled) {
    notifyCenterStore.add({
      id: 'nc_' + Date.now() + '_' + Math.random().toString(36).slice(2, 8),
      payload: payload as unknown as Record<string, unknown>,
      effect: (effect || {}) as Record<string, unknown>,
      receivedAt: Date.now(),
      read: false
    })
    broadcastNotifyCenter()
  }

  // 弹窗
  if (effect.muted) return
  if (!cfg.notificationEnabled) return

  const title = payload.groupName
    ? payload.sourceName + ' @ ' + payload.groupName
    : payload.sourceName
  const position = effect.position || cfg.notificationPosition
  const durationMs = effect.durationMs || cfg.notificationDurationMs || 5000

  showNotification({
    sessionId: payload.sessionId,
    sessionType: payload.sessionType,
    title,
    content: payload.content,
    avatarUrl: payload.avatarUrl,
    timestamp: payload.timestamp,
    event: payload.event,
    position,
    notificationStyle: cfg.notificationStyle,
    accentColor: effect.accentColor,
    durationMs,
    mergeWindowMs: cfg.mergeWindowMs,
    opacity: cfg.notificationOpacity,
    showSummary: cfg.showNotificationSummary,
    clickBehavior: cfg.notifyCenterEnabled ? cfg.notificationClickBehavior : 'none',
    soundEnabled: cfg.soundEnabled,
    sound: effect.sound
  }).catch((e) => console.error('[main] showNotification failed:', e))
}

function broadcastNotifyCenter(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed() && win !== mainWindow) continue
    if (win && !win.isDestroyed()) {
      win.webContents.send('notify-center:update', getNotifyCenterSnapshot())
    }
  }
}

function getNotifyCenterSnapshot() {
  return notifyCenterStore.getEntries()
}

function validateConfigValue(key: keyof ConfigSchema, value: unknown): string | null {
  if (!Object.prototype.hasOwnProperty.call(configService.getAll(), key)) return '未知配置项'
  const booleans: Array<keyof ConfigSchema> = [
    'notificationEnabled', 'soundEnabled', 'showNotificationSummary', 'notifyCenterEnabled',
    'startupEnabled', 'closeToTray', 'trayNotifications', 'autoReconnect', 'autoCleanupHistory',
    'onboardingDone'
  ]
  if (booleans.includes(key) && typeof value !== 'boolean') return '配置值必须是布尔值'
  if (key === 'reconnectIntervalSeconds' && (!Number.isInteger(value) || Number(value) < 1 || Number(value) > 15)) return '重连间隔必须为 1 到 15 秒'
  if (key === 'historyRetentionDays' && ![7, 30, 90].includes(Number(value))) return '历史保留天数不受支持'
  if (key === 'notificationDurationMs' && (!Number.isInteger(value) || Number(value) < 3000 || Number(value) > 15000)) return '通知持续时间超出范围'
  if (key === 'notificationOpacity' && (!Number.isInteger(value) || Number(value) < 70 || Number(value) > 100)) return '通知透明度超出范围'
  if (key === 'mergeWindowMs' && (!Number.isFinite(value) || Number(value) < 0 || Number(value) > 60_000)) return '消息聚合时间超出范围'
  if (key === 'notificationClickBehavior' && value !== 'open-app' && value !== 'none') return '通知点击行为不受支持'
  if (key === 'notificationPosition' && !['top-right', 'top-left', 'bottom-right', 'bottom-left', 'top-center'].includes(String(value))) return '通知位置不受支持'
  if (key === 'notificationStyle' && !['standard', 'compact', 'layered', 'minimal'].includes(String(value))) return '通知样式不受支持'
  if (key === 'notificationFilterMode' && !['all', 'whitelist', 'blacklist'].includes(String(value))) return '通知范围不受支持'
  if (key === 'notificationFilterList' && (!Array.isArray(value) || value.some((item) => typeof item !== 'string'))) return '通知会话列表格式无效'
  if (key === 'notifyRules') {
    if (!Array.isArray(value)) return '通知规则格式无效'
    for (const rule of value) {
      if (!rule || typeof rule !== 'object') return '通知规则格式无效'
      const candidate = rule as Record<string, unknown>
      if (typeof candidate.id !== 'string' || typeof candidate.name !== 'string' || typeof candidate.enabled !== 'boolean') return '通知规则格式无效'
      if (!Array.isArray(candidate.sessionIds) || candidate.sessionIds.some((item) => typeof item !== 'string')) return '通知规则会话格式无效'
      if (!Array.isArray(candidate.keywords) || candidate.keywords.some((item) => typeof item !== 'string')) return '通知规则关键词格式无效'
      if (candidate.matchMode !== 'any' && candidate.matchMode !== 'all') return '通知规则匹配方式无效'
    }
  }
  return null
}

function cleanupExpiredHistory(): number {
  if (!configService.get('autoCleanupHistory')) return 0
  return notifyCenterStore.cleanupOlderThan(configService.get('historyRetentionDays'))
}

// ---------- IPC ----------

function registerIpcHandlers(): void {
  ipcMain.handle('app:getStatus', async () => {
    const cfg = configService.getAll()
    const wechatPid = await keyService.findWeChatPid(0)
    const workerReady = await Promise.race([
      dbWorkerClient.isReady().catch(() => ({ ready: false })),
      new Promise<{ ready: boolean }>((resolve) => setTimeout(() => resolve({ ready: false }), 1500))
    ])
    return {
      connected: chatService.isConnected(),
      wcdbReady: workerReady.ready === true,
      wechatRunning: wechatPid !== null,
      hasFullConfig: !!(cfg.dbPath && cfg.decryptKey && cfg.myWxid),
      hookReady: hasSavedHook(cfg),
      config: getPublicConfig(cfg)
    }
  })

  ipcMain.handle('app:connect', async () => {
    return connectAndStart()
  })

  ipcMain.handle('app:reconnect', async () => {
    return reconnectAndStart()
  })

  ipcMain.handle('app:autoSetup', async () => {
    return hookAndConnect()
  })

  ipcMain.handle('app:hook', async (event) => {
    return hookAndConnect((progress) => event.sender.send('app:hookProgress', progress))
  })

  ipcMain.handle('app:removeHook', async () => {
    await removeSavedHook()
    return { success: true }
  })

  ipcMain.handle('app:disconnect', async () => {
    messagePushService.stop()
    await chatService.close()
    return { success: true }
  })

  ipcMain.handle('config:get', async () => {
    return getPublicConfig(configService.getAll())
  })

  ipcMain.handle('config:set', async (_event, key: keyof ConfigSchema, value: unknown) => {
    try {
      const validationError = validateConfigValue(key, value)
      if (validationError) return { success: false, error: validationError }
      const previousValue = configService.get(key)
      configService.set(key, value as never)
      if (key === 'startupEnabled') {
        app.setLoginItemSettings({ openAtLogin: value === true })
        if (app.isPackaged && app.getLoginItemSettings().openAtLogin !== (value === true)) {
          configService.set(key, previousValue as never)
          return { success: false, error: '系统未能应用开机启动设置' }
        }
      }
      if (key === 'notificationEnabled' || key === 'notifyCenterEnabled' || key === 'dbPath' || key === 'decryptKey' || key === 'myWxid') {
        messagePushService.handleConfigChanged()
      }
      if (key === 'autoReconnect' || key === 'reconnectIntervalSeconds') {
        await chatService.updateMonitorOptions()
        messagePushService.handleReconnectOptionsChanged()
      }
      if (key === 'autoCleanupHistory' || key === 'historyRetentionDays') {
        if (cleanupExpiredHistory() > 0) broadcastNotifyCenter()
      }
      return { success: true }
    } catch (e) {
      return { success: false, error: String(e) }
    }
  })

  ipcMain.handle('notify:list', async () => {
    return getNotifyCenterSnapshot()
  })

  ipcMain.handle('notify:markRead', async (_event, id: string) => {
    notifyCenterStore.markRead(String(id || ''))
    broadcastNotifyCenter()
    return { success: true }
  })

  ipcMain.handle('notify:markSessionRead', async (_event, sessionId: string) => {
    notifyCenterStore.markSessionRead(String(sessionId || ''))
    broadcastNotifyCenter()
    return { success: true }
  })

  ipcMain.handle('notify:remove', async (_event, id: string) => {
    notifyCenterStore.remove(String(id || ''))
    broadcastNotifyCenter()
    return { success: true }
  })

  ipcMain.handle('notify:clear', async () => {
    notifyCenterStore.clear()
    broadcastNotifyCenter()
    return { success: true }
  })

  ipcMain.on('window:minimize', () => mainWindow?.minimize())
  ipcMain.on('window:toggleMaximize', () => {
    if (!mainWindow) return
    mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize()
  })
  ipcMain.on('window:close', () => mainWindow?.close())
}

// ---------- 生命周期 ----------

const gotSingleInstanceLock = app.requestSingleInstanceLock()
if (!gotSingleInstanceLock) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const win = ensureMainWindow()
    if (win.isMinimized()) win.restore()
    win.show()
    win.focus()
  })

  app.whenReady().then(async () => {
    registerNotificationHandlers()
    registerIpcHandlers()
    await notifyCenterStore.init()
    cleanupExpiredHistory()
    historyCleanupTimer = setInterval(() => {
      if (cleanupExpiredHistory() > 0) broadcastNotifyCenter()
    }, 60 * 60 * 1000)
    mainWindow = createMainWindow()
    createTray()

    setNotificationNavigateHandler((sessionId: string) => {
      const win = ensureMainWindow()
      if (win.isMinimized()) win.restore()
      win.show()
      win.focus()
      win.webContents.send('navigate-to-session', sessionId)
    })

    messagePushService.on('message.new', (payload: MessagePushPayload) => handleMessagePush(payload))
    messagePushService.on('message.revoke', (payload: MessagePushPayload) => handleMessagePush(payload))

    // 数据库监控事件 → 消息推送服务
    chatService.addDbMonitorListener((type, json) => {
      messagePushService.handleDbMonitorChange(type, json)
    })

    if (hasSavedHook(configService.getAll())) {
      void connectAndStart().then((result) => {
        if (!result.success) console.warn('[main] 恢复微信监听失败:', result.error)
      })
    }

    app.on('activate', () => {
      ensureMainWindow()
    })
  })

  app.on('before-quit', (event) => {
    isQuitting = true
    if (historyFlushedForQuit) return
    event.preventDefault()
    historyFlushedForQuit = true
    if (historyCleanupTimer) {
      clearInterval(historyCleanupTimer)
      historyCleanupTimer = null
    }
    messagePushService.stop()
    cleanupExpiredHistory()
    void notifyCenterStore.flush().finally(() => app.quit())
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
      // 常驻托盘，不退出
    }
  })
}

app.on('quit', () => {
  messagePushService.stop()
  void chatService.close()
  destroyNotificationWindow()
})
