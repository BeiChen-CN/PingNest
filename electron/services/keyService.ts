import { join } from 'path'
import { existsSync, copyFileSync, mkdirSync } from 'fs'
import { execFile } from 'child_process'
import { promisify } from 'util'
import os from 'os'

const execFileAsync = promisify(execFile)

export type DbKeyResult = { success: boolean; key?: string; error?: string; logs?: string[] }

/**
 * KeyService（移植自 WeFlow，仅保留 Windows 获取数据库密钥能力）
 *
 * 原理：加载 wx_key.dll，注入微信进程 Hook 其数据库初始化回调，
 * 通过 PollKeyData 轮询得到 64 位 hex 密钥，用于解密微信 4.0 本地 wcdb 数据库。
 */
export class KeyService {
  private koffi: any = null
  private lib: any = null
  private initialized = false
  private initHook: any = null
  private pollKeyData: any = null
  private getStatusMessage: any = null
  private cleanupHook: any = null
  private getLastErrorMsg: any = null

  // Win32 APIs
  private kernel32: any = null
  private user32: any = null
  private advapi32: any = null

  private OpenProcess: any = null
  private CloseHandle: any = null
  private QueryFullProcessImageNameW: any = null

  private EnumWindows: any = null
  private GetWindowTextW: any = null
  private GetWindowTextLengthW: any = null
  private GetClassNameW: any = null
  private GetWindowThreadProcessId: any = null
  private IsWindowVisible: any = null
  private IsIconic: any = null
  private ShowWindow: any = null
  private SetForegroundWindow: any = null
  private EnumChildWindows: any = null
  private WNDENUMPROC_PTR: any = null

  private RegOpenKeyExW: any = null
  private RegQueryValueExW: any = null
  private RegCloseKey: any = null

  private readonly KEY_READ = 0x20019
  private readonly HKEY_LOCAL_MACHINE = 0x80000002
  private readonly HKEY_CURRENT_USER = 0x80000001
  private readonly ERROR_SUCCESS = 0

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

  private ensureWin32(): boolean {
    return process.platform === 'win32'
  }

  private ensureKernel32(): boolean {
    if (this.kernel32) return true
    try {
      this.koffi = require('koffi')
      this.kernel32 = this.koffi.load('kernel32.dll')
      this.OpenProcess = this.kernel32.func('OpenProcess', 'void*', ['uint32', 'bool', 'uint32'])
      this.CloseHandle = this.kernel32.func('CloseHandle', 'bool', ['void*'])
      this.QueryFullProcessImageNameW = this.kernel32.func('QueryFullProcessImageNameW', 'bool', ['void*', 'uint32', this.koffi.out('uint16*'), this.koffi.out('uint32*')])
      return true
    } catch (e) {
      console.error('[KeyService] kernel32 初始化失败:', e)
      return false
    }
  }

  private ensureUser32(): boolean {
    if (this.user32) return true
    try {
      this.koffi = require('koffi')
      this.user32 = this.koffi.load('user32.dll')

      const WNDENUMPROC = this.koffi.proto('bool __stdcall (void *hWnd, intptr_t lParam)')
      this.WNDENUMPROC_PTR = this.koffi.pointer(WNDENUMPROC)

      this.EnumWindows = this.user32.func('EnumWindows', 'bool', [this.WNDENUMPROC_PTR, 'intptr_t'])
      this.EnumChildWindows = this.user32.func('EnumChildWindows', 'bool', ['void*', this.WNDENUMPROC_PTR, 'intptr_t'])
      this.GetWindowTextW = this.user32.func('GetWindowTextW', 'int', ['void*', this.koffi.out('uint16*'), 'int'])
      this.GetWindowTextLengthW = this.user32.func('GetWindowTextLengthW', 'int', ['void*'])
      this.GetClassNameW = this.user32.func('GetClassNameW', 'int', ['void*', this.koffi.out('uint16*'), 'int'])
      this.GetWindowThreadProcessId = this.user32.func('GetWindowThreadProcessId', 'uint32', ['void*', this.koffi.out('uint32*')])
      this.IsWindowVisible = this.user32.func('IsWindowVisible', 'bool', ['void*'])
      this.IsIconic = this.user32.func('IsIconic', 'bool', ['void*'])
      this.ShowWindow = this.user32.func('ShowWindow', 'bool', ['void*', 'int'])
      this.SetForegroundWindow = this.user32.func('SetForegroundWindow', 'bool', ['void*'])

      return true
    } catch (e) {
      console.error('[KeyService] user32 初始化失败:', e)
      return false
    }
  }

