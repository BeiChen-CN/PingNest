import { existsSync, mkdirSync, readFileSync, renameSync } from 'fs'
import { dirname } from 'path'
import { DatabaseSync, type StatementSync } from 'node:sqlite'

/**
 * NotifyCenterStore 纯核心：SQLite 持久化（node:sqlite，Electron 41 内置 Node 24 提供）。
 *
 * 设计：
 * - 内存镜像 + 写穿（write-through）：现有同步消费者与增量广播协议不变；
 * - 行级加密：payload/effect 经注入的 encryptText 存储（enc:/plain: 前缀约定与旧 JSON 存储一致），
 *   加密不可用时按行回退明文；
 * - 旧 notify-center.json 迁移：解析（enc:/plain:/裸 JSON）后事务写入并改名保留，
 *   损坏走 .corrupt- 备份；跨环境无法解密的旧数据不再阻塞新写入（改进：旧行为会永久搁浅）。
 * - 零 electron 导入：app/safeStorage 由 notifyCenterStore.ts（薄壳）注入，node:test 直接可测。
 */

export interface NotifyCenterEntry {
  id: string
  payload: Record<string, unknown>
  effect: Record<string, unknown>
  receivedAt: number
  read: boolean
}

/** 持久化状态快照：供状态接口向 UI 报告降级/明文/损坏备份（app:getStatus.history） */
export interface PersistenceStatus {
  /** 存在部分历史不可读或迁移异常（新记录始终正常保存） */
  degraded: boolean
  /** 降级原因（degraded 为 true 时有值） */
  reason: string | null
  /** 本次会话中发生损坏备份的时间戳（null = 未发生） */
  corruptBackupAt: number | null
  /** 当前写入是否为加密格式（false = 明文落盘） */
  writeEncrypted: boolean
}

