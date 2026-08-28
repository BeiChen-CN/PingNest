/**
 * Win32 API 的 koffi 绑定（kernel32 / user32）。
 * 独立成模块：进程查找、窗口枚举与 wx_key.dll 注入都需要原生调用，
 * 但职责不同——这里只负责"声明并持有函数指针"。
 */
export class Win32Api {
  private koffi: any = null
  private kernel32: any = null
  private user32: any = null

  // kernel32
  OpenProcess: any = null
  CloseHandle: any = null
  QueryFullProcessImageNameW: any = null

  // user32
  EnumWindows: any = null
  EnumChildWindows: any = null
  GetWindowTextW: any = null
  GetWindowTextLengthW: any = null
  GetClassNameW: any = null
  GetWindowThreadProcessId: any = null
  IsWindowVisible: any = null
  IsIconic: any = null
  ShowWindow: any = null
  SetForegroundWindow: any = null
  private WNDENUMPROC_PTR: any = null

  ensureKoffi(): any {
    if (!this.koffi) this.koffi = require('koffi')
    return this.koffi
  }

  ensureKernel32(): boolean {
    if (this.kernel32) return true
    try {
      const koffi = this.ensureKoffi()
      this.kernel32 = koffi.load('kernel32.dll')
      this.OpenProcess = this.kernel32.func('OpenProcess', 'void*', ['uint32', 'bool', 'uint32'])
      this.CloseHandle = this.kernel32.func('CloseHandle', 'bool', ['void*'])
      this.QueryFullProcessImageNameW = this.kernel32.func('QueryFullProcessImageNameW', 'bool', ['void*', 'uint32', koffi.out('uint16*'), koffi.out('uint32*')])
      return true
    } catch (e) {
      console.error('[KeyService] kernel32 初始化失败:', e)
      return false
    }
  }

  ensureUser32(): boolean {
    if (this.user32) return true
    try {
      const koffi = this.ensureKoffi()
      this.user32 = koffi.load('user32.dll')

      const WNDENUMPROC = koffi.proto('bool __stdcall (void *hWnd, intptr_t lParam)')
      this.WNDENUMPROC_PTR = koffi.pointer(WNDENUMPROC)

      this.EnumWindows = this.user32.func('EnumWindows', 'bool', [this.WNDENUMPROC_PTR, 'intptr_t'])
      this.EnumChildWindows = this.user32.func('EnumChildWindows', 'bool', ['void*', this.WNDENUMPROC_PTR, 'intptr_t'])
      this.GetWindowTextW = this.user32.func('GetWindowTextW', 'int', ['void*', koffi.out('uint16*'), 'int'])
      this.GetWindowTextLengthW = this.user32.func('GetWindowTextLengthW', 'int', ['void*'])
      this.GetClassNameW = this.user32.func('GetClassNameW', 'int', ['void*', koffi.out('uint16*'), 'int'])
      this.GetWindowThreadProcessId = this.user32.func('GetWindowThreadProcessId', 'uint32', ['void*', koffi.out('uint32*')])
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

  /** 注册 Win32 回调（EnumWindows 等），用完必须 unregisterCallback 释放 */
  registerCallback(callback: (hWnd: any, lParam?: any) => boolean): any {
    const koffi = this.ensureKoffi()
    return koffi.register(callback, this.WNDENUMPROC_PTR)
  }

  unregisterCallback(callback: any): void {
    try { this.ensureKoffi().unregister(callback) } catch { /* 尽力注销：回调可能已被释放 */ }
  }
}
