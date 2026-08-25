import { join, dirname } from 'path'
import { appendFileSync, existsSync, mkdirSync, readdirSync, statSync } from 'fs'
import { tmpdir } from 'os'
import { createHash } from 'crypto'
import { resolveSqlMessageSendState } from './messageDirection'
import { expandHomePath } from './dbPathService'
import { mapSqlMessageContent } from './sqlMessageContent'

// 数据服务初始化错误信息
let lastDllInitError: string | null = null

export function getLastDllInitError(): string | null {
  return lastDllInitError
}

/**
 * WcdbCore（移植自 WeFlow，裁剪）
 * 通过 koffi 加载 wcdb_api.dll，提供微信 4.0 数据库的解密查询与变更监控。
 */
export class WcdbCore {
  private resourcesPath: string | null = null
  private userDataPath: string | null = null
  private logEnabled = false
  private lib: any = null
  private koffi: any = null
  private initialized = false
  private handle: number | null = null
  private currentPath: string | null = null
  private currentKey: string | null = null
  private currentWxid: string | null = null
  private currentDbStoragePath: string | null = null

  // 函数引用
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

  // 监控管道
  private monitorPipeClient: any = null
  private monitorPipePath = ''
  private monitorCallback: ((type: string, json: string) => void) | null = null
  private monitorReconnectTimer: any = null
  private monitorAutoReconnect = true
  private monitorReconnectIntervalMs = 3000

  // 头像缓存
  private avatarUrlCache = new Map<string, { url: string; updatedAt: number }>()
  private readonly avatarCacheTtlMs = 10 * 60 * 1000

  setPaths(resourcesPath: string, userDataPath: string): void {
    this.resourcesPath = resourcesPath
    this.userDataPath = userDataPath
  }

  getLastInitError(): string | null {
    return lastDllInitError
  }

  setLogEnabled(enabled: boolean): void {
    this.logEnabled = enabled
  }

  private isLogEnabled(): boolean {
    return process.env.WCDB_LOG_ENABLED === '1' || this.logEnabled
  }

  private writeLog(message: string, force = false): void {
    if (!force && !this.isLogEnabled()) return
    const line = '[ ' + new Date().toISOString() + '] ' + message

    const candidates: string[] = []
    if (this.userDataPath) candidates.push(join(this.userDataPath, 'logs', 'wcdb.log'))
    if (process.env.WCDB_LOG_DIR) candidates.push(join(process.env.WCDB_LOG_DIR, 'logs', 'wcdb.log'))
    candidates.push(join(process.cwd(), 'logs', 'wcdb.log'))
    candidates.push(join(tmpdir(), 'pingnest-wcdb.log'))

    for (const filePath of Array.from(new Set(candidates))) {
      try {
        const dir = dirname(filePath)
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
        appendFileSync(filePath, line + '\n', { encoding: 'utf8' })
        return
      } catch { }
    }
  }

  /** 命名管道监控：微信数据库变化时回调 (type, json) */
  startMonitor(callback: (type: string, json: string) => void): boolean {
    if (!this.wcdbStartMonitorPipe) {
      this.writeLog('[monitor] wcdbStartMonitorPipe 未绑定', true)
      return false
    }
    this.monitorCallback = callback
    try {
      const result = this.wcdbStartMonitorPipe()
      this.writeLog('[monitor] wcdbStartMonitorPipe rc=' + result, true)
      if (result !== 0) return false

      let pipePath = '\\\\.\\pipe\\weflow_monitor'
      if (this.wcdbGetMonitorPipeName) {
        try {
          const namePtr = [null as any]
          if (this.wcdbGetMonitorPipeName(namePtr) === 0 && namePtr[0]) {
            pipePath = this.koffi.decode(namePtr[0], 'char', -1)
            this.wcdbFreeString(namePtr[0])
          }
        } catch { }
      }
      this.writeLog('[monitor] 管道: ' + pipePath, true)
      this.connectMonitorPipe(pipePath)
      return true
    } catch (e) {
      this.writeLog('[monitor] startMonitor exception: ' + String(e), true)
      return false
    }
  }

  setMonitorOptions(autoReconnect: boolean, intervalSeconds: number): void {
    this.monitorAutoReconnect = autoReconnect
    this.monitorReconnectIntervalMs = Math.max(1000, Math.min(15_000, Math.round(intervalSeconds * 1000)))
    if (!autoReconnect && this.monitorReconnectTimer) {
      clearTimeout(this.monitorReconnectTimer)
      this.monitorReconnectTimer = null
    }
  }

