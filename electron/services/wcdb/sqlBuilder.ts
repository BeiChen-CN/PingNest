import { createHash } from 'crypto'

/**
 * WCDB SQL 构造与只读校验：消息分表查询所需的语句统一在这里拼装，
 * 并提供 dbWorker 对外出口使用的只读白名单校验（单一实现）。
 */

/** 微信 4.1.11+ 消息按 Msg_<md5(sessionId)> 分表 */
export function messageTableName(sessionId: string): string {
  const tableHash = createHash('md5').update(String(sessionId || '')).digest('hex').toLowerCase()
  return 'Msg_' + tableHash
}

export function buildMessageTableExistsSql(sessionId: string): string {
  return 'SELECT name FROM sqlite_master WHERE type=\'table\' AND lower(name)=\'' + messageTableName(sessionId).toLowerCase() + '\''
}

export function buildMessagesByTableSql(sessionId: string, minTime: number, limit: number): string {
  const safeSince = Math.max(0, Math.floor(Number(minTime) || 0))
  const safeLimit = Math.min(Math.max(1, Math.floor(Number(limit) || 100)), 5000)
  return 'SELECT * FROM "' + messageTableName(sessionId) + '" WHERE create_time > ' + safeSince + ' ORDER BY sort_seq ASC LIMIT ' + safeLimit
}

export function buildName2IdRowIdSql(username: string): string {
  return 'SELECT rowid FROM Name2Id WHERE user_name = \'' + String(username).replace(/'/g, "''") + '\' LIMIT 1'
}

export function buildName2IdUsernameSql(realSenderId: number): string {
  return 'SELECT user_name FROM Name2Id WHERE rowid = ' + Math.floor(Number(realSenderId) || 0) + ' LIMIT 1'
}

/**
 * SQL 只读白名单校验：仅允许 SELECT 与只读 PRAGMA，禁止任何写操作/多语句。
 * 防止内部 execQuery 出口被滥用（目前仅主进程内部使用，加双重保险）。
 */
export function validateReadOnlySql(sql: string): string | null {
  const raw = String(sql || '')
  if (!raw.trim()) return 'SQL 为空'
  // 写关键字（含字符串字面量外的部分）
  const outsideStrings = raw.replace(/'[^']*'/g, "''").replace(/"([^"]*)"/g, '""')
  if (/\b(insert|update|delete|drop|alter|create|replace|attach|detach|vacuum|reindex)\b/i.test(outsideStrings)) {
    return '仅允许只读 SELECT 查询'
  }
  const trimmed = raw.trim().toLowerCase()
  if (!trimmed.startsWith('select ') && !trimmed.startsWith('pragma ')) {
    return '仅允许 SELECT 或只读 PRAGMA'
  }
  if (/pragma\s+(journal_mode|wal_checkpoint|synchronous|locking_mode|page_size|encryption|temp_store|foreign_keys|user_version)/i.test(raw)) {
    return '该 PRAGMA 会修改数据库状态，已禁止'
  }
  return null
}
