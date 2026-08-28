import { join } from 'path'
import { existsSync, copyFileSync, mkdirSync } from 'fs'
import os from 'os'
import { WeChatProcessFinder } from './key/processFinder'

export type DbKeyResult = { success: boolean; key?: string; error?: string; logs?: string[] }

/**
 * KeyService（移植自 WeFlow，仅保留 Windows 获取数据库密钥能力）
 *
 * 原理：加载 wx_key.dll，注入微信进程 Hook 其数据库初始化回调，
 * 通过 PollKeyData 轮询得到 64 位 hex 密钥，用于解密微信 4.0 本地 wcdb 数据库。
 * 进程/窗口发现见 key/processFinder，Win32 绑定见 key/win32Api。
 */
export class KeyService {
  private readonly processFinder = new WeChatProcessFinder()

  private koffi: any = null
  private lib: any = null
  private initialized = false
  private initHook: any = null
  private pollKeyData: any = null
  private getStatusMessage: any = null
  private cleanupHook: any = null
  private getLastErrorMsg: any = null

  private getDllPath(): string {
    const isPackaged = process.env.APP_IS_PACKAGED === 'true'
    const candidates: string[] = []

    if (process.env.WX_KEY_DLL_PATH) {
      candidates.push(process.env.WX_KEY_DLL_PATH)
    }

    if (isPackaged) {
      candidates.push(join(process.resourcesPath, 'resources', 'key', 'win32', 'x64', 'wx_key.dll'))
      candidates.push(join(process.resourcesPath, 'resources', 'key', 'win32', 'wx_key.dll'))
      candidates.push(join(process.resourcesPath, 'wx_key.dll'))
    } else {
      const cwd = process.cwd()
      candidates.push(join(cwd, 'resources', 'key', 'win32', 'x64', 'wx_key.dll'))
      candidates.push(join(cwd, 'resources', 'key', 'win32', 'wx_key.dll'))
      candidates.push(join(cwd, 'resources', 'wx_key.dll'))
    }

    for (const path of candidates) {
      if (existsSync(path)) return path
    }
    return candidates[0] || 'wx_key.dll'
  }

  private localizeNetworkDll(originalPath: string): string {
    try {
      const tempDir = join(os.tmpdir(), 'pingnest_dll_cache')
      if (!existsSync(tempDir)) mkdirSync(tempDir, { recursive: true })
      const localPath = join(tempDir, 'wx_key.dll')
      if (existsSync(localPath)) return localPath
      copyFileSync(originalPath, localPath)
      return localPath
    } catch {
      return originalPath
    }
  }

  private ensureLoaded(): boolean {
    if (this.initialized) return true
    let dllPath = ''
    try {
      this.koffi = require('koffi')
      dllPath = this.getDllPath()
      if (!existsSync(dllPath)) {
        console.error('[KeyService] wx_key.dll 不存在: ' + dllPath)
        return false
      }
      if (dllPath.startsWith('\\')) dllPath = this.localizeNetworkDll(dllPath)

      this.lib = this.koffi.load(dllPath)
      this.initHook = this.lib.func('bool InitializeHook(uint32 targetPid)')
      this.pollKeyData = this.lib.func('bool PollKeyData(_Out_ char *keyBuffer, int bufferSize)')
      this.getStatusMessage = this.lib.func('bool GetStatusMessage(_Out_ char *msgBuffer, int bufferSize, _Out_ int *outLevel)')
      this.cleanupHook = this.lib.func('bool CleanupHook()')
      this.getLastErrorMsg = this.lib.func('const char* GetLastErrorMsg()')
      this.initialized = true
      return true
    } catch (e) {
      console.error('[KeyService] 加载 wx_key.dll 失败 ' + dllPath + ': ' + String(e))
      return false
    }
  }

  private decodeUtf8(buf: Buffer): string {
    const nullIdx = buf.indexOf(0)
    return buf.toString('utf8', 0, nullIdx > -1 ? nullIdx : undefined).trim()
  }

  private decodeCString(ptr: any): string {
    try {
      if (typeof ptr === 'string') return ptr
      return this.koffi.decode(ptr, 'char', -1)
    } catch {
      return ''
    }
  }

  /** 查找微信进程 PID（委托进程发现模块） */
  async findWeChatPid(waitMs = 5000): Promise<number | null> {
    return this.processFinder.findWeChatPid(waitMs)
  }

  /** 激活已运行的微信主窗口（委托进程发现模块） */
  async focusWeChatWindow(): Promise<boolean> {
    return this.processFinder.focusWeChatWindow()
  }

