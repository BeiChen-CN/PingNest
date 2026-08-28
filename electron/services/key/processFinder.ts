import { execFile } from 'child_process'
import { promisify } from 'util'
import { Win32Api } from './win32Api'

const execFileAsync = promisify(execFile)

/**
 * 微信进程与主窗口的发现逻辑：
 * - 进程优先（tasklist 按 Weixin.exe/WeChat.exe 找 PID）；
 * - 找不到进程时退回窗口标题枚举（微信不同版本主窗口标题可能短暂变化，
 *   因此有 PID 时不再依赖标题）；
 * - 登录态检测靠子窗口文本/类名猜测，属于对微信版本行为的启发式判断。
 */
export class WeChatProcessFinder {
  private readonly win32 = new Win32Api()

  private isWeChatWindowTitle(title: string): boolean {
    const normalized = title.trim()
    if (!normalized) return false
    const lower = normalized.toLowerCase()
    return normalized === '微信' || lower === 'wechat' || lower === 'weixin'
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

  /**
   * 激活已运行的微信主窗口，供通知点击使用。
   *
   * 微信不同版本的主窗口标题可能短暂变化，因此优先使用运行进程
   * PID 识别窗口；只有无法取得 PID 时才退回到标题识别。
   */
  async focusWeChatWindow(): Promise<boolean> {
    if (process.platform !== 'win32' || !this.win32.ensureUser32()) return false

    let preferredPid: number | null = null
    try {
      preferredPid = await this.findWeChatPid(0)
    } catch { /* 进程查找失败按"无 PID"处理，退回窗口标题匹配 */ }

    const candidates: Array<{ hWnd: any; pid: number }> = []
    const enumWindowsCallback = this.win32.registerCallback((hWnd: any) => {
      if (!this.win32.IsWindowVisible(hWnd)) return true

      const pidBuf = Buffer.alloc(4)
      this.win32.GetWindowThreadProcessId(hWnd, pidBuf)
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
    })

    try {
      this.win32.EnumWindows(enumWindowsCallback, 0)
    } finally {
      this.win32.unregisterCallback(enumWindowsCallback)
    }

    const target = candidates.find((candidate) => candidate.pid === preferredPid) || candidates[0]
    if (!target) return false

    try {
      if (this.win32.IsIconic(target.hWnd)) this.win32.ShowWindow(target.hWnd, 9)
      return !!this.win32.SetForegroundWindow(target.hWnd)
    } catch (error) {
      console.warn('[KeyService] 激活微信窗口失败:', error)
      return false
    }
  }

  private getWindowTitle(hWnd: any): string {
    const len = this.win32.GetWindowTextLengthW(hWnd)
    if (len === 0) return ''
    const buf = Buffer.alloc((len + 1) * 2)
    this.win32.GetWindowTextW(hWnd, buf, len + 1)
    return buf.toString('ucs2', 0, len * 2)
  }

  private getClassName(hWnd: any): string {
    const buf = Buffer.alloc(512)
    const len = this.win32.GetClassNameW(hWnd, buf, 256)
    return buf.toString('ucs2', 0, len * 2)
  }

  private async waitForWeChatWindow(timeoutMs = 25000): Promise<number | null> {
    if (!this.win32.ensureUser32()) return null
    const startTime = Date.now()
    while (Date.now() - startTime < timeoutMs) {
      let foundPid: number | null = null
      const enumWindowsCallback = this.win32.registerCallback((hWnd: any) => {
        if (!this.win32.IsWindowVisible(hWnd)) return true
        if (!this.isWeChatWindowTitle(this.getWindowTitle(hWnd))) return true
        const pidBuf = Buffer.alloc(4)
        this.win32.GetWindowThreadProcessId(hWnd, pidBuf)
        const pid = pidBuf.readUInt32LE(0)
        if (pid) {
          foundPid = pid
          return false
        }
        return true
      })

      this.win32.EnumWindows(enumWindowsCallback, 0)
      this.win32.unregisterCallback(enumWindowsCallback)

      if (foundPid) return foundPid
      await new Promise(r => setTimeout(r, 500))
    }
    return null
  }

  private collectChildWindowInfos(parent: any): Array<{ title: string; className: string }> {
    const children: Array<{ title: string; className: string }> = []
    const enumChildCallback = this.win32.registerCallback((hChild: any) => {
      children.push({ title: this.getWindowTitle(hChild).trim(), className: this.getClassName(hChild).trim() })
      return true
    })
    this.win32.EnumChildWindows(parent, enumChildCallback, 0)
    this.win32.unregisterCallback(enumChildCallback)
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

  isLoginRelatedText(value: string): boolean {
    const normalized = String(value || '').replace(/\s+/g, '').toLowerCase()
    if (!normalized) return false
    const keywords = ['登录', '扫码', '二维码', '请在手机上确认', '手机确认', '切换账号', 'wechatlogin', 'qrcode', 'scan']
    return keywords.some(keyword => normalized.includes(keyword))
  }

  async detectWeChatLoginRequired(pid: number): Promise<boolean> {
    if (!this.win32.ensureUser32()) return false
    let loginRequired = false
    const enumWindowsCallback = this.win32.registerCallback((hWnd: any) => {
      if (!this.win32.IsWindowVisible(hWnd)) return true
      const title = this.getWindowTitle(hWnd)
      if (!this.isWeChatWindowTitle(title)) return true

      const pidBuf = Buffer.alloc(4)
      this.win32.GetWindowThreadProcessId(hWnd, pidBuf)
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
    })

    this.win32.EnumWindows(enumWindowsCallback, 0)
    this.win32.unregisterCallback(enumWindowsCallback)
    return loginRequired
  }

  async waitForWeChatWindowComponents(pid: number, timeoutMs = 15000): Promise<boolean> {
    if (!this.win32.ensureUser32()) return true
    const startTime = Date.now()
    while (Date.now() - startTime < timeoutMs) {
      let ready = false
      const enumWindowsCallback = this.win32.registerCallback((hWnd: any) => {
        if (!this.win32.IsWindowVisible(hWnd)) return true
        if (!this.isWeChatWindowTitle(this.getWindowTitle(hWnd))) return true

        const pidBuf = Buffer.alloc(4)
        this.win32.GetWindowThreadProcessId(hWnd, pidBuf)
        if (pidBuf.readUInt32LE(0) !== pid) return true

        if (this.hasReadyComponents(this.collectChildWindowInfos(hWnd))) {
          ready = true
          return false
        }
        return true
      })

      this.win32.EnumWindows(enumWindowsCallback, 0)
      this.win32.unregisterCallback(enumWindowsCallback)

      if (ready) return true
      await new Promise(r => setTimeout(r, 500))
    }
    return true
  }
}
