import { join } from 'path'
import { appendFileSync, existsSync, mkdirSync } from 'fs'
import { tmpdir } from 'os'
import { resolveSqlMessageSendState } from './messageDirection'
import { mapSqlMessageContent } from './sqlMessageContent'
import { cleanAccountDirName, expandHomePath } from './dbPathService'
import { WcdbFfiBindings } from './wcdb/ffiBindings'
import { findMessageDbPaths, findSessionDb, resolveDbStoragePath } from './wcdb/paths'
import { normalizeMessages, normalizeSessions, parseMessageJson } from './wcdb/normalizer'
import { buildMessageTableExistsSql, buildMessagesByTableSql, buildName2IdRowIdSql, buildName2IdUsernameSql, messageTableName } from './wcdb/sqlBuilder'

// 数据服务初始化错误信息
let lastDllInitError: string | null = null

export function getLastDllInitError(): string | null {
  return lastDllInitError
}

/**
 * WcdbCore（移植自 WeFlow，裁剪）— 门面。
 * 通过 koffi 加载 wcdb_api.dll，提供微信 4.0 数据库的解密查询与变更监控。
 * 职责已拆分：FFI 绑定见 wcdb/ffiBindings，路径探测见 wcdb/paths，
 * 字段归一见 wcdb/normalizer，SQL 构造见 wcdb/sqlBuilder；本类只保留
 * 连接句柄状态、监控管道与对外 API。
 */