  private connectMonitorPipe(pipePath: string): void {
    this.monitorPipePath = pipePath
    const net = require('net')

    setTimeout(() => {
      if (!this.monitorCallback) return

      this.monitorPipeClient = net.createConnection(this.monitorPipePath, () => {
        this.writeLog('[monitor] 管道已连接: ' + this.monitorPipePath, true)
      })

      let buffer = ''
      this.monitorPipeClient.on('data', (data: Buffer) => {
        const rawChunk = data.toString('utf8')
        const normalizedChunk = rawChunk
          .replace(/\u0000/g, '\n')
          .replace(/}\s*{/g, '}\n{')

        buffer += normalizedChunk
        const lines = buffer.split(/\r?\n/)
        buffer = lines.pop() || ''
        for (const line of lines) {
          if (line.trim()) {
            try {
              const parsed = JSON.parse(line)
              this.monitorCallback?.(parsed.action || 'update', line)
            } catch {
              this.monitorCallback?.('update', line)
            }
          }
        }

        const tail = buffer.trim()
        if (tail.startsWith('{') && tail.endsWith('}')) {
          try {
            const parsed = JSON.parse(tail)
            this.monitorCallback?.(parsed.action || 'update', tail)
            buffer = ''
          } catch { }
        }
      })

      this.monitorPipeClient.on('error', (err: Error) => {
        this.writeLog('[monitor] 管道错误: ' + String(err?.message || err), true)
      })
      this.monitorPipeClient.on('close', () => {
        this.writeLog('[monitor] 管道关闭', true)
        this.monitorPipeClient = null
        this.scheduleReconnect()
      })
    }, 100)
  }

  private scheduleReconnect(): void {
    if (!this.monitorAutoReconnect || this.monitorReconnectTimer || !this.monitorCallback) return
    this.monitorReconnectTimer = setTimeout(() => {
      this.monitorReconnectTimer = null
      if (this.monitorCallback && !this.monitorPipeClient) {
        this.connectMonitorPipe(this.monitorPipePath)
      }
    }, this.monitorReconnectIntervalMs)
  }

  stopMonitor(): void {
    this.monitorCallback = null
    if (this.monitorReconnectTimer) {
      clearTimeout(this.monitorReconnectTimer)
      this.monitorReconnectTimer = null
    }
    if (this.monitorPipeClient) {
      this.monitorPipeClient.destroy()
      this.monitorPipeClient = null
    }
    if (this.wcdbStopMonitorPipe) {
      try { this.wcdbStopMonitorPipe() } catch { }
    }
  }

  /** 获取库文件路径（Windows 优先） */
  private getDllPath(): string {
    const isMac = process.platform === 'darwin'
    const isLinux = process.platform === 'linux'
    const isArm64 = process.arch === 'arm64'
    const libName = isMac ? 'libwcdb_api.dylib' : isLinux ? 'libwcdb_api.so' : 'wcdb_api.dll'
    const platformDir = isMac ? 'macos' : (isLinux ? 'linux' : 'win32')
    const archDir = isMac ? 'universal' : (isArm64 ? 'arm64' : 'x64')

    const envDllPath = process.env.WCDB_DLL_PATH
    if (envDllPath && envDllPath.length > 0) return envDllPath

    const isPackaged = typeof process['resourcesPath'] !== 'undefined'
    const resourcesPath = isPackaged ? process.resourcesPath : join(process.cwd(), 'resources')
    const roots = [
      process.env.WCDB_RESOURCES_PATH || null,
      this.resourcesPath || null,
      join(resourcesPath, 'resources'),
      resourcesPath,
      join(process.cwd(), 'resources')
    ].filter(Boolean) as string[]

    const normalizedArch = process.arch === 'arm64' ? 'arm64' : 'x64'
    const relativeCandidates = [
      join('wcdb', platformDir, archDir, libName),
      join('wcdb', platformDir, normalizedArch, libName),
      join('wcdb', platformDir, 'x64', libName),
      join('wcdb', platformDir, libName)
    ]

    for (const root of roots) {
      for (const relativePath of relativeCandidates) {
        const candidate = join(root, relativePath)
        if (existsSync(candidate)) return candidate
      }
    }
    return candidatesFallback(roots, relativeCandidates, libName)
  }