  private ensureAdvapi32(): boolean {
    if (this.advapi32) return true
    try {
      this.koffi = require('koffi')
      this.advapi32 = this.koffi.load('advapi32.dll')

      const HKEY = this.koffi.alias('HKEY', 'intptr_t')
      const HKEY_PTR = this.koffi.pointer(HKEY)

      this.RegOpenKeyExW = this.advapi32.func('RegOpenKeyExW', 'long', [HKEY, 'uint16*', 'uint32', 'uint32', this.koffi.out(HKEY_PTR)])
      this.RegQueryValueExW = this.advapi32.func('RegQueryValueExW', 'long', [HKEY, 'uint16*', 'uint32*', this.koffi.out('uint32*'), this.koffi.out('uint8*'), this.koffi.out('uint32*')])
      this.RegCloseKey = this.advapi32.func('RegCloseKey', 'long', [HKEY])

      return true
    } catch (e) {
      console.error('[KeyService] advapi32 初始化失败:', e)
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

  private readRegistryString(rootKey: number, subKey: string, valueName: string): string | null {
    if (!this.ensureAdvapi32()) return null
    const subKeyBuf = Buffer.from(subKey + '\0', 'ucs2')
    const valueNameBuf = valueName ? Buffer.from(valueName + '\0', 'ucs2') : null
    const phkResult = Buffer.alloc(8)

    if (this.RegOpenKeyExW(rootKey, subKeyBuf, 0, this.KEY_READ, phkResult) !== this.ERROR_SUCCESS) return null
    const hKey = this.koffi.decode(phkResult, 'uintptr_t')

    try {
      const lpcbData = Buffer.alloc(4)
      lpcbData.writeUInt32LE(0, 0)
      let ret = this.RegQueryValueExW(hKey, valueNameBuf, null, null, null, lpcbData)
      if (ret !== this.ERROR_SUCCESS) return null

      const size = lpcbData.readUInt32LE(0)
      if (size === 0) return null

      const dataBuf = Buffer.alloc(size)
      ret = this.RegQueryValueExW(hKey, valueNameBuf, null, null, dataBuf, lpcbData)
      if (ret !== this.ERROR_SUCCESS) return null

      let str = dataBuf.toString('ucs2')
      if (str.endsWith('\0')) str = str.slice(0, -1)
      return str
    } finally {
      this.RegCloseKey(hKey)
    }
  }

  private async getProcessExecutablePath(pid: number): Promise<string | null> {
    if (!this.ensureKernel32()) return null
    const hProcess = this.OpenProcess(0x1000, false, pid)
    if (!hProcess) return null
    try {
      const sizeBuf = Buffer.alloc(4)
      sizeBuf.writeUInt32LE(1024, 0)
      const pathBuf = Buffer.alloc(1024 * 2)
      const ret = this.QueryFullProcessImageNameW(hProcess, 0, pathBuf, sizeBuf)
      if (ret) {
        const len = sizeBuf.readUInt32LE(0)
        return pathBuf.toString('ucs2', 0, len * 2)
      }
      return null
    } catch {
      return null
    } finally {
      this.CloseHandle(hProcess)
    }
  }

  /** 查找微信安装路径（优先运行中的进程，其次注册表/常见路径） */
  async findWeChatInstallPath(): Promise<string | null> {
    try {
      const pid = await this.findWeChatPid()
      if (pid) {
        const runPath = await this.getProcessExecutablePath(pid)
        if (runPath && existsSync(runPath)) return runPath
      }
    } catch { }

    const uninstallKeys = [
      'SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall',
      'SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall'
    ]
    const roots = [this.HKEY_LOCAL_MACHINE, this.HKEY_CURRENT_USER]
    const tencentKeys = [
      'Software\\Tencent\\WeChat',
      'Software\\WOW6432Node\\Tencent\\WeChat',
      'Software\\Tencent\\Weixin'
    ]

    for (const root of roots) {
      for (const key of tencentKeys) {
        const path = this.readRegistryString(root, key, 'InstallPath')
        if (path && existsSync(join(path, 'Weixin.exe'))) return join(path, 'Weixin.exe')
        if (path && existsSync(join(path, 'WeChat.exe'))) return join(path, 'WeChat.exe')
      }
    }

    for (const root of roots) {
      for (const parent of uninstallKeys) {
        const path = this.readRegistryString(root, parent + '\\WeChat', 'InstallLocation')
        if (path && existsSync(join(path, 'Weixin.exe'))) return join(path, 'Weixin.exe')
      }
    }

    const drives = ['C', 'D', 'E', 'F']
    const commonPaths = [
      'Program Files\\Tencent\\WeChat\\WeChat.exe',
      'Program Files (x86)\\Tencent\\WeChat\\WeChat.exe',
      'Program Files\\Tencent\\Weixin\\Weixin.exe',
      'Program Files (x86)\\Tencent\\Weixin\\Weixin.exe'
    ]
    for (const drive of drives) {
      for (const p of commonPaths) {
        const full = join(drive + ':', p)
        if (existsSync(full)) return full
      }
    }
    return null
  }

  private async findPidByImageName(imageName: string): Promise<number | null> {
    try {
      const { stdout } = await execFileAsync('tasklist', ['/FI', 'IMAGENAME eq ' + imageName, '/FO', 'CSV', '/NH'])
      const lines = stdout.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
      for (const line of lines) {
        if (line.startsWith('INFO:')) continue
        const parts = line.split('","').map(p => p.replace(/^"|"$/g, ''))
        if (parts[0]?.toLowerCase() === imageName.toLowerCase()) {
          const pid = Number(parts[1])
          if (!Number.isNaN(pid)) return pid
        }
      }
      return null
    } catch {
      return null
    }
  }

  /** 查找微信进程 PID（微信 4.0 为 Weixin.exe） */
  async findWeChatPid(waitMs = 5000): Promise<number | null> {
    const names = ['Weixin.exe', 'WeChat.exe']
    for (const name of names) {
      const pid = await this.findPidByImageName(name)
      if (pid) return pid
    }
    if (waitMs <= 0) return null
    const fallbackPid = await this.waitForWeChatWindow(waitMs)
    return fallbackPid ?? null
  }

  private isWeChatWindowTitle(title: string): boolean {
    const normalized = title.trim()
    if (!normalized) return false
    const lower = normalized.toLowerCase()
    return normalized === '微信' || lower === 'wechat' || lower === 'weixin'
  }

  /**
   * 激活已运行的微信主窗口，供通知点击使用。
   *
   * 微信不同版本的主窗口标题可能短暂变化，因此优先使用运行进程
   * PID 识别窗口；只有无法取得 PID 时才退回到标题识别。
   */
  async focusWeChatWindow(): Promise<boolean> {
    if (!this.ensureWin32() || !this.ensureUser32()) return false

    let preferredPid: number | null = null
    try {
      preferredPid = await this.findWeChatPid(0)
    } catch { }

    const candidates: Array<{ hWnd: any; pid: number }> = []
    const enumWindowsCallback = this.koffi.register((hWnd: any) => {
      if (!this.IsWindowVisible(hWnd)) return true

      const pidBuf = Buffer.alloc(4)
      this.GetWindowThreadProcessId(hWnd, pidBuf)
      const pid = pidBuf.readUInt32LE(0)
      if (!pid) return true

      // 已确认微信进程时，不再依赖窗口标题。窗口标题可能是空值，
      // 或在登录、切换页面时暂时显示为其他文本。
      if (preferredPid !== null) {
        if (pid === preferredPid) candidates.push({ hWnd, pid })
        return true
      }

      if (this.isWeChatWindowTitle(this.getWindowTitle(hWnd))) candidates.push({ hWnd, pid })
      return true
    }, this.WNDENUMPROC_PTR)

    try {
      this.EnumWindows(enumWindowsCallback, 0)
    } finally {
      this.koffi.unregister(enumWindowsCallback)
    }

    const target = candidates.find((candidate) => candidate.pid === preferredPid) || candidates[0]
    if (!target) return false

    try {
      if (this.IsIconic(target.hWnd)) this.ShowWindow(target.hWnd, 9)
      return !!this.SetForegroundWindow(target.hWnd)
    } catch (error) {
      console.warn('[KeyService] 激活微信窗口失败:', error)
      return false
    }
  }

  private getWindowTitle(hWnd: any): string {
    const len = this.GetWindowTextLengthW(hWnd)
    if (len === 0) return ''
    const buf = Buffer.alloc((len + 1) * 2)
    this.GetWindowTextW(hWnd, buf, len + 1)
    return buf.toString('ucs2', 0, len * 2)
  }

  private getClassName(hWnd: any): string {
    const buf = Buffer.alloc(512)
    const len = this.GetClassNameW(hWnd, buf, 256)
    return buf.toString('ucs2', 0, len * 2)
  }

  private async waitForWeChatWindow(timeoutMs = 25000): Promise<number | null> {
    if (!this.ensureUser32()) return null
    const startTime = Date.now()
    while (Date.now() - startTime < timeoutMs) {
      let foundPid: number | null = null
      const enumWindowsCallback = this.koffi.register((hWnd: any) => {
        if (!this.IsWindowVisible(hWnd)) return true
        if (!this.isWeChatWindowTitle(this.getWindowTitle(hWnd))) return true
        const pidBuf = Buffer.alloc(4)
        this.GetWindowThreadProcessId(hWnd, pidBuf)
        const pid = pidBuf.readUInt32LE(0)
        if (pid) {
          foundPid = pid
          return false
        }
        return true
      }, this.WNDENUMPROC_PTR)

      this.EnumWindows(enumWindowsCallback, 0)
      this.koffi.unregister(enumWindowsCallback)

      if (foundPid) return foundPid
      await new Promise(r => setTimeout(r, 500))
    }
    return null
  }

  private collectChildWindowInfos(parent: any): Array<{ title: string; className: string }> {
    const children: Array<{ title: string; className: string }> = []
    const enumChildCallback = this.koffi.register((hChild: any) => {
      children.push({ title: this.getWindowTitle(hChild).trim(), className: this.getClassName(hChild).trim() })
      return true
    }, this.WNDENUMPROC_PTR)
    this.EnumChildWindows(parent, enumChildCallback, 0)
    this.koffi.unregister(enumChildCallback)
    return children
  }

  private hasReadyComponents(children: Array<{ title: string; className: string }>): boolean {
    if (children.length === 0) return false
    const readyTexts = ['聊天', '登录', '账号']
    const readyClassMarkers = ['WeChat', 'Weixin', 'TXGuiFoundation', 'Qt5', 'ChatList', 'MainWnd', 'BrowserWnd', 'ListView']
    const readyChildCountThreshold = 14

    let classMatchCount = 0
    let titleMatchCount = 0
    let hasValidClassName = false

    for (const child of children) {
      const normalizedTitle = child.title.replace(/\s+/g, '')
      if (normalizedTitle) {
        if (readyTexts.some(marker => normalizedTitle.includes(marker))) return true
        titleMatchCount += 1
      }
      if (child.className) {
        if (readyClassMarkers.some(marker => child.className.includes(marker))) return true
        if (child.className.length > 5) {
          classMatchCount += 1
          hasValidClassName = true
        }
      }
    }
    if (classMatchCount >= 3 || titleMatchCount >= 2) return true
    if (children.length >= readyChildCountThreshold) return true
    if (hasValidClassName && children.length >= 5) return true
    return false
  }

  private isLoginRelatedText(value: string): boolean {
    const normalized = String(value || '').replace(/\s+/g, '').toLowerCase()
    if (!normalized) return false
    const keywords = ['登录', '扫码', '二维码', '请在手机上确认', '手机确认', '切换账号', 'wechatlogin', 'qrcode', 'scan']
    return keywords.some(keyword => normalized.includes(keyword))
  }

  private async detectWeChatLoginRequired(pid: number): Promise<boolean> {
    if (!this.ensureUser32()) return false
    let loginRequired = false
    const enumWindowsCallback = this.koffi.register((hWnd: any) => {
      if (!this.IsWindowVisible(hWnd)) return true
      const title = this.getWindowTitle(hWnd)
      if (!this.isWeChatWindowTitle(title)) return true

      const pidBuf = Buffer.alloc(4)
      this.GetWindowThreadProcessId(hWnd, pidBuf)
      if (pidBuf.readUInt32LE(0) !== pid) return true

      if (this.isLoginRelatedText(title)) {
        loginRequired = true
        return false
      }
      for (const child of this.collectChildWindowInfos(hWnd)) {
        if (this.isLoginRelatedText(child.title) || this.isLoginRelatedText(child.className)) {
          loginRequired = true
          return false
        }
      }
      return true
    }, this.WNDENUMPROC_PTR)

    this.EnumWindows(enumWindowsCallback, 0)
    this.koffi.unregister(enumWindowsCallback)
    return loginRequired
  }

  private async waitForWeChatWindowComponents(pid: number, timeoutMs = 15000): Promise<boolean> {
    if (!this.ensureUser32()) return true
    const startTime = Date.now()
    while (Date.now() - startTime < timeoutMs) {
      let ready = false
      const enumWindowsCallback = this.koffi.register((hWnd: any) => {
        if (!this.IsWindowVisible(hWnd)) return true
        if (!this.isWeChatWindowTitle(this.getWindowTitle(hWnd))) return true

        const pidBuf = Buffer.alloc(4)
        this.GetWindowThreadProcessId(hWnd, pidBuf)
        if (pidBuf.readUInt32LE(0) !== pid) return true

        if (this.hasReadyComponents(this.collectChildWindowInfos(hWnd))) {
          ready = true
          return false
        }
        return true
      }, this.WNDENUMPROC_PTR)

      this.EnumWindows(enumWindowsCallback, 0)
      this.koffi.unregister(enumWindowsCallback)

      if (ready) return true
      await new Promise(r => setTimeout(r, 500))
    }
    return true
  }

  /**
   * 自动获取数据库密钥（核心流程，移植自 WeFlow）
   */
  async autoGetDbKey(
    timeoutMs = 60_000,
    onStatus?: (message: string, level: number) => void
  ): Promise<DbKeyResult> {
    if (!this.ensureWin32()) return { success: false, error: '仅支持 Windows' }
    if (!this.ensureLoaded()) return { success: false, error: 'wx_key.dll 未加载' }
    if (!this.ensureKernel32()) return { success: false, error: 'Kernel32 Init Failed' }

    const logs: string[] = []

    onStatus?.('正在查找微信进程...', 0)
    const pid = await this.findWeChatPid()
    if (!pid) {
      const err = '未找到微信进程，请先启动微信'
      onStatus?.(err, 2)
      return { success: false, error: err }
    }

    onStatus?.('检测到微信窗口 (PID: ' + pid + ')，正在获取...', 0)
    onStatus?.('正在检测微信界面组件...', 0)
    await this.waitForWeChatWindowComponents(pid, 15000)

    let ok = this.initHook(pid)
    if (!ok) {
      // 失败后先尝试清理残留 Hook 状态，再重试一次（多实例并发注入时可能残留）
      onStatus?.('首次注入失败，尝试清理残留状态后重试...', 0)
      try { this.cleanupHook() } catch { }
      await new Promise(resolve => setTimeout(resolve, 400))
      ok = this.initHook(pid)
    }
    if (!ok) {
      const error = this.getLastErrorMsg ? this.decodeCString(this.getLastErrorMsg()) : ''
      if (error) {
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
        if (error.includes('已经初始化') || error.toLowerCase().includes('already') || error.includes('重复')) {
          return {
            success: false,
            error: '微信进程内存在未清理的密钥 Hook 状态（之前获取密钥未正常退出）。\n\n解决方法：完全退出微信（任务栏右键 → 退出），重新打开并登录后，再点击"一键配置"重试。'
          }
        }
        return { success: false, error }
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
            if (this.isLoginRelatedText(msg)) loginRequiredDetected = true
            onStatus?.(msg, level)
          }
        }
        await new Promise(resolve => setTimeout(resolve, 120))
      }
    } finally {
      try { this.cleanupHook() } catch { }
    }

    const loginRequired = loginRequiredDetected || await this.detectWeChatLoginRequired(pid)
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
}

export const keyService = new KeyService()
