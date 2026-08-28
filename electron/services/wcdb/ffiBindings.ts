import { existsSync } from 'fs'
import { dirname, join } from 'path'
import { getWcdbDllPath, preloadDependencyPaths } from './paths'

export type WcdbLogFn = (message: string, force?: boolean) => void

/**
 * WCDB 原生库 FFI 绑定（逻辑原样搬迁自 wcdbCore.initialize，勿随意改写）：
 * - 兼容两套原生构建：WeFlow 保护版带 InitProtection 授权入口，
 *   EchoTrace MIT legacy 版只有基础 wcdb_* ABI；
 * - 可选函数逐个 try-catch 探测，legacy 构建缺失游标/SQL/管道接口时降级；
 * - wcdb_init 失败时尽量取回 C++ 侧日志帮助定位。
 */
export class WcdbFfiBindings {
  private koffi: any = null
  private lib: any = null

  private wcdbInitProtection: any = null
  private wcdbInit: any = null
  private wcdbShutdown: any = null
  private wcdbOpenAccount: any = null
  private wcdbSetMyWxid: any = null
  private wcdbFreeString: any = null
  private wcdbGetSessions: any = null
  private wcdbGetMessages: any = null
  private wcdbGetMessageCount: any = null
  private wcdbGetDisplayNames: any = null
  private wcdbGetAvatarUrls: any = null
  private wcdbGetContact: any = null
  private wcdbGetGroupNicknames: any = null
  private wcdbGetLogs: any = null
  private wcdbOpenMessageCursor: any = null
  private wcdbOpenMessageCursorLite: any = null
  private wcdbFetchMessageBatch: any = null
  private wcdbCloseMessageCursor: any = null
  private wcdbExecQuery: any = null
  private wcdbStartMonitorPipe: any = null
  private wcdbStopMonitorPipe: any = null
  private wcdbGetMonitorPipeName: any = null

  get openAccount(): any { return this.wcdbOpenAccount }
  get getSessionsFn(): any { return this.wcdbGetSessions }
  get getMessagesFn(): any { return this.wcdbGetMessages }
  get getDisplayNamesFn(): any { return this.wcdbGetDisplayNames }
  get getAvatarUrlsFn(): any { return this.wcdbGetAvatarUrls }
  get getContactFn(): any { return this.wcdbGetContact }
  get getGroupNicknamesFn(): any { return this.wcdbGetGroupNicknames }
  get execQueryFn(): any { return this.wcdbExecQuery }
  get openMessageCursorFn(): any { return this.wcdbOpenMessageCursorLite || this.wcdbOpenMessageCursor }
  get hasMessageCursor(): boolean { return !!(this.wcdbOpenMessageCursorLite || this.wcdbOpenMessageCursor) }
  get fetchMessageBatchFn(): any { return this.wcdbFetchMessageBatch }
  get closeMessageCursorFn(): any { return this.wcdbCloseMessageCursor }
  get startMonitorPipeFn(): any { return this.wcdbStartMonitorPipe }
  get stopMonitorPipeFn(): any { return this.wcdbStopMonitorPipe }
  get getMonitorPipeNameFn(): any { return this.wcdbGetMonitorPipeName }
  get setMyWxidFn(): any { return this.wcdbSetMyWxid }

  formatInitProtectionError(code: number): string {
    const messages: Record<number, string> = {
      '-1006': 'WCDB 授权或宿主环境校验失败。请使用与 PingNest 兼容的 wcdb_api.dll，不要直接使用 WeFlow/CipherTalk 授权版本',
      '-102': 'WCDB 宿主校验失败，请确认使用的是为当前应用构建的 wcdb_api.dll',
      '-101': 'WCDB 授权校验失败，请使用有效且未过期的 wcdb_api.dll',
      '-3001': '未找到数据库目录 (db_storage)，请确认已选择正确的微信数据目录（应包含以 wxid_ 开头的子文件夹）',
      '-3002': '未找到 session.db 文件，请确认微信已登录并且数据目录完整',
      '-3003': '数据库句柄无效，请重试',
      '-3004': '恢复数据库连接失败，请重试',
      '-2301': '动态库加载失败，请检查安装是否完整',
      '-2302': 'WCDB 初始化异常，请重试',
      '-2303': 'WCDB 未能成功初始化'
    }
    const msg = messages[code]
    return msg ? msg + ' (错误码: ' + code + ')' : '操作失败，错误码: ' + code
  }

  /** 解码 wcdb_* 返回的 JSON 指针并释放（失败时也尽力释放，避免原生内存泄漏） */
  decodeJsonPtr(outPtr: any): string | null {
    if (!outPtr) return null
    try {
      const jsonStr = this.koffi.decode(outPtr, 'char', -1)
      this.wcdbFreeString(outPtr)
      return jsonStr
    } catch (e) {
      try { this.wcdbFreeString(outPtr) } catch { /* 尽力释放：指针可能已失效 */ }
      return null
    }
  }

  freeString(ptr: any): void {
    if (ptr === null || ptr === undefined) return
    try { this.wcdbFreeString(ptr) } catch { /* 尽力释放：指针可能已失效 */ }
  }