export class WcdbCore {
  private resourcesPath: string | null = null
  private userDataPath: string | null = null
  private logEnabled = false
  private readonly ffi = new WcdbFfiBindings()
  private initialized = false
  private handle: number | null = null
  private currentPath: string | null = null
  private currentKey: string | null = null
  private currentWxid: string | null = null
  private currentDbStoragePath: string | null = null

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
        const dir = join(filePath, '..')
        if (!existsSync(dir)) mkdirSync(dir, { recursive: true })
        appendFileSync(filePath, line + '\n', { encoding: 'utf8' })
        return
      } catch { }
    }
  }

  /** 命名管道监控：微信数据库变化时回调 (type, json) */
  startMonitor(callback: (type: string, json: string) => void): boolean {
    if (!this.ffi.startMonitorPipeFn) {
      // EchoTrace/legacy builds do not expose the optional named-pipe API.
      // The message service will use its regular polling loop instead.
      this.monitorCallback = callback
      this.writeLog('[monitor] native pipe unavailable; polling fallback enabled', true)
      return true
    }
    this.monitorCallback = callback
    try {
      const result = this.ffi.startMonitorPipeFn()
      this.writeLog('[monitor] wcdbStartMonitorPipe rc=' + result, true)
      if (result !== 0) return false

      let pipePath = '\\\\.\\pipe\\weflow_monitor'
      if (this.ffi.getMonitorPipeNameFn) {
        try {
          const namePtr = [null as any]
          if (this.ffi.getMonitorPipeNameFn(namePtr) === 0 && namePtr[0]) {
            pipePath = this.ffi.decodeCString(namePtr[0])
            this.ffi.freeString(namePtr[0])
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
    if (this.ffi.stopMonitorPipeFn) {
      try { this.ffi.stopMonitorPipeFn() } catch { }
    }
  }

  private async initialize(): Promise<boolean> {
    if (this.initialized) return true

    const result = await this.ffi.initialize(this.resourcesPath, (message, force) => this.writeLog(message, force))
    lastDllInitError = result.ok ? null : (result.error || lastDllInitError)
    if (result.ok) this.initialized = true
    return result.ok
  }

  /** 打开数据库 */
  async open(dbPath: string, hexKey: string, wxid: string): Promise<boolean> {
    try {
      const accountWxid = cleanAccountDirName(wxid)
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

      const dbStoragePath = resolveDbStoragePath(dbPath, accountWxid)
      this.writeLog('[open] dbStoragePath=' + (dbStoragePath || 'null'), true)
      if (!dbStoragePath || !existsSync(dbStoragePath)) {
        lastDllInitError = this.ffi.formatInitProtectionError(-3001)
        return false
      }

      const sessionDbPath = findSessionDb(dbStoragePath)
      this.writeLog('[open] sessionDbPath=' + (sessionDbPath || 'null'), true)
      if (!sessionDbPath) {
        lastDllInitError = this.ffi.formatInitProtectionError(-3002)
        return false
      }

      this.writeLog('[open] key length=' + String(hexKey || '').length + ' dbPath=' + dbPath + ' wxid=' + wxid, true)
      const handleOut = [0]
      const result = this.ffi.openAccount(sessionDbPath, hexKey, handleOut)
      this.writeLog('[open] openAccount rc=' + result + ' handle=' + handleOut[0], true)
      if (result !== 0) {
        lastDllInitError = this.ffi.formatInitProtectionError(result)
        return false
      }

      const handle = handleOut[0]
      if (handle <= 0) {
        lastDllInitError = this.ffi.formatInitProtectionError(-3003)
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

      if (this.ffi.setMyWxidFn && accountWxid) {
        try { this.ffi.setMyWxidFn(this.handle, accountWxid) } catch { }
      }
      this.writeLog('open ok handle=' + handle, true)
      return true
    } catch (e) {
      console.error('[wcdbCore] 打开数据库异常:', e)
      lastDllInitError = this.ffi.formatInitProtectionError(-3004)
      return false
    }
  }

  close(): void {
    if (this.handle !== null || this.initialized) {
      try { this.stopMonitor() } catch { }
      this.ffi.shutdown()
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

  async getSessions(): Promise<{ success: boolean; sessions?: any[]; error?: string }> {
    if (!this.ensureReady()) return { success: false, error: 'WCDB 未连接' }
    try {
      await new Promise(resolve => setImmediate(resolve))
      const outPtr = [null as any]
      const result = this.ffi.getSessionsFn(this.handle, outPtr)
      await new Promise(resolve => setImmediate(resolve))
      if (result !== 0 || !outPtr[0]) return { success: false, error: '获取会话失败: ' + result }
      const jsonStr = this.ffi.decodeJsonPtr(outPtr[0])
      if (!jsonStr) return { success: false, error: '解析会话失败' }
      return { success: true, sessions: normalizeSessions(JSON.parse(jsonStr)) }
    } catch (e) {
      return { success: false, error: String(e) }
    }
  }

  async getMessages(sessionId: string, limit: number, offset: number): Promise<{ success: boolean; messages?: any[]; error?: string }> {
    if (!this.ensureReady()) return { success: false, error: 'WCDB 未连接' }
    try {
      const outPtr = [null as any]
      const result = this.ffi.getMessagesFn(this.handle, sessionId, limit, offset, outPtr)
      if (result !== 0 || !outPtr[0]) return { success: false, error: '获取消息失败: ' + result }
      const jsonStr = this.ffi.decodeJsonPtr(outPtr[0])
      if (!jsonStr) return { success: false, error: '解析消息失败' }
      return { success: true, messages: normalizeMessages(parseMessageJson(jsonStr), sessionId) }
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

      // Legacy builds do not expose cursors or SQL execution. Use the basic
      // message endpoint as a bounded fallback before trying project SQL.
      if (!this.ffi.hasMessageCursor && this.ffi.getMessagesFn) {
        const basic = await this.getMessages(sessionId, Math.min(Math.max(1, Math.floor(Number(limit) || 1000)), 5000), 0)
        if (basic.success && Array.isArray(basic.messages)) {
          const since = Math.max(0, Math.floor(Number(minTime) || 0))
          const messages = basic.messages
            .filter((message: any) => Number(message?.createTime ?? message?.create_time ?? 0) >= since)
            .sort((a: any, b: any) => Number(a?.createTime ?? a?.create_time ?? 0) - Number(b?.createTime ?? b?.create_time ?? 0))
            .slice(0, Math.min(Math.max(1, Math.floor(Number(limit) || 1000)), 5000))
          this.writeLog('[getNewMessages] legacy endpoint normalized ' + messages.length + ' 条', true)
          return { success: true, messages }
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
    const dbPaths = findMessageDbPaths(dbStorage)
    if (dbPaths.length === 0) return []

    const results: any[] = []

    for (const dbPath of dbPaths) {
      // 表存在性检查（大小写不敏感）
      const existsRes = await this.execQuery('message', dbPath, buildMessageTableExistsSql(sessionId))
      if (!existsRes.success || !Array.isArray(existsRes.rows) || existsRes.rows.length === 0) continue

      const rowsRes = await this.execQuery('message', dbPath, buildMessagesByTableSql(sessionId, minTime, limit))
      if (!rowsRes.success || !Array.isArray(rowsRes.rows)) continue

      const myRowId = await this.getMyRowId(dbPath)
      const tableName = messageTableName(sessionId)
      for (const row of rowsRes.rows) {
        results.push(await this.mapSqlMessage(row, dbPath, tableName, myRowId, sessionId))
      }
    }

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
      const res = await this.execQuery('message', dbPath, buildName2IdRowIdSql(candidate))
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
    const res = await this.execQuery('message', dbPath, buildName2IdUsernameSql(realSenderId))
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
      const fn = this.ffi.openMessageCursorFn
      if (!fn) return { success: false, error: '当前 WCDB 构建不提供消息游标接口' }
      const outCursor = [0]
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
      if (!this.ffi.fetchMessageBatchFn) return { success: false, error: '当前 WCDB 构建不提供消息批量接口' }
      const outPtr = [null as any]
      const outHasMore = [0]
      const result = this.ffi.fetchMessageBatchFn(this.handle, cursor, outPtr, outHasMore)
      if (result !== 0 || !outPtr[0]) return { success: false, error: 'fetchMessageBatch failed: ' + result }
      const jsonStr = this.ffi.decodeJsonPtr(outPtr[0])
      if (!jsonStr) return { success: false, error: '解析批次失败' }
      return { success: true, rows: parseMessageJson(jsonStr), hasMore: Number(outHasMore[0]) > 0 }
    } catch (e) {
      return { success: false, error: String(e) }
    }
  }

  async closeMessageCursor(cursor: number): Promise<{ success: boolean; error?: string }> {
    if (!this.ffi.closeMessageCursorFn) return { success: false, error: '当前 WCDB 构建不提供消息游标接口' }
    try {
      const result = this.ffi.closeMessageCursorFn(this.handle, cursor)
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
      const result = this.ffi.getDisplayNamesFn(this.handle, JSON.stringify(uniq), outPtr)
      await new Promise(resolve => setImmediate(resolve))
      if (result !== 0 || !outPtr[0]) return { success: false, error: '获取昵称失败: ' + result }
      const jsonStr = this.ffi.decodeJsonPtr(outPtr[0])
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
      const result = this.ffi.getAvatarUrlsFn(this.handle, JSON.stringify(toFetch), outPtr)
      await new Promise(resolve => setImmediate(resolve))
      if (result !== 0 || !outPtr[0]) {
        if (Object.keys(resultMap).length > 0) return { success: true, map: resultMap, error: '获取头像失败: ' + result }
        return { success: false, error: '获取头像失败: ' + result }
      }
      const jsonStr = this.ffi.decodeJsonPtr(outPtr[0])
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
    if (!this.ffi.getContactFn) return { success: false, error: '当前 WCDB 构建不提供联系人接口' }
    try {
      const outPtr = [null as any]
      const result = this.ffi.getContactFn(this.handle, username, outPtr)
      if (result !== 0 || !outPtr[0]) return { success: false, error: '获取联系人失败: ' + result }
      const jsonStr = this.ffi.decodeJsonPtr(outPtr[0])
      if (!jsonStr) return { success: false, error: '解析联系人失败' }
      return { success: true, contact: JSON.parse(jsonStr) }
    } catch (e) {
      return { success: false, error: String(e) }
    }
  }

  async getGroupNicknames(chatroomId: string): Promise<{ success: boolean; map?: Record<string, string>; error?: string }> {
    if (!this.ensureReady() || !this.ffi.getGroupNicknamesFn) return { success: false, error: '接口未就绪' }
    try {
      const outPtr = [null as any]
      const result = this.ffi.getGroupNicknamesFn(this.handle, chatroomId, outPtr)
      if (result !== 0 || !outPtr[0]) return { success: false, error: '获取群昵称失败: ' + result }
      const jsonStr = this.ffi.decodeJsonPtr(outPtr[0])
      if (!jsonStr) return { success: false, error: '解析群昵称失败' }
      return { success: true, map: JSON.parse(jsonStr) }
    } catch (e) {
      return { success: false, error: String(e) }
    }
  }

  async execQuery(kind: string, dbPath: string | null, sql: string): Promise<{ success: boolean; rows?: any[]; error?: string }> {
    if (!this.ensureReady() || !this.ffi.execQueryFn) return { success: false, error: '接口未就绪' }
    try {
      const outPtr = [null as any]
      const result = this.ffi.execQueryFn(this.handle, kind, dbPath || null, sql, outPtr)
      if (result !== 0 || !outPtr[0]) return { success: false, error: '查询失败: ' + result }
      const jsonStr = this.ffi.decodeJsonPtr(outPtr[0])
      if (!jsonStr) return { success: false, error: '解析查询结果失败' }
      return { success: true, rows: JSON.parse(jsonStr) }
    } catch (e) {
      return { success: false, error: String(e) }
    }
  }
}

export const wcdbCore = new WcdbCore()
