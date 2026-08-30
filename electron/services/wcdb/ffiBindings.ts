import { existsSync } from 'fs'
import { dirname, join } from 'path'
import { getWcdbDllPath, preloadDependencyPaths } from './paths'
import { formatIntegrityError, verifyResourceFile } from '../dllIntegrity'

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
  // 伴生监控库 pingnest_monitor.dll（可选）：wcdb_api.dll 缺少管道导出时的替代通道
  private companionLib: any = null
  private companionStart: any = null
  private companionStop: any = null

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
  get companionStartFn(): any { return this.companionStart }
  get companionStopFn(): any { return this.companionStop }
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

  /** win32 加载前的完整性校验：主库与两个依赖 DLL 任一不过 SHA256 清单即拒载 */
  private verifyWin32Resources(resourcesPath: string | null, dllPath: string): string | null {
    const manifestPath = this.resolveManifestPath(resourcesPath, dllPath)
    if (!manifestPath) {
      return formatIntegrityError('完整性清单不存在（已尝试: ' + this.manifestCandidates(resourcesPath, dllPath).join(' | ') + '）。请在项目根目录运行 npm install 或 npm run dev 重新生成')
    }
    const apiCheck = verifyResourceFile(manifestPath, 'wcdb/win32/x64/wcdb_api.dll', dllPath)
    if (!apiCheck.ok) return formatIntegrityError(apiCheck.detail || '未知原因')
    for (const dep of preloadDependencyPaths(dllPath)) {
      if (!existsSync(dep)) continue
      const manifestKey = dep.toLowerCase().endsWith('wcdb.dll')
        ? 'wcdb/win32/x64/WCDB.dll'
        : 'wcdb/win32/x64/SDL2.dll'
      const depCheck = verifyResourceFile(manifestPath, manifestKey, dep)
      if (!depCheck.ok) return formatIntegrityError(depCheck.detail || '未知原因')
    }
    return null
  }

  // 清单与 resources/ 目录同级。按候选顺序解析：
  // ① 传入的资源根（打包版 = <安装>/resources）；② DLL 自身向上三级（wcdb/win32/x64 → resources），
  //    兼容 DLL 经 WCDB_DLL_PATH/env 指到别处的场景；③ 开发态项目根 resources/。
  private manifestCandidates(resourcesPath: string | null, dllPath: string): string[] {
    return [
      resourcesPath ? join(resourcesPath, 'dll-manifest.json') : null,
      join(dirname(dllPath), '..', '..', '..', 'dll-manifest.json'),
      join(process.cwd(), 'resources', 'dll-manifest.json')
    ].filter((candidate): candidate is string => !!candidate)
  }

  private resolveManifestPath(resourcesPath: string | null, dllPath: string): string | null {
    return this.manifestCandidates(resourcesPath, dllPath).find((candidate) => existsSync(candidate)) || null
  }

  /**
   * 伴生监控库加载（可选能力，任何失败都只降级轮询，不阻断主库初始化）：
   * wcdb_api.dll 未导出监控管道接口时，尝试加载同目录的 pingnest_monitor.dll
   * （ReadDirectoryChangesW 目录监视 + 命名管道推送）。同样先过 SHA256 清单再 koffi.load。
   * 管道名由 start 的 suffix 参数决定、两侧规则一致，因此无需绑定 pipe_name 查询接口。
   */
  private tryLoadMonitorCompanion(resourcesPath: string | null, dllPath: string, log: WcdbLogFn): void {
    try {
      if (process.platform !== 'win32') return
      const companionPath = join(dirname(dllPath), 'pingnest_monitor.dll')
      if (!existsSync(companionPath)) {
        console.info('[wcdbCore] 监控伴生库不存在，消息检测使用本地轮询通道')
        log('[bootstrap] 监控伴生库不存在（可选），消息检测将使用本地轮询通道', true)
        return
      }
      const manifestPath = this.resolveManifestPath(resourcesPath, dllPath)
      if (!manifestPath) {
        console.warn('[wcdbCore] 完整性清单不存在，监控伴生库跳过，消息检测使用本地轮询通道')
        log('[bootstrap] 跳过监控伴生库：完整性清单不存在（可选能力，降级轮询）', true)
        return
      }
      const check = verifyResourceFile(manifestPath, 'wcdb/win32/x64/pingnest_monitor.dll', companionPath)
      if (!check.ok) {
        console.warn('[wcdbCore] 监控伴生库完整性校验失败，消息检测使用本地轮询通道: ' + (check.detail || '未知原因'))
        log('[bootstrap] 监控伴生库完整性校验失败（可选能力，降级轮询）: ' + (check.detail || '未知原因'), true)
        return
      }
      this.companionLib = this.koffi.load(companionPath)
      this.companionStart = this.companionLib.func('int32 pingnest_monitor_start(const char* watch_dir, const char* pipe_suffix)')
      this.companionStop = this.companionLib.func('int32 pingnest_monitor_stop()')
      console.info('[wcdbCore] 监控伴生库 pingnest_monitor.dll 已启用，数据库变更将实时推送')
      log('[bootstrap] 监控伴生库已加载: ' + companionPath, true)
    } catch (e) {
      this.companionLib = null
      this.companionStart = null
      this.companionStop = null
      console.warn('[wcdbCore] 监控伴生库加载失败，消息检测使用本地轮询通道: ' + String(e))
      log('[bootstrap] 监控伴生库加载失败（可选能力，降级轮询）: ' + String(e), true)
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

      // 完整性校验先于任何 koffi.load：被替换/损坏的 DLL 一律拒载
      if (process.platform === 'win32') {
        const integrityError = this.verifyWin32Resources(resourcesPath, dllPath)
        if (integrityError) {
          lastDllInitError = integrityError
          log('[bootstrap] integrity check failed: ' + integrityError, true)
          return { ok: false, error: lastDllInitError }
        }
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
        // 可选能力，不是故障：部分 wcdb_api.dll 构建未导出管道接口，
        // 置空后先尝试伴生监控库（tryLoadMonitorCompanion），不行再降级轮询。
        console.info('[wcdbCore] wcdb_api.dll 未内置监控管道接口（可选），尝试伴生监控库')
        this.wcdbStartMonitorPipe = null
        this.wcdbStopMonitorPipe = null
        this.wcdbGetMonitorPipeName = null
      }
      if (!this.wcdbStartMonitorPipe) this.tryLoadMonitorCompanion(resourcesPath, dllPath, log)

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