  /** wcdb_shutdown：关闭前必须调用，否则句柄泄漏 */
  shutdown(): void {
    if (this.wcdbShutdown) {
      try { this.wcdbShutdown() } catch (e) {
        console.error('[wcdbCore] WCDB shutdown 出错:', e)
      }
    }
  }

  decodeCString(ptr: any): string {
    try {
      if (typeof ptr === 'string') return ptr
      return this.koffi.decode(ptr, 'char', -1)
    } catch {
      return ''
    }
  }

  /**
   * 加载 DLL、探测 ABI 并执行 wcdb_init。
   * 返回 ok=false 时 error 已是面向用户的中文错误信息。
   */
  async initialize(resourcesPath: string | null, log: WcdbLogFn): Promise<{ ok: boolean; error?: string }> {
    let lastDllInitError: string | null = null
    try {
      this.koffi = require('koffi')
      const dllPath = getWcdbDllPath(resourcesPath)
      log('[bootstrap] initialize platform=' + process.platform + ' dllPath=' + dllPath, true)

      if (!existsSync(dllPath)) {
        console.error('[wcdbCore] WCDB数据服务不存在:', dllPath)
        lastDllInitError = '数据服务不存在: ' + dllPath
        return { ok: false, error: lastDllInitError }
      }

      // 预加载依赖库（WCDB.dll / SDL2.dll / libWCDB.dylib）
      for (const dep of preloadDependencyPaths(dllPath)) {
        if (!existsSync(dep)) continue
        try {
          this.koffi.load(dep)
        } catch (e) {
          console.warn('[wcdbCore] 预加载依赖库失败（可能非致命）:', dep, e)
        }
      }

      this.lib = this.koffi.load(dllPath)
      log('[bootstrap] koffi.load ok', true)

      // InitProtection is present in the protected WeFlow builds. EchoTrace's
      // MIT legacy build intentionally has no protection entry point, but does
      // expose the complete basic wcdb_* ABI and can be used without spoofing
      // the host executable metadata.
      try {
        try {
          this.wcdbInitProtection = this.lib.func('int32 InitProtection(const char* resourcePath)')
        } catch {
          this.wcdbInitProtection = null
          log('[bootstrap] InitProtection export missing; probing legacy ABI', true)
        }

        if (this.wcdbInitProtection) {
          const dllDir = dirname(dllPath)
          const resourcePaths = [
            dllDir,
            dirname(dllDir),
            process.resourcesPath,
            process.resourcesPath ? join(process.resourcesPath as string, 'resources') : null,
            resourcesPath,
            join(process.cwd(), 'resources')
          ].filter(Boolean)

          let protectionOk = false
          let protectionCode = -1
          let bestFailCode: number | null = null
          const scoreFailCode = (code: number): number => {
            if (code >= -2212 && code <= -2201) return 0
            if (code === -102 || code === -101 || code === -1006) return 1
            return 2
          }
          for (const resPath of resourcePaths) {
            try {
              protectionCode = Number(this.wcdbInitProtection(resPath))
              log('[bootstrap] InitProtection(' + resPath + ') rc=' + protectionCode, true)
              if (protectionCode === 0) {
                protectionOk = true
                break
              }
              if (bestFailCode === null || scoreFailCode(protectionCode) < scoreFailCode(bestFailCode)) {
                bestFailCode = protectionCode
              }
            } catch (e) {
              log('[bootstrap] InitProtection(' + resPath + ') THROW: ' + String(e), true)
            }
          }
          if (!protectionOk) {
            const finalCode = bestFailCode ?? protectionCode
            lastDllInitError = this.formatInitProtectionError(finalCode)
            log('[bootstrap] InitProtection failed finalCode=' + finalCode, true)
            return { ok: false, error: lastDllInitError }
          }
        }
      } catch (e) {
        lastDllInitError = this.formatInitProtectionError(-2301)
        return { ok: false, error: lastDllInitError }
      }

      this.wcdbInit = this.lib.func('int32 wcdb_init()')
      this.wcdbShutdown = this.lib.func('int32 wcdb_shutdown()')
      this.wcdbOpenAccount = this.lib.func('int32 wcdb_open_account(const char* path, const char* key, _Out_ int64* handle)')
      this.wcdbFreeString = this.lib.func('void wcdb_free_string(void* ptr)')

      try {
        this.wcdbSetMyWxid = this.lib.func('int32 wcdb_set_my_wxid(int64 handle, const char* wxid)')
      } catch {
        this.wcdbSetMyWxid = null
      }

      this.wcdbGetSessions = this.lib.func('int32 wcdb_get_sessions(int64 handle, _Out_ void** outJson)')
      this.wcdbGetMessages = this.lib.func('int32 wcdb_get_messages(int64 handle, const char* username, int32 limit, int32 offset, _Out_ void** outJson)')
      this.wcdbGetMessageCount = this.lib.func('int32 wcdb_get_message_count(int64 handle, const char* username, _Out_ int32* outCount)')
      this.wcdbGetDisplayNames = this.lib.func('int32 wcdb_get_display_names(int64 handle, const char* usernamesJson, _Out_ void** outJson)')
      this.wcdbGetAvatarUrls = this.lib.func('int32 wcdb_get_avatar_urls(int64 handle, const char* usernamesJson, _Out_ void** outJson)')
      try {
        this.wcdbGetContact = this.lib.func('int32 wcdb_get_contact(int64 handle, const char* username, _Out_ void** outJson)')
      } catch {
        this.wcdbGetContact = null
      }

      try {
        this.wcdbGetGroupNicknames = this.lib.func('int32 wcdb_get_group_nicknames(int64 handle, const char* chatroomId, _Out_ void** outJson)')
      } catch {
        this.wcdbGetGroupNicknames = null
      }

      try {
        this.wcdbOpenMessageCursor = this.lib.func('int32 wcdb_open_message_cursor(int64 handle, const char* sessionId, int32 batchSize, int32 ascending, int32 beginTimestamp, int32 endTimestamp, _Out_ int64* outCursor)')
      } catch {
        this.wcdbOpenMessageCursor = null
      }
      try {
        this.wcdbOpenMessageCursorLite = this.lib.func('int32 wcdb_open_message_cursor_lite(int64 handle, const char* sessionId, int32 batchSize, int32 ascending, int32 beginTimestamp, int32 endTimestamp, _Out_ int64* outCursor)')
      } catch {
        this.wcdbOpenMessageCursorLite = null
      }
      try {
        this.wcdbFetchMessageBatch = this.lib.func('int32 wcdb_fetch_message_batch(int64 handle, int64 cursor, _Out_ void** outJson, _Out_ int32* outHasMore)')
      } catch {
        this.wcdbFetchMessageBatch = null
      }
      try {
        this.wcdbCloseMessageCursor = this.lib.func('int32 wcdb_close_message_cursor(int64 handle, int64 cursor)')
      } catch {
        this.wcdbCloseMessageCursor = null
      }

      const requiredLegacy = [
        ['wcdb_init', this.wcdbInit],
        ['wcdb_open_account', this.wcdbOpenAccount],
        ['wcdb_get_sessions', this.wcdbGetSessions],
        ['wcdb_get_messages', this.wcdbGetMessages],
        ['wcdb_get_message_count', this.wcdbGetMessageCount],
        ['wcdb_get_display_names', this.wcdbGetDisplayNames],
        ['wcdb_get_avatar_urls', this.wcdbGetAvatarUrls]
      ]
      if (!this.wcdbInitProtection) {
        const missing = requiredLegacy.filter(([, fn]) => !fn).map(([name]) => name)
        if (missing.length > 0) {
          lastDllInitError = '检测到不兼容的 wcdb_api.dll：缺少基础接口 ' + missing.join(', ')
          log('[bootstrap] legacy ABI rejected missing=' + missing.join(','), true)
          return { ok: false, error: lastDllInitError }
        }
      }

      try {
        this.wcdbExecQuery = this.lib.func('int32 wcdb_exec_query(int64 handle, const char* kind, const char* path, const char* sql, _Out_ void** outJson)')
      } catch {
        this.wcdbExecQuery = null
      }

      try {
        this.wcdbStartMonitorPipe = this.lib.func('int32 wcdb_start_monitor_pipe()')
        this.wcdbStopMonitorPipe = this.lib.func('void wcdb_stop_monitor_pipe()')
        this.wcdbGetMonitorPipeName = this.lib.func('int32 wcdb_get_monitor_pipe_name(_Out_ void** outName)')
      } catch (e) {
        console.warn('[wcdbCore] 监控管道函数加载失败:', e)
        this.wcdbStartMonitorPipe = null
        this.wcdbStopMonitorPipe = null
        this.wcdbGetMonitorPipeName = null
      }

      try {
        this.wcdbGetLogs = this.lib.func('int32 wcdb_get_logs(_Out_ void** outJson)')
      } catch {
        this.wcdbGetLogs = null
      }

      const initResult = this.wcdbInit()
      log('[bootstrap] wcdb_init rc=' + initResult, true)
      if (initResult !== 0) {
        // 尝试读取 C++ 侧日志定位失败原因
        if (this.wcdbGetLogs) {
          try {
            const outPtr = [null as any]
            const logsRc = this.wcdbGetLogs(outPtr)
            if (logsRc === 0 && outPtr[0]) {
              const jsonStr = this.koffi.decode(outPtr[0], 'char', -1)
              try { this.wcdbFreeString(outPtr[0]) } catch { /* 尽力释放 */ }
              log('[bootstrap] C++ logs: ' + String(jsonStr || '').slice(0, 2000), true)
              console.error('[wcdbCore] C++ logs:', String(jsonStr || '').slice(0, 2000))
            }
          } catch { /* 诊断日志读取失败不影响主流程 */ }
        }
        lastDllInitError = this.formatInitProtectionError(initResult)
        return { ok: false, error: lastDllInitError }
      }

      return { ok: true }
    } catch (e) {
      console.error('[wcdbCore] WCDB 初始化异常:', e)
      lastDllInitError = this.formatInitProtectionError(-2302)
      return { ok: false, error: lastDllInitError }
    }
  }
}
