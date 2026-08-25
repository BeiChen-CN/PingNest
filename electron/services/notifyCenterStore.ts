import { app, safeStorage } from 'electron'
import { promises as fs } from 'fs'
import { join } from 'path'

export interface NotifyCenterEntry {
  id: string
  payload: Record<string, unknown>
  effect: Record<string, unknown>
  receivedAt: number
  read: boolean
}

/**
 * NotifyCenterStore：通知中心磁盘持久化
 * 存储位置：<userData>/notify-center.json
 * 写入采用 300ms 防抖，避免频繁刷盘。
 */
export class NotifyCenterStore {
  private filePath = join(app.getPath('userData'), 'notify-center.json')
  private saveTimer: ReturnType<typeof setTimeout> | null = null
  private writeQueue: Promise<void> = Promise.resolve()
  private entries: NotifyCenterEntry[] = []
  private persistenceBlocked = false

  /** 应用启动时调用，从磁盘加载历史记录（支持 enc: 加密、plain: 明文与旧版裸 JSON） */
  async init(): Promise<void> {
    this.filePath = join(app.getPath('userData'), 'notify-center.json')
    try {
      const data = await fs.readFile(this.filePath, 'utf8')
      let plain: string
      if (data.startsWith('enc:')) {
        if (!safeStorage.isEncryptionAvailable()) {
          this.persistenceBlocked = true
          this.entries = []
          return
        }
        plain = safeStorage.decryptString(Buffer.from(data.slice(4), 'base64'))
      } else if (data.startsWith('plain:')) {
        plain = data.slice(6)
      } else {
        plain = data // 旧版裸 JSON，下次保存时自动迁移为加密
      }
      const parsed = JSON.parse(plain)
      if (Array.isArray(parsed)) {
        this.entries = parsed
          .filter((e) => e && typeof e === 'object' && e.id)
      }
    } catch (e) {
      // 解密失败或文件损坏：备份原文件，避免覆盖不可恢复数据
      console.error('[NotifyCenterStore] 读取历史失败（已备份原文件）:', e)
      try { await fs.rename(this.filePath, this.filePath + '.corrupt-' + Date.now()) } catch { }
      this.entries = []
    }
  }

  getEntries(): NotifyCenterEntry[] {
    return this.entries
  }

  add(entry: NotifyCenterEntry): void {
    this.entries.unshift(entry)
    this.scheduleSave()
  }

  markRead(id: string): void {
    const entry = this.entries.find((e) => e.id === id)
    if (entry && !entry.read) {
      entry.read = true
      this.scheduleSave()
    }
  }

  markSessionRead(sessionId: string): void {
    let changed = false
    for (const entry of this.entries) {
      if (String(entry.payload?.sessionId || '') === sessionId && !entry.read) {
        entry.read = true
        changed = true
      }
    }
    if (changed) this.scheduleSave()
  }

  updateGroupName(sessionId: string, groupName: string): boolean {
    const normalizedSessionId = String(sessionId || '').trim()
    const normalizedName = String(groupName || '').trim()
    if (!normalizedSessionId || !normalizedName) return false
    let changed = false
    for (const entry of this.entries) {
      if (String(entry.payload?.sessionId || '') !== normalizedSessionId) continue
      if (entry.payload.groupName === normalizedName) continue
      entry.payload.groupName = normalizedName
      changed = true
    }
    if (changed) this.scheduleSave()
    return changed
  }

  remove(id: string): void {
    const next = this.entries.filter((entry) => entry.id !== id)
    if (next.length !== this.entries.length) {
      this.entries = next
      this.scheduleSave()
    }
  }

  clear(): void {
    this.entries = []
    this.scheduleSave()
  }

  cleanupOlderThan(days: number): number {
    const retentionDays = Math.max(1, Math.floor(days))
    const cutoff = Date.now() - retentionDays * 24 * 60 * 60 * 1000
    const next = this.entries.filter((entry) => Number(entry.receivedAt) >= cutoff)
    const removedCount = this.entries.length - next.length
    if (removedCount > 0) {
      this.entries = next
      this.scheduleSave()
    }
    return removedCount
  }

  async flush(): Promise<void> {
    if (this.saveTimer) {
      clearTimeout(this.saveTimer)
      this.saveTimer = null
    }
    await this.saveNow()
  }

  private scheduleSave(): void {
    if (this.saveTimer) clearTimeout(this.saveTimer)
    this.saveTimer = setTimeout(() => {
      this.saveTimer = null
      void this.saveNow()
    }, 300)
  }

  private async saveNow(): Promise<void> {
    if (this.persistenceBlocked) return
    const plain = JSON.stringify(this.entries)
    const write = () => this.writeSnapshot(plain)
    this.writeQueue = this.writeQueue.then(write, write)
    await this.writeQueue
  }

  private async writeSnapshot(plain: string): Promise<void> {
    if (this.persistenceBlocked) return
    const tempPath = this.filePath + '.tmp'
    try {
      await fs.mkdir(app.getPath('userData'), { recursive: true })
      let content: string
      if (safeStorage.isEncryptionAvailable()) {
        content = 'enc:' + safeStorage.encryptString(plain).toString('base64')
      } else {
        content = 'plain:' + plain
      }
      await fs.writeFile(tempPath, content, 'utf8')
      await fs.rename(tempPath, this.filePath)
    } catch (e) {
      console.error('[NotifyCenterStore] 保存失败:', e)
      try { await fs.rm(tempPath, { force: true }) } catch { }
    }
  }
}

export const notifyCenterStore = new NotifyCenterStore()
