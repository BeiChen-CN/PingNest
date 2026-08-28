import { dbWorkerClient } from './dbWorkerClient'
import { ConfigService } from './config'
import { cleanAccountDirName } from './dbPathService'
import { join } from 'path'
import { resolveContactDisplayName } from './displayName'

export interface ChatSession {
  username: string
  displayName?: string
  display_name?: string
  lastTimestamp?: number
  unreadCount?: number
  type?: string
  avatarUrl?: string
  lastSenderDisplayName?: string
  // wcdb 返回的下划线格式字段
  last_timestamp?: number | string
  unread_count?: number | string
  last_sender_display_name?: string
  remark?: string
  nickName?: string
  nick_name?: string
  summary?: string
  last_msg_type?: number | string
}

export interface ContactAvatar {
  avatarUrl?: string
  displayName?: string
}

interface AvatarCacheEntry {
  avatarUrl?: string
  displayName?: string
  updatedAt: number
}

/**
 * ChatService：负责连接生命周期、会话/消息查询、联系人信息缓存。
 * 数据层通过 dbWorkerClient 运行在独立进程（utilityProcess）中。
 */
export class ChatService {
  private connected = false
  private avatarCache = new Map<string, AvatarCacheEntry>()
  private readonly avatarCacheTtlMs = 10 * 60 * 1000
  private monitorStarted = false

  constructor(private configService: ConfigService) { }

  async connect(): Promise<{ success: boolean; error?: string }> {
    try {
      const ready = await dbWorkerClient.isReady().catch(() => ({ ready: false }))
      if (this.connected && ready.ready) return { success: true }

      const wxid = this.configService.get('myWxid')
      const dbPath = this.configService.get('dbPath')
      const decryptKey = this.configService.get('decryptKey')
      return this.connectWithCredentials(wxid, dbPath, decryptKey)
    } catch (e) {
      console.error('[ChatService] 连接数据库失败:', e)
      return { success: false, error: String(e) }
    }
  }

  /** 使用已保存凭据重建数据库连接，不执行密钥 Hook。 */
  async reconnect(): Promise<{ success: boolean; error?: string }> {
    this.connected = false
    this.monitorStarted = false
    await dbWorkerClient.shutdown()
    return this.connect()
  }

  /** 使用候选凭据连接，供 Hook 完成后的提交前验证使用。 */
  async connectWithCredentials(wxid: string, dbPath: string, decryptKey: string): Promise<{ success: boolean; error?: string }> {
    try {
      if (!wxid) return { success: false, error: '未识别到微信账号' }
      if (!dbPath) return { success: false, error: '未找到微信数据，请确认已登录微信' }
      if (!decryptKey) return { success: false, error: '未能建立微信连接' }

      const resourcesPath = typeof process['resourcesPath'] !== 'undefined' && process['resourcesPath']
        ? process.resourcesPath as string
        : join(process.cwd(), 'resources')
      await dbWorkerClient.setPaths(resourcesPath, this.configService.getCacheBasePath())

      const cleanedWxid = cleanAccountDirName(wxid)
      const openResult = await dbWorkerClient.open(dbPath, decryptKey, cleanedWxid)
      if (!openResult.success) {
        return { success: false, error: openResult.error || '暂时无法读取微信通知' }
      }

      this.connected = true
      const monitorReady = await this.setupDbMonitor()
      if (!monitorReady) {
        this.connected = false
        await dbWorkerClient.shutdown()
        return { success: false, error: '数据库监控启动失败，请重试' }
      }
      return { success: true }
    } catch (e) {
      this.connected = false
      console.error('[ChatService] 验证数据库凭据失败:', e)
      return { success: false, error: String(e) }
    }
  }

  async ensureConnected(): Promise<{ success: boolean; error?: string }> {
    const ready = await dbWorkerClient.isReady().catch(() => ({ ready: false }))
    if (this.connected && ready.ready) return { success: true }
    const result = await this.connect()
    if (!result.success) {
      this.connected = false
      return { success: false, error: result.error }
    }
    return { success: true }
  }

  isConnected(): boolean {
    return this.connected
  }

  addDbMonitorListener(listener: (type: string, json: string) => void): () => void {
    return dbWorkerClient.addMonitorListener(listener)
  }

  private async setupDbMonitor(): Promise<boolean> {
    if (this.monitorStarted) return true
    try {
      await this.updateMonitorOptions()
    } catch (error) {
      console.warn('[ChatService] 更新数据库监控设置失败:', error)
      return false
    }
    const result = await dbWorkerClient.startMonitor()
    if (!result.success) {
      console.warn('[ChatService] 数据库监控启动失败')
      return false
    }
    this.monitorStarted = true
    return true
  }

  async updateMonitorOptions(): Promise<void> {
    await dbWorkerClient.setMonitorOptions(
      this.configService.get('autoReconnect'),
      this.configService.get('reconnectIntervalSeconds')
    )
  }

  async getSessions(): Promise<{ success: boolean; sessions?: ChatSession[]; error?: string }> {
    const connectResult = await this.ensureConnected()
    if (!connectResult.success) return { success: false, error: connectResult.error }
    return dbWorkerClient.getSessions()
  }

  async getNewMessages(sessionId: string, since: number, limit = 1000): Promise<{ success: boolean; messages?: any[]; error?: string }> {
    const connectResult = await this.ensureConnected()
    if (!connectResult.success) return { success: false, error: connectResult.error }
    return dbWorkerClient.getNewMessages(sessionId, since, limit)
  }

  async getContactAvatar(username: string): Promise<ContactAvatar | null> {
    if (!username) return null
    try {
      const connectResult = await this.ensureConnected()
      if (!connectResult.success) return null

      const cached = this.avatarCache.get(username)
      if (cached && Date.now() - cached.updatedAt < this.avatarCacheTtlMs) {
        return { avatarUrl: cached.avatarUrl, displayName: cached.displayName }
      }

      let avatarUrl: string | undefined
      let displayName: string | undefined

      const [contactResult, avatarResult, displayNameResult] = await Promise.all([
        dbWorkerClient.getContact(username),
        dbWorkerClient.getAvatarUrls([username]),
        dbWorkerClient.getDisplayNames([username])
      ])

      if (avatarResult.success && avatarResult.map) {
        const url = avatarResult.map[username]
        if (this.isValidAvatarUrl(url)) avatarUrl = url
      }
      const contact = contactResult.success ? contactResult.contact : null
      const mappedName = displayNameResult.success && displayNameResult.map
        ? displayNameResult.map[username] || displayNameResult.map[username.toLowerCase()]
        : undefined
      displayName = resolveContactDisplayName(username, contact, mappedName, cached?.displayName)

      const cacheEntry: AvatarCacheEntry = { avatarUrl, displayName, updatedAt: Date.now() }
      this.avatarCache.set(username, cacheEntry)
      return { avatarUrl, displayName }
    } catch {
      return null
    }
  }

  async getGroupNicknames(chatroomId: string): Promise<Record<string, string>> {
    const result = await dbWorkerClient.getGroupNicknames(chatroomId)
    return result.success && result.map ? result.map : {}
  }

  private isValidAvatarUrl(avatarUrl?: string): boolean {
    const normalized = String(avatarUrl || '').trim()
    if (!normalized) return false
    const lower = normalized.toLowerCase()
    if (lower.includes('base64,ffd8')) return false
    if (lower.startsWith('ffd8')) return false
    return true
  }

  async close(): Promise<void> {
    this.connected = false
    this.monitorStarted = false
    await dbWorkerClient.shutdown()
  }
}

export const chatService = new ChatService(ConfigService.getInstance())
