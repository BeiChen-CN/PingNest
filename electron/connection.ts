import { app, utilityProcess } from 'electron'
import { join } from 'path'
import { configService, type ConfigSchema } from './services/config'
import { dbPathService } from './services/dbPathService'
import { keyService } from './services/keyService'
import { chatService } from './services/chatService'
import { messagePushService } from './services/messagePushService'
import { notifyCenterStore, type NotifyCenterEntry } from './services/notifyCenterStore'
import { normalizeDisplayName } from './services/displayName'
import { broadcastNotifyCenterPatch } from './notifyBroadcast'

export type HookStage = 'detecting' | 'waiting-wechat' | 'hooking' | 'verifying' | 'success' | 'error'
export interface HookProgress {
  stage: HookStage
  message: string
}

let hookInProgress = false

// ---------- 密钥获取（独立进程，避免 wx_key.dll 污染主进程导致 wcdb_init 失败） ----------

function resolveKeyDllPath(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath as string, 'resources', 'key', 'win32', 'x64', 'wx_key.dll')
  }
  // dev：dist-electron/../resources = 项目根/resources
  return join(__dirname, '..', 'resources', 'key', 'win32', 'x64', 'wx_key.dll')
}

function resolveDllManifestPath(): string {
  if (app.isPackaged) {
    return join(process.resourcesPath as string, 'resources', 'dll-manifest.json')
  }
  return join(__dirname, '..', 'resources', 'dll-manifest.json')
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
        WX_DLL_MANIFEST_PATH: resolveDllManifestPath(),
        APP_IS_PACKAGED: app.isPackaged ? 'true' : 'false'
      }
    })

    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      try { worker.kill() } catch { /* 尽力终止：密钥进程可能已自行退出 */ }
      resolve({ success: false, error: '获取密钥超时：密钥进程长时间无响应。\n\n请完全退出微信（托盘右键 → 退出）后重新打开并登录，再重试连接。' })
    }, timeoutMs + 8000)

    worker.on('message', (msg: any) => {
      if (!msg) return
      if (msg.type === 'status') {
        onStatus?.(String(msg.message || ''), Number(msg.level || 0))
      } else if (msg.type === 'result') {
        if (settled) return
        settled = true
        clearTimeout(timer)
        try { worker.kill() } catch { /* 尽力终止：密钥进程可能已自行退出 */ }
        resolve(msg.result || { success: false, error: '密钥进程返回空结果' })
      }
    })

    worker.on('exit', () => {
      clearTimeout(timer)
      if (!settled) {
        settled = true
        resolve({ success: false, error: '密钥进程异常退出（可能被安全软件终止）。\n\n请检查杀毒软件是否拦截 PingNest 组件，将其加入信任后重试。' })
      }
    })

    worker.postMessage({ id: 1, type: 'getKey', payload: { timeoutMs } })
  })
}

// ---------- 连接引导 ----------

export async function connectAndStart(): Promise<{ success: boolean; error?: string }> {
  const connectResult = await chatService.connect()
  if (connectResult.success) {
    await backfillSavedAccountName()
    await backfillGroupNames()
    messagePushService.start()
    return { success: true }
  }
  return connectResult
}

export async function reconnectAndStart(): Promise<{ success: boolean; error?: string }> {
  messagePushService.stop()
  const reconnectResult = await chatService.reconnect()
  if (!reconnectResult.success) return reconnectResult
  await backfillSavedAccountName()
  await backfillGroupNames()
  messagePushService.start()
  return { success: true }
}

function hasSavedHook(cfg: ConfigSchema): boolean {
  return !!(cfg.dbPath && cfg.decryptKey && cfg.myWxid)
}

export { hasSavedHook }

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

async function backfillGroupNames(): Promise<void> {
  const groupIds = new Set(
    notifyCenterStore.getEntries()
      .filter((entry) => entry.payload?.sessionType === 'group' && entry.payload?.sessionId)
      .map((entry) => String(entry.payload.sessionId))
  )
  const updatedEntries: NotifyCenterEntry[] = []
  for (const sessionId of groupIds) {
    const groupInfo = await chatService.getContactAvatar(sessionId)
    const groupName = groupInfo?.displayName
    if (groupName) updatedEntries.push(...notifyCenterStore.updateGroupName(sessionId, groupName))
  }
  if (updatedEntries.length > 0) broadcastNotifyCenterPatch({ updated: updatedEntries })
}

export async function hookAndConnect(onProgress?: (progress: HookProgress) => void): Promise<{ success: boolean; error?: string; account?: string }> {
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

export async function removeSavedHook(): Promise<void> {
  messagePushService.stop()
  await chatService.close()
  configService.set('dbPath', '')
  configService.set('decryptKey', '')
  configService.set('myWxid', '')
  configService.set('myWxName', '')
  configService.set('onboardingDone', false)
}