  private formatInitProtectionError(code: number): string {
    const messages: Record<number, string> = {
      '-1006': 'WCDB 授权已过期或宿主校验失败，请替换为有效的 wcdb_api.dll（不能通过修改 PingNest 名称解决）',
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

  private async initialize(): Promise<boolean> {
    if (this.initialized) return true

    try {
      this.koffi = require('koffi')
      const dllPath = this.getDllPath()
      this.writeLog('[bootstrap] initialize platform=' + process.platform + ' dllPath=' + dllPath, true)

      if (!existsSync(dllPath)) {
        console.error('[wcdbCore] WCDB数据服务不存在:', dllPath)
        lastDllInitError = '数据服务不存在: ' + dllPath
        return false
      }

      const dllDir = dirname(dllPath)

      // 预加载依赖库（WCDB.dll / SDL2.dll / libWCDB.dylib）
      const deps: string[] = []
      if (process.platform === 'darwin') deps.push(join(dllDir, 'libWCDB.dylib'))
      if (process.platform === 'win32') {
        deps.push(join(dllDir, 'WCDB.dll'))
        deps.push(join(dllDir, 'SDL2.dll'))
      }
      for (const dep of deps) {
        if (!existsSync(dep)) continue
        try {
          this.koffi.load(dep)
        } catch (e) {
          console.warn('[wcdbCore] 预加载依赖库失败（可能非致命）:', dep, e)
        }
      }

      this.lib = this.koffi.load(dllPath)
      this.writeLog('[bootstrap] koffi.load ok', true)

      // InitProtection
      try {
        this.wcdbInitProtection = this.lib.func('int32 InitProtection(const char* resourcePath)')
        const resourcePaths = [
          dllDir,
          dirname(dllDir),
          process.resourcesPath,
          process.resourcesPath ? join(process.resourcesPath as string, 'resources') : null,
          this.resourcesPath,
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
            this.writeLog('[bootstrap] InitProtection(' + resPath + ') rc=' + protectionCode, true)
            if (protectionCode === 0) {
              protectionOk = true
              break
            }
            if (bestFailCode === null || scoreFailCode(protectionCode) < scoreFailCode(bestFailCode)) {
              bestFailCode = protectionCode
            }
          } catch (e) {
            this.writeLog('[bootstrap] InitProtection(' + resPath + ') THROW: ' + String(e), true)
          }
        }
        if (!protectionOk) {
          const finalCode = bestFailCode ?? protectionCode
          lastDllInitError = this.formatInitProtectionError(finalCode)
          this.writeLog('[bootstrap] InitProtection failed finalCode=' + finalCode, true)
          return false
        }
      } catch (e) {
        lastDllInitError = this.formatInitProtectionError(-2301)
        return false
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
      this.wcdbGetContact = this.lib.func('int32 wcdb_get_contact(int64 handle, const char* username, _Out_ void** outJson)')

      try {
        this.wcdbGetGroupNicknames = this.lib.func('int32 wcdb_get_group_nicknames(int64 handle, const char* chatroomId, _Out_ void** outJson)')
      } catch {
        this.wcdbGetGroupNicknames = null
      }

      this.wcdbOpenMessageCursor = this.lib.func('int32 wcdb_open_message_cursor(int64 handle, const char* sessionId, int32 batchSize, int32 ascending, int32 beginTimestamp, int32 endTimestamp, _Out_ int64* outCursor)')
      try {
        this.wcdbOpenMessageCursorLite = this.lib.func('int32 wcdb_open_message_cursor_lite(int64 handle, const char* sessionId, int32 batchSize, int32 ascending, int32 beginTimestamp, int32 endTimestamp, _Out_ int64* outCursor)')
      } catch {
        this.wcdbOpenMessageCursorLite = null
      }
      this.wcdbFetchMessageBatch = this.lib.func('int32 wcdb_fetch_message_batch(int64 handle, int64 cursor, _Out_ void** outJson, _Out_ int32* outHasMore)')
      this.wcdbCloseMessageCursor = this.lib.func('int32 wcdb_close_message_cursor(int64 handle, int64 cursor)')

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
      this.writeLog('[bootstrap] wcdb_init rc=' + initResult, true)
      if (initResult !== 0) {
        // 尝试读取 C++ 侧日志定位失败原因
        if (this.wcdbGetLogs) {
          try {
            const outPtr = [null as any]
            const logsRc = this.wcdbGetLogs(outPtr)
            if (logsRc === 0 && outPtr[0]) {
              const jsonStr = this.koffi.decode(outPtr[0], 'char', -1)
              try { this.wcdbFreeString(outPtr[0]) } catch { }
              this.writeLog('[bootstrap] C++ logs: ' + String(jsonStr || '').slice(0, 2000), true)
              console.error('[wcdbCore] C++ logs:', String(jsonStr || '').slice(0, 2000))
            }
          } catch { }
        }
        lastDllInitError = this.formatInitProtectionError(initResult)
        return false
      }

      this.initialized = true
      lastDllInitError = null
      return true
    } catch (e) {
      console.error('[wcdbCore] WCDB 初始化异常:', e)
      lastDllInitError = this.formatInitProtectionError(-2302)
      return false
    }
  }

  /** 打开数据库 */
  async open(dbPath: string, hexKey: string, wxid: string): Promise<boolean> {
    try {
      const accountWxid = this.cleanAccountDirName(wxid)
      lastDllInitError = null
      if (!this.initialized) {
        const initOk = await this.initialize()
        if (!initOk) return false
      }

      if (this.handle !== null &&
        this.currentPath === dbPath &&
        this.currentKey === hexKey &&
        this.currentWxid === accountWxid) {
        return true
      }

      if (this.handle !== null) {
        this.close()
        const initOk = await this.initialize()
        if (!initOk) return false
      }

      const dbStoragePath = this.resolveDbStoragePath(dbPath, accountWxid)
      this.writeLog('[open] dbStoragePath=' + (dbStoragePath || 'null'), true)
      if (!dbStoragePath || !existsSync(dbStoragePath)) {
        lastDllInitError = this.formatInitProtectionError(-3001)
        return false
      }

      const sessionDbPath = this.findSessionDb(dbStoragePath)
      this.writeLog('[open] sessionDbPath=' + (sessionDbPath || 'null'), true)
      if (!sessionDbPath) {
        lastDllInitError = this.formatInitProtectionError(-3002)
        return false
      }

      this.writeLog('[open] key length=' + String(hexKey || '').length + ' dbPath=' + dbPath + ' wxid=' + wxid, true)
      const handleOut = [0]
      const result = this.wcdbOpenAccount(sessionDbPath, hexKey, handleOut)
      this.writeLog('[open] openAccount rc=' + result + ' handle=' + handleOut[0], true)
      if (result !== 0) {
        lastDllInitError = this.formatInitProtectionError(result)
        return false
      }

      const handle = handleOut[0]
      if (handle <= 0) {
        lastDllInitError = this.formatInitProtectionError(-3003)
        return false
      }

      this.handle = handle
      this.currentPath = dbPath
      this.currentKey = hexKey
      this.currentWxid = accountWxid
      this.currentDbStoragePath = dbStoragePath
      this.myRowIdCache.clear()
      this.initialized = true
      lastDllInitError = null

      if (this.wcdbSetMyWxid && accountWxid) {
        try { this.wcdbSetMyWxid(this.handle, accountWxid) } catch { }
      }
      this.writeLog('open ok handle=' + handle, true)
      return true
    } catch (e) {
      console.error('[wcdbCore] 打开数据库异常:', e)
      lastDllInitError = this.formatInitProtectionError(-3004)
      return false
    }
  }

  close(): void {
    if (this.handle !== null || this.initialized) {
      try { this.stopMonitor() } catch { }
      try { this.wcdbShutdown() } catch (e) {
        console.error('[wcdbCore] WCDB shutdown 出错:', e)
      }
      this.handle = null
      this.currentPath = null
      this.currentKey = null
      this.currentWxid = null
      this.currentDbStoragePath = null
      this.initialized = false
      this.avatarUrlCache.clear()
      this.myRowIdCache.clear()
    }
  }

  shutdown(): void {
    this.close()
  }

  isReady(): boolean {
    return this.initialized && this.handle !== null
  }

  private ensureReady(): boolean {
    return this.initialized && this.handle !== null
  }

  private decodeJsonPtr(outPtr: any): string | null {
    if (!outPtr) return null
    try {
      const jsonStr = this.koffi.decode(outPtr, 'char', -1)
      this.wcdbFreeString(outPtr)
      return jsonStr
    } catch (e) {
      try { this.wcdbFreeString(outPtr) } catch { }
      return null
    }
  }

  private parseMessageJson(jsonStr: string): any {
    const raw = String(jsonStr || '')
    if (!raw) return []
    const needsInt64Normalize = /"server_id"\s*:\s*-?\d{16,}/.test(raw)
    if (!needsInt64Normalize) return JSON.parse(raw)
    const normalized = raw.replace(/("server_id"\s*:\s*)(-?\d{16,})/g, '$1"$2"')
    return JSON.parse(normalized)
  }

  async getSessions(): Promise<{ success: boolean; sessions?: any[]; error?: string }> {
    if (!this.ensureReady()) return { success: false, error: 'WCDB 未连接' }
    try {
      await new Promise(resolve => setImmediate(resolve))
      const outPtr = [null as any]
      const result = this.wcdbGetSessions(this.handle, outPtr)
      await new Promise(resolve => setImmediate(resolve))
      if (result !== 0 || !outPtr[0]) return { success: false, error: '获取会话失败: ' + result }
      const jsonStr = this.decodeJsonPtr(outPtr[0])
      if (!jsonStr) return { success: false, error: '解析会话失败' }
      return { success: true, sessions: JSON.parse(jsonStr) }
    } catch (e) {
      return { success: false, error: String(e) }
    }
  }

  async getMessages(sessionId: string, limit: number, offset: number): Promise<{ success: boolean; messages?: any[]; error?: string }> {
    if (!this.ensureReady()) return { success: false, error: 'WCDB 未连接' }
    try {
      const outPtr = [null as any]
      const result = this.wcdbGetMessages(this.handle, sessionId, limit, offset, outPtr)
      if (result !== 0 || !outPtr[0]) return { success: false, error: '获取消息失败: ' + result }
      const jsonStr = this.decodeJsonPtr(outPtr[0])
      if (!jsonStr) return { success: false, error: '解析消息失败' }
      return { success: true, messages: this.parseMessageJson(jsonStr) }
    } catch (e) {
      return { success: false, error: String(e) }
    }
  }

  /** 获取指定时间之后的新消息（游标） */
  async getNewMessages(sessionId: string, minTime: number, limit = 1000): Promise<{ success: boolean; messages?: any[]; error?: string }> {
    if (!this.ensureReady()) return { success: false, error: 'WCDB 未连接' }
    try {
      // 1) 先尝试 C++ 游标（兼容旧版微信消息表）
      const openRes = await this.openMessageCursor(sessionId, limit, true, minTime, 0)
      this.writeLog('[getNewMessages] ' + sessionId + ' since=' + minTime + ' open=' + openRes.success + ' cursor=' + (openRes.cursor ?? -1) + ' err=' + (openRes.error || ''))
      if (openRes.success && openRes.cursor) {
        const cursor = openRes.cursor
        try {
          const allRows: any[] = []
          let hasMore = true
          while (hasMore && allRows.length < Math.min(Math.max(1, Math.floor(Number(limit) || 1000)), 5000)) {
            const fetchRes = await this.fetchMessageBatch(cursor)
            this.writeLog('[getNewMessages] fetch success=' + fetchRes.success + ' rows=' + (fetchRes.rows?.length ?? -1) + ' hasMore=' + fetchRes.hasMore + ' err=' + (fetchRes.error || ''), true)
            if (!fetchRes.success) break
            if (Array.isArray(fetchRes.rows)) allRows.push(...fetchRes.rows)
            hasMore = fetchRes.hasMore === true && (fetchRes.rows?.length || 0) > 0
          }
          if (allRows.length > 0) {
            return { success: true, messages: allRows.slice(0, Math.min(Math.max(1, Math.floor(Number(limit) || 1000)), 5000)) }
          }
        } finally {
          await this.closeMessageCursor(cursor)
        }
      }

      // 2) SQL fallback：微信 4.1.11+ 消息按 Msg_<md5(sessionId)> 分表，C++ 游标查不到
      const sqlMessages = await this.queryMessagesBySql(sessionId, minTime, limit)
      if (sqlMessages.length > 0) {
        this.writeLog('[getNewMessages] SQL fallback 命中 ' + sqlMessages.length + ' 条', true)
        return { success: true, messages: sqlMessages }
      }
      this.writeLog('[getNewMessages] SQL fallback 空（无新消息）', true)
      return { success: true, messages: [] }
    } catch (e) {
      this.writeLog('[getNewMessages] exception: ' + String(e), true)
      return { success: false, error: String(e) }
    }
  }

  /** SQL 直查 4.1.12 分表消息 */
  private async queryMessagesBySql(sessionId: string, minTime: number, limit: number): Promise<any[]> {
    const dbStorage = this.currentDbStoragePath
    if (!dbStorage) return []
    const tableHash = createHash('md5').update(String(sessionId || '')).digest('hex').toLowerCase()
    const dbPaths = this.findMessageDbPaths(dbStorage)
    if (dbPaths.length === 0) return []

    const results: any[] = []

    for (const dbPath of dbPaths) {
      // 表存在性检查（大小写不敏感）
      const existsRes = await this.execQuery(
        'message',
        dbPath,
        'SELECT name FROM sqlite_master WHERE type=\'table\' AND lower(name)=\'msg_' + tableHash + '\''
      )
      if (!existsRes.success || !Array.isArray(existsRes.rows) || existsRes.rows.length === 0) continue

      const tableName = 'Msg_' + tableHash
      const safeSince = Math.max(0, Math.floor(Number(minTime) || 0))
      const safeLimit = Math.min(Math.max(1, Math.floor(Number(limit) || 100)), 5000)
      const rowsRes = await this.execQuery(
        'message',
        dbPath,
        'SELECT * FROM "' + tableName + '" WHERE create_time > ' + safeSince + ' ORDER BY sort_seq ASC LIMIT ' + safeLimit
      )
      if (!rowsRes.success || !Array.isArray(rowsRes.rows)) continue

      const myRowId = await this.getMyRowId(dbPath)
      for (const row of rowsRes.rows) {
        results.push(await this.mapSqlMessage(row, dbPath, tableName, myRowId, sessionId))
      }
    }

    return results
  }

  /** 扫描 db_storage 下所有 message_*.db */
  private findMessageDbPaths(dbStoragePath: string): string[] {
    const results: string[] = []
    const scan = (dir: string, depth = 0): void => {
      if (depth > 4) return
      let entries: string[]
      try { entries = readdirSync(dir) } catch { return }
      for (const entry of entries) {
        const full = join(dir, entry)
        let st: ReturnType<typeof statSync>
        try { st = statSync(full) } catch { continue }
        if (st.isFile()) {
          const lower = entry.toLowerCase()
          if ((lower.startsWith('msg_') || lower.startsWith('message_')) && lower.endsWith('.db')) {
            if (!results.includes(full)) results.push(full)
          }
        } else if (st.isDirectory()) {
          scan(full, depth + 1)
        }
      }
    }
    scan(dbStoragePath)
    return results
  }

  /** Name2Id 的 rowid 只在当前分库内有效，必须按数据库路径分别缓存。 */
  private readonly myRowIdCache = new Map<string, number | null>()
  private async getMyRowId(dbPath: string): Promise<number | null> {
    const cacheKey = String(dbPath || '').trim().toLowerCase()
    if (!cacheKey) return null
    if (this.myRowIdCache.has(cacheKey)) return this.myRowIdCache.get(cacheKey) ?? null
    const candidates = [
      this.currentWxid || '',
      String(this.currentWxid || '').replace(/_\d+$/, '')
    ]
    for (const candidate of candidates) {
      if (!candidate) continue
      const res = await this.execQuery(
        'message',
        dbPath,
        'SELECT rowid FROM Name2Id WHERE user_name = \'' + candidate.replace(/'/g, "''") + '\' LIMIT 1'
      )
      if (res.success && Array.isArray(res.rows) && res.rows.length > 0) {
        const rowId = Number(res.rows[0]?.rowid ?? res.rows[0]?.RowId ?? 0)
        if (rowId > 0) {
          this.myRowIdCache.set(cacheKey, rowId)
          return rowId
        }
      }
    }
    this.myRowIdCache.set(cacheKey, null)
    return null
  }

  /** Name2Id 反查：rowid → user_name（群消息发送者） */
  private async resolveSenderUsername(dbPath: string, realSenderId: number): Promise<string> {
    const res = await this.execQuery(
      'message',
      dbPath,
      'SELECT user_name FROM Name2Id WHERE rowid = ' + Math.floor(Number(realSenderId) || 0) + ' LIMIT 1'
    )
    if (res.success && Array.isArray(res.rows) && res.rows.length > 0) {
      return String(res.rows[0]?.user_name || '')
    }
    return ''
  }

  /** SQL 行 → Message 结构 */
  private async mapSqlMessage(row: Record<string, any>, dbPath: string, tableName: string, myRowId: number | null, sessionId: string): Promise<any> {
    const localType = Number(row.local_type ?? row.localType ?? 0)
    const rawContent = String(row.message_content ?? row.msg_content ?? '')
    const isGroup = String(sessionId || '').endsWith('@chatroom')
    const realSenderId = Number(row.real_sender_id ?? 0)
    const isSend = resolveSqlMessageSendState(myRowId, realSenderId)

    let senderUsername = ''
    if (isGroup && realSenderId > 0) {
      senderUsername = await this.resolveSenderUsername(dbPath, realSenderId)
    }

    const contentFields = mapSqlMessageContent(localType, rawContent)
    const result: Record<string, unknown> = {
      messageKey: dbPath + ':' + tableName + ':' + String(row.local_id ?? ''),
      localId: Number(row.local_id ?? 0),
      createTime: Number(row.create_time ?? 0),
      sortSeq: Number(row.sort_seq ?? 0),
      localType,
      isSend,
      senderUsername: senderUsername || (isGroup ? '' : sessionId),
      ...contentFields
    }
    if (row.server_id !== null && row.server_id !== undefined && row.server_id !== '') {
      result.serverId = String(row.server_id)
      result.serverIdRaw = String(row.server_id)
    }
    return result
  }

  async openMessageCursor(sessionId: string, batchSize: number, ascending: boolean, beginTimestamp: number, endTimestamp: number): Promise<{ success: boolean; cursor?: number; error?: string }> {
    if (!this.ensureReady()) return { success: false, error: 'WCDB 未连接' }
    try {
      const outCursor = [0]
      const fn = this.wcdbOpenMessageCursorLite || this.wcdbOpenMessageCursor
      const result = fn(
        this.handle, sessionId, batchSize, ascending ? 1 : 0,
        Math.floor(beginTimestamp), Math.floor(endTimestamp), outCursor
      )
      if (result !== 0 || outCursor[0] <= 0) {
        return { success: false, error: 'openMessageCursor failed: ' + result }
      }
      return { success: true, cursor: outCursor[0] }
    } catch (e) {
      return { success: false, error: String(e) }
    }
  }

  async fetchMessageBatch(cursor: number): Promise<{ success: boolean; rows?: any[]; hasMore?: boolean; error?: string }> {
    if (!this.ensureReady()) return { success: false, error: 'WCDB 未连接' }
    try {
      const outPtr = [null as any]
      const outHasMore = [0]
      const result = this.wcdbFetchMessageBatch(this.handle, cursor, outPtr, outHasMore)
      if (result !== 0 || !outPtr[0]) return { success: false, error: 'fetchMessageBatch failed: ' + result }
      const jsonStr = this.decodeJsonPtr(outPtr[0])
      if (!jsonStr) return { success: false, error: '解析批次失败' }
      return { success: true, rows: this.parseMessageJson(jsonStr), hasMore: Number(outHasMore[0]) > 0 }
    } catch (e) {
      return { success: false, error: String(e) }
    }
  }

  async closeMessageCursor(cursor: number): Promise<{ success: boolean; error?: string }> {
    try {
      const result = this.wcdbCloseMessageCursor(this.handle, cursor)
      return { success: result === 0, error: result !== 0 ? 'closeMessageCursor failed: ' + result : undefined }
    } catch (e) {
      return { success: false, error: String(e) }
    }
  }

  async getDisplayNames(usernames: string[]): Promise<{ success: boolean; map?: Record<string, string>; error?: string }> {
    if (!this.ensureReady()) return { success: false, error: 'WCDB 未连接' }
    const uniq = Array.from(new Set((usernames || []).map(x => String(x || '').trim()).filter(Boolean)))
    if (uniq.length === 0) return { success: true, map: {} }
    try {
      await new Promise(resolve => setImmediate(resolve))
      const outPtr = [null as any]
      const result = this.wcdbGetDisplayNames(this.handle, JSON.stringify(uniq), outPtr)
      await new Promise(resolve => setImmediate(resolve))
      if (result !== 0 || !outPtr[0]) return { success: false, error: '获取昵称失败: ' + result }
      const jsonStr = this.decodeJsonPtr(outPtr[0])
      if (!jsonStr) return { success: false, error: '解析昵称失败' }
      return { success: true, map: JSON.parse(jsonStr) }
    } catch (e) {
      return { success: false, error: String(e) }
    }
  }

  async getAvatarUrls(usernames: string[]): Promise<{ success: boolean; map?: Record<string, string>; error?: string }> {
    if (!this.ensureReady()) return { success: false, error: 'WCDB 未连接' }
    const uniq = Array.from(new Set((usernames || []).map(x => String(x || '').trim()).filter(Boolean)))
    if (uniq.length === 0) return { success: true, map: {} }
    try {
      const now = Date.now()
      const resultMap: Record<string, string> = {}
      const toFetch: string[] = []
      for (const username of uniq) {
        const cached = this.avatarUrlCache.get(username)
        if (cached && cached.url && cached.url.trim() && now - cached.updatedAt < this.avatarCacheTtlMs) {
          resultMap[username] = cached.url
        } else {
          toFetch.push(username)
        }
      }
      if (toFetch.length === 0) return { success: true, map: resultMap }

      const outPtr = [null as any]
      const result = this.wcdbGetAvatarUrls(this.handle, JSON.stringify(toFetch), outPtr)
      await new Promise(resolve => setImmediate(resolve))
      if (result !== 0 || !outPtr[0]) {
        if (Object.keys(resultMap).length > 0) return { success: true, map: resultMap, error: '获取头像失败: ' + result }
        return { success: false, error: '获取头像失败: ' + result }
      }
      const jsonStr = this.decodeJsonPtr(outPtr[0])
      if (!jsonStr) return { success: false, error: '解析头像失败' }
      const map = JSON.parse(jsonStr) as Record<string, string>
      for (const username of toFetch) {
        const url = map[username]
        if (url && url.trim()) {
          resultMap[username] = url
          this.avatarUrlCache.set(username, { url, updatedAt: now })
        }
      }
      return { success: true, map: resultMap }
    } catch (e) {
      return { success: false, error: String(e) }
    }
  }

  async getContact(username: string): Promise<{ success: boolean; contact?: any; error?: string }> {
    if (!this.ensureReady()) return { success: false, error: 'WCDB 未连接' }
    try {
      const outPtr = [null as any]
      const result = this.wcdbGetContact(this.handle, username, outPtr)
      if (result !== 0 || !outPtr[0]) return { success: false, error: '获取联系人失败: ' + result }
      const jsonStr = this.decodeJsonPtr(outPtr[0])
      if (!jsonStr) return { success: false, error: '解析联系人失败' }
      return { success: true, contact: JSON.parse(jsonStr) }
    } catch (e) {
      return { success: false, error: String(e) }
    }
  }

  async getGroupNicknames(chatroomId: string): Promise<{ success: boolean; map?: Record<string, string>; error?: string }> {
    if (!this.ensureReady() || !this.wcdbGetGroupNicknames) return { success: false, error: '接口未就绪' }
    try {
      const outPtr = [null as any]
      const result = this.wcdbGetGroupNicknames(this.handle, chatroomId, outPtr)
      if (result !== 0 || !outPtr[0]) return { success: false, error: '获取群昵称失败: ' + result }
      const jsonStr = this.decodeJsonPtr(outPtr[0])
      if (!jsonStr) return { success: false, error: '解析群昵称失败' }
      return { success: true, map: JSON.parse(jsonStr) }
    } catch (e) {
      return { success: false, error: String(e) }
    }
  }

  async execQuery(kind: string, dbPath: string | null, sql: string): Promise<{ success: boolean; rows?: any[]; error?: string }> {
    if (!this.ensureReady() || !this.wcdbExecQuery) return { success: false, error: '接口未就绪' }
    try {
      const outPtr = [null as any]
      const result = this.wcdbExecQuery(this.handle, kind, dbPath || null, sql, outPtr)
      if (result !== 0 || !outPtr[0]) return { success: false, error: '查询失败: ' + result }
      const jsonStr = this.decodeJsonPtr(outPtr[0])
      if (!jsonStr) return { success: false, error: '解析查询结果失败' }
      return { success: true, rows: JSON.parse(jsonStr) }
    } catch (e) {
      return { success: false, error: String(e) }
    }
  }

  // --- 路径解析 ---

  private cleanAccountDirName(value: string): string {
    const trimmed = String(value || '').trim()
    if (!trimmed) return ''
    const wxidMatch = trimmed.match(/^(wxid_[^_]+)/i)
    if (wxidMatch) return wxidMatch[1]
    const suffixMatch = trimmed.match(/^(.+)_([a-zA-Z0-9]{4})$/)
    return suffixMatch ? suffixMatch[1] : trimmed
  }

  private resolveDbStoragePath(basePath: string, wxid: string): string | null {
    if (!basePath) return null
    const normalized = expandHomePath(basePath).replace(/[\\/]+$/, '')
    if (normalized.toLowerCase().endsWith('db_storage') && existsSync(normalized)) return normalized
    const direct = join(normalized, 'db_storage')
    if (existsSync(direct)) return direct
    if (wxid) {
      const viaWxid = join(normalized, wxid, 'db_storage')
      if (existsSync(viaWxid)) return viaWxid
      try {
        const entries = readdirSync(normalized)
        const lowerWxid = wxid.toLowerCase()
        const candidates = entries.filter(entry => {
          try {
            const entryPath = join(normalized, entry)
            if (!statSync(entryPath).isDirectory()) return false
          } catch { return false }
          const lowerEntry = entry.toLowerCase()
          return lowerEntry === lowerWxid || lowerEntry.startsWith(lowerWxid + '_')
        })
        for (const entry of candidates) {
          const candidate = join(normalized, entry, 'db_storage')
          if (existsSync(candidate)) return candidate
        }
      } catch { }
    }
    try {
      let parent = normalized
      for (let i = 0; i < 2; i++) {
        const up = join(parent, '..')
        if (up === parent) break
        parent = up
        const candidateUp = join(parent, 'db_storage')
        if (existsSync(candidateUp)) return candidateUp
        if (wxid) {
          const viaWxidUp = join(parent, wxid, 'db_storage')
          if (existsSync(viaWxidUp)) return viaWxidUp
        }
      }
    } catch { }
    return null
  }

  private findSessionDb(dir: string, depth = 0): string | null {
    if (depth > 5) return null
    try {
      const entries = readdirSync(dir)
      for (const entry of entries) {
        if (entry.toLowerCase() === 'session.db') {
          const fullPath = join(dir, entry)
          if (statSync(fullPath).isFile()) return fullPath
        }
      }
      for (const entry of entries) {
        const fullPath = join(dir, entry)
        try {
          if (statSync(fullPath).isDirectory()) {
            const found = this.findSessionDb(fullPath, depth + 1)
            if (found) return found
          }
        } catch { }
      }
    } catch { }
    return null
  }
}

function candidatesFallback(roots: string[], relativeCandidates: string[], libName: string): string {
  for (const root of roots) {
    for (const relativePath of relativeCandidates) {
      return join(root, relativePath)
    }
  }
  return libName
}

export const wcdbCore = new WcdbCore()