export interface NotifyCenterStoreDeps {
  /** SQLite 数据库文件路径 */
  databasePath: string
  /** 旧版 JSON 历史文件路径（null 跳过迁移） */
  legacyFilePath: string | null
  isEncryptionAvailable: () => boolean
  /** 明文 → 存储格式（enc:… / plain:…） */
  encryptText: (plain: string) => string
  /** 存储格式 → 明文；不可解密时返回空串 */
  decryptText: (stored: string) => string
}

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS entries (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL DEFAULT '',
  payload TEXT NOT NULL,
  effect TEXT NOT NULL DEFAULT '{}',
  received_at INTEGER NOT NULL,
  read INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_entries_received ON entries(received_at DESC);
CREATE INDEX IF NOT EXISTS idx_entries_session ON entries(session_id);
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
`

export class NotifyCenterStore {
  private readonly deps: NotifyCenterStoreDeps
  private db: DatabaseSync | null = null
  private entries: NotifyCenterEntry[] = []
  private degraded = false
  private degradeReason: string | null = null
  private corruptBackupAt: number | null = null
  private stmtInsert: StatementSync | null = null
  private stmtUpdatePayload: StatementSync | null = null

  // 显式赋值而非参数属性：node:test 直接加载本文件时类型擦除不支持 parameter property
  constructor(deps: NotifyCenterStoreDeps) {
    this.deps = deps
  }

  /** 应用启动时调用：打开库、迁移旧 JSON、加载内存镜像 */
  async init(): Promise<void> {
    mkdirSync(dirname(this.deps.databasePath), { recursive: true })
    const db = new DatabaseSync(this.deps.databasePath)
    this.db = db
    db.exec('PRAGMA journal_mode = WAL')
    db.exec('PRAGMA synchronous = NORMAL')
    db.exec(SCHEMA_SQL)
    this.stmtInsert = db.prepare('INSERT OR IGNORE INTO entries (id, session_id, payload, effect, received_at, read) VALUES (?, ?, ?, ?, ?, ?)')
    this.stmtUpdatePayload = db.prepare('UPDATE entries SET payload = ?, effect = ? WHERE id = ?')
    this.migrateLegacyJson()
    this.loadFromDb()
  }

  /** 供状态接口上报持久化健康度 */
  getPersistenceStatus(): PersistenceStatus {
    return {
      degraded: this.degraded,
      reason: this.degradeReason,
      corruptBackupAt: this.corruptBackupAt,
      writeEncrypted: this.deps.isEncryptionAvailable()
    }
  }

  getEntries(): NotifyCenterEntry[] {
    return this.entries
  }

  // 变更类方法返回实际发生变化的条目/ID，供调用方构造增量广播（见 notifyBroadcast.ts）；
  // 无变化时返回 null/空数组，调用方据此跳过广播。
  add(entry: NotifyCenterEntry): NotifyCenterEntry {
    this.entries.unshift(entry)
    this.insertRow(entry)
    return entry
  }

  markRead(id: string): NotifyCenterEntry | null {
    const entry = this.entries.find((e) => e.id === id)
    if (entry && !entry.read) {
      entry.read = true
      this.db?.prepare('UPDATE entries SET read = 1 WHERE id = ?').run(id)
      return entry
    }
    return null
  }

  markSessionRead(sessionId: string): NotifyCenterEntry[] {
    const updated: NotifyCenterEntry[] = []
    for (const entry of this.entries) {
      if (String(entry.payload?.sessionId || '') === sessionId && !entry.read) {
        entry.read = true
        updated.push(entry)
      }
    }
    if (updated.length > 0) {
      this.db?.prepare('UPDATE entries SET read = 1 WHERE session_id = ? AND read = 0').run(String(sessionId || ''))
    }
    return updated
  }

  updateGroupName(sessionId: string, groupName: string): NotifyCenterEntry[] {
    const normalizedSessionId = String(sessionId || '').trim()
    const normalizedName = String(groupName || '').trim()
    if (!normalizedSessionId || !normalizedName) return []
    const updated: NotifyCenterEntry[] = []
    for (const entry of this.entries) {
      if (String(entry.payload?.sessionId || '') !== normalizedSessionId) continue
      if (entry.payload.groupName === normalizedName) continue
      entry.payload.groupName = normalizedName
      updated.push(entry)
    }
    if (updated.length > 0 && this.db) {
      const updateAll = this.db.prepare('UPDATE entries SET payload = ?, effect = ? WHERE id = ?')
      for (const entry of updated) {
        updateAll.run(this.deps.encryptText(JSON.stringify(entry.payload)), this.deps.encryptText(JSON.stringify(entry.effect ?? {})), entry.id)
      }
    }
    return updated
  }

  remove(id: string): string | null {
    const next = this.entries.filter((entry) => entry.id !== id)
    if (next.length !== this.entries.length) {
      this.entries = next
      this.db?.prepare('DELETE FROM entries WHERE id = ?').run(id)
      return id
    }
    return null
  }

  clear(): void {
    this.entries = []
    this.db?.exec('DELETE FROM entries')
  }

  cleanupOlderThan(days: number): NotifyCenterEntry[] {
    const retentionDays = Math.max(1, Math.floor(days))
    const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000
    const removed = this.entries.filter((entry) => Number(entry.receivedAt) < cutoff)
    if (removed.length > 0) {
      const removedIds = new Set(removed.map((entry) => entry.id))
      this.entries = this.entries.filter((entry) => !removedIds.has(entry.id))
      this.db?.prepare('DELETE FROM entries WHERE received_at < ?').run(cutoff)
    }
    return removed
  }

  /** 写穿模式下无积压缓冲；保留异步签名以兼容退出流程调用 */
  async flush(): Promise<void> { }

  /** 测试与优雅退出可调用：关闭数据库句柄 */
  close(): void {
    try { this.db?.close() } catch { /* 尽力关闭：可能已关闭 */ }
    this.db = null
  }

  // ---------- 内部实现 ----------

  private insertRow(entry: NotifyCenterEntry): void {
    this.stmtInsert?.run(
      entry.id,
      String(entry.payload?.sessionId || ''),
      this.deps.encryptText(JSON.stringify(entry.payload ?? {})),
      this.deps.encryptText(JSON.stringify(entry.effect ?? {})),
      Number(entry.receivedAt) || 0,
      entry.read ? 1 : 0
    )
  }

  private loadFromDb(): void {
    if (!this.db) return
    const rows = this.db.prepare('SELECT id, payload, effect, received_at, read FROM entries ORDER BY received_at DESC, rowid DESC').all() as Array<{
      id: string; payload: string; effect: string; received_at: number; read: number
    }>
    const loaded: NotifyCenterEntry[] = []
    let unreadable = 0
    for (const row of rows) {
      const payloadText = this.deps.decryptText(String(row.payload || ''))
      if (!payloadText) {
        unreadable += 1
        continue
      }
      try {
        const effectText = this.deps.decryptText(String(row.effect || '{}'))
        loaded.push({
          id: row.id,
          payload: JSON.parse(payloadText),
          effect: effectText ? JSON.parse(effectText) : {},
          receivedAt: Number(row.received_at) || 0,
          read: Number(row.read) === 1
        })
      } catch {
        unreadable += 1
      }
    }
    this.entries = loaded
    if (unreadable > 0) {
      this.degraded = true
      this.degradeReason = '有 ' + unreadable + ' 条历史记录在当前环境无法解密，已跳过展示（记录仍保留在数据库中）'
    }
  }

  /**
   * 旧版 notify-center.json → SQLite 一次性迁移。
   * 标记仅在真正完成后写入：无旧文件不设标记（兼容"降级到旧版再升级"的场景），
   * 旧加密数据在当前环境不可解密时也不设标记（未来环境可解密时自动重试迁移）；
   * 插入使用 INSERT OR IGNORE，标记已存在但文件未改名成功时重跑是幂等的。
   */
  private migrateLegacyJson(): void {
    if (!this.db) return
    const legacyPath = this.deps.legacyFilePath
    if (!legacyPath || !existsSync(legacyPath)) return

    let plain: string | null = null
    try {
      const raw = readFileSync(legacyPath, 'utf8')
      if (raw.startsWith('enc:')) {
        if (!this.deps.isEncryptionAvailable()) {
          this.degraded = true
          this.degradeReason = '旧版加密历史无法在当前环境解密，原文件已保留；新记录将正常保存，恢复原环境后可自动迁移'
          return
        }
        plain = this.deps.decryptText(raw)
      } else if (raw.startsWith('plain:')) {
        plain = raw.slice(6)
      } else {
        plain = raw // 旧版裸 JSON
      }
    } catch {
      plain = null
    }

    let parsed: unknown = null
    if (plain !== null) {
      try { parsed = JSON.parse(plain) } catch { parsed = null }
    }
    if (!Array.isArray(parsed)) {
      // 文件损坏：备份原文件后从空库开始（不再有整文件覆盖风险）
      try {
        renameSync(legacyPath, legacyPath + '.corrupt-' + Date.now())
        this.corruptBackupAt = Date.now()
      } catch {
        this.degraded = true
        this.degradeReason = '旧历史文件损坏且自动备份失败，已从新数据库开始记录'
      }
      return
    }

    const legacyEntries = (parsed as unknown[]).filter((item): item is NotifyCenterEntry =>
      !!item && typeof item === 'object' && typeof (item as NotifyCenterEntry).id === 'string')
    try {
      this.db.exec('BEGIN')
      for (const entry of legacyEntries) {
        this.insertRow(entry)
      }
      this.db.exec('COMMIT')
    } catch {
      try { this.db.exec('ROLLBACK') } catch { /* 尽力回滚 */ }
      this.degraded = true
      this.degradeReason = '旧历史迁移写入失败，已从新数据库开始记录（原文件保留）'
      return
    }

    try { this.db.prepare("INSERT OR REPLACE INTO meta (key, value) VALUES ('migrated', '1')").run() } catch { /* 标记失败无害：INSERT OR IGNORE 保证重跑幂等 */ }
    try { renameSync(legacyPath, legacyPath + '.migrated-' + Date.now()) } catch { /* 改名失败无害：下轮迁移幂等重试 */ }
  }
}