  /**
   * 自动获取数据库密钥（核心流程，移植自 WeFlow）
   */
  async autoGetDbKey(
    timeoutMs = 60_000,
    onStatus?: (message: string, level: number) => void
  ): Promise<DbKeyResult> {
    if (process.platform !== 'win32') return { success: false, error: '仅支持 Windows' }
    if (!this.ensureLoaded()) return { success: false, error: 'wx_key.dll 未加载' }

    const logs: string[] = []

    onStatus?.('正在查找微信进程...', 0)
    const pid = await this.processFinder.findWeChatPid()
    if (!pid) {
      const err = '未找到微信进程，请先启动微信'
      onStatus?.(err, 2)
      return { success: false, error: err }
    }

    onStatus?.('检测到微信窗口 (PID: ' + pid + ')，正在获取...', 0)
    onStatus?.('正在检测微信界面组件...', 0)
    await this.processFinder.waitForWeChatWindowComponents(pid, 15000)

    let ok = this.initHook(pid)
    if (!ok) {
      // 失败后先尝试清理残留 Hook 状态，再重试一次（多实例并发注入时可能残留）
      onStatus?.('首次注入失败，尝试清理残留状态后重试...', 0)
      try { this.cleanupHook() } catch { /* 尽力清理：Hook 未建立时清理失败可忽略 */ }
      await new Promise(resolve => setTimeout(resolve, 400))
      ok = this.initHook(pid)
    }
    if (!ok) {
      const error = this.getLastErrorMsg ? this.decodeCString(this.getLastErrorMsg()) : ''
      if (error) {
        return this.explainHookError(error)
      }
      const statusBuffer = Buffer.alloc(256)
      const levelOut = [0]
      const status = this.getStatusMessage && this.getStatusMessage(statusBuffer, statusBuffer.length, levelOut)
        ? this.decodeUtf8(statusBuffer)
        : ''
      return { success: false, error: status || '初始化失败' }
    }

    const keyBuffer = Buffer.alloc(128)
    const start = Date.now()
    let loginRequiredDetected = false

    try {
      while (Date.now() - start < timeoutMs) {
        if (this.pollKeyData(keyBuffer, keyBuffer.length)) {
          const key = this.decodeUtf8(keyBuffer)
          if (key.length === 64) {
            onStatus?.('密钥获取成功', 1)
            return { success: true, key, logs }
          }
        }

        for (let i = 0; i < 5; i++) {
          const statusBuffer = Buffer.alloc(256)
          const levelOut = [0]
          if (!this.getStatusMessage(statusBuffer, statusBuffer.length, levelOut)) break
          const msg = this.decodeUtf8(statusBuffer)
          const level = levelOut[0] ?? 0
          if (msg) {
            logs.push(msg)
            if (this.processFinder.isLoginRelatedText(msg)) loginRequiredDetected = true
            onStatus?.(msg, level)
          }
        }
        await new Promise(resolve => setTimeout(resolve, 120))
      }
    } finally {
      try { this.cleanupHook() } catch { /* 尽力清理：Hook 未建立时清理失败可忽略 */ }
    }

    const loginRequired = loginRequiredDetected || await this.processFinder.detectWeChatLoginRequired(pid)
    if (loginRequired) {
      return {
        success: false,
        error: '未能获取数据库密钥。\n\n微信 4.1.11+ 需要重新登录才能触发密钥生成，请按以下步骤操作：\n1. 保持本应用在"正在获取密钥"状态\n2. 打开微信 → 设置 → 退出登录\n3. 重新扫码登录\n4. 本应用将自动捕获密钥',
        logs
      }
    }
    return {
      success: false,
      error: '获取密钥超时。若微信已登录，请退出登录并重新登录一次（微信 4.1.11+ 需重新触发密钥生成）。',
      logs
    }
  }

  /** 把 wx_key.dll 的原始错误翻译为用户可操作指引 */
  private explainHookError(error: string): DbKeyResult {
    const normalizedError = error.toLowerCase()
    if (normalizedError.includes('auth_failed') && normalizedError.includes('auth_env_missing')) {
      return {
        success: false,
        error: '当前 wx_key.dll 需要 WeFlow 授权环境，不能用于 PingNest。请恢复 PingNest 配套的 wx_key.dll。'
      }
    }
    if (error.includes('0xC0000022') || error.includes('ACCESS_DENIED') || error.includes('打开目标进程失败')) {
      return {
        success: false,
        error: '权限不足：无法访问微信进程。\n\n解决方法：\n1. 以管理员身份运行本程序\n2. 关闭可能拦截的安全软件（如360、火绒等）\n3. 确保微信没有以管理员权限运行'
      }
    }
    if (error.includes('已经初始化') || normalizedError.includes('already') || error.includes('重复')) {
      return {
        success: false,
        error: '微信进程内存在未清理的密钥 Hook 状态（之前获取密钥未正常退出）。\n\n解决方法：完全退出微信（任务栏右键 → 退出），重新打开并登录后，再点击"一键配置"重试。'
      }
    }
    return { success: false, error }
  }
}

export const keyService = new KeyService()
