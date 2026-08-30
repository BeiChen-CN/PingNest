import { EventEmitter } from 'events'
import type { ChatService, ChatSession } from './chatService'
import type { ConfigService } from './config'
// 值导入显式带 .ts 扩展名：node:test 直接加载本文件时 ESM 不会补全扩展名
// （vite/esbuild 与 tsc(allowImportingTsExtensions) 均兼容该写法）。
import { getMessageDisplayContent } from '../../shared/messageContent.ts'
import { normalizeMessageSendState, shouldPushIncomingMessage } from './messageDirection.ts'
import { resolveGroupDisplayName, resolveSessionDisplayName } from './displayName.ts'
import {
  calculateMessageQuerySince,
  shouldInspectSession,
  type SessionBaseline
} from './messageBaseline.ts'
import {
  extractReplaceMsg,
  findRevokedOriginalInMessages,
  isRevokeSystemMessage,
  isSelfRevokeMessage
} from './messageRevoke.ts'
import { TtlKeyCache } from './messageDedupe.ts'

export interface MessagePushPayload {
  event: 'message.new' | 'message.revoke'
  sessionId: string
  sessionType: 'private' | 'group' | 'official' | 'other'
  rawid: string
  avatarUrl?: string
  sourceName: string
  groupName?: string
  content: string | null
  timestamp: number
}

interface PushSessionResult {
  pushedCount: number
  success: boolean
}

/**
 * 依赖全部注入（无模块级单例引用）：本文件不得 import 任何触碰 electron 的模块，
 * 否则 node:test 无法直接加载（合成消息源测试依赖这一点，见 tests/message-push-core.test.mjs）。
 */
export interface MessagePushDeps {
  configService: Pick<ConfigService, 'get'>
  chatService: Pick<ChatService,
    'connect' | 'getSessions' | 'getNewMessages' | 'getContactAvatar' | 'getGroupNicknames'>
}

/**
 * MessagePushService（移植自 WeFlow，裁剪）
 * 监听微信数据库变化 → 防抖 → 对比会话基线 → 查询新消息 → 去重 → 广播推送事件。
 * 撤回识别见 messageRevoke（纯函数），去重缓存见 messageDedupe；
 * 依赖可注入以便测试，生产单例见 messagePushService.ts。
 */
export class MessagePushService extends EventEmitter {
  private readonly configService: MessagePushDeps['configService']
  private readonly chatService: MessagePushDeps['chatService']
  private readonly sessionBaseline = new Map<string, SessionBaseline>()
  /** 同一 messageKey 在 TTL 内只处理/推送一次 */
  private readonly handledMessageKeys = new TtlKeyCache(10 * 60 * 1000)
  private readonly groupNicknameCache = new Map<string, { nicknames: Record<string, string>; updatedAt: number }>()

  private readonly debounceMs = 350
  private readonly lookbackSeconds = 2
  private readonly groupNicknameCacheTtlMs = 5 * 60 * 1000
  /** 最近一次收到原生监控管道事件的时间：管道活跃说明变更已有即时通道，轮询可降频 */
  private lastMonitorEventAt: number | null = null

  private debounceTimer: ReturnType<typeof setTimeout> | null = null
  private retryTimer: ReturnType<typeof setTimeout> | null = null
  private pollTimer: ReturnType<typeof setTimeout> | null = null
  private processing = false
  private rerunRequested = false
  private started = false
  private baselineReady = false
  private runGeneration = 0
  // 连续同步失败计数：达到阈值视为降级并上报 UI（单次抖动不报警）
  private failureStreak = 0
  private lastFailureReason: string | null = null

  constructor(deps: MessagePushDeps) {
    super()
    this.configService = deps.configService
    this.chatService = deps.chatService
  }

  start(): void {
    if (this.started) return
    this.started = true
    this.scheduleNextPoll()
    const generation = ++this.runGeneration
    void this.refreshConfiguration('startup', generation).catch((error) => {
      console.warn('[MessagePushService] startup refresh failed:', error)
    })
  }

  stop(): void {
    this.started = false
    this.runGeneration += 1
    this.processing = false
    this.rerunRequested = false
    this.failureStreak = 0
    this.lastFailureReason = null
    this.resetRuntimeState()
    if (this.pollTimer) {
      clearTimeout(this.pollTimer)
      this.pollTimer = null
    }
  }

  handleDbMonitorChange(type: string, json: string): void {
    if (!this.started) return
    if (!this.isPushEnabled()) return

    this.lastMonitorEventAt = Date.now()

    let payload: Record<string, unknown> | null = null
    try {
      payload = JSON.parse(json)
    } catch {
      // 管道消息可能被按 NUL 分段，解析失败时退回全量同步，无需报错
      payload = null
    }

    const tableName = String(payload?.table || '').trim()
    const messageTableNames = this.collectMessageTableNamesFromPayload(payload)
    if (this.isSessionTableChange(tableName)) {
      this.scheduleSync()
      return
    }
    if (!tableName && messageTableNames.length === 0) {
      this.scheduleSync()
      return
    }
    if (this.isMessageTableChange(tableName) || messageTableNames.length > 0) {
      this.scheduleSync()
    }
  }

  handleConfigChanged(): void {
    if (!this.started) return
    this.runGeneration += 1
    this.resetRuntimeState()
    const generation = this.runGeneration
    void this.refreshConfiguration('config', generation).catch((error) => {
      console.warn('[MessagePushService] config refresh failed:', error)
    })
  }

  handleReconnectOptionsChanged(): void {
    if (this.retryTimer) {
      clearTimeout(this.retryTimer)
      this.retryTimer = null
    }
    if (this.started && this.isPushEnabled() && this.configService.get('autoReconnect')) {
      this.scheduleRetry()
    }
  }

  private isPushEnabled(): boolean {
    return this.configService.get('notificationEnabled') === true ||
      this.configService.get('notifyCenterEnabled') === true
  }

  /** 连续失败达到阈值后视为降级，供 app:getStatus 向 UI 报告（同步故障此前只进 console，UI 不可见） */
  getDegradedReason(): string | null {
    return this.failureStreak >= 2 && this.lastFailureReason ? this.lastFailureReason : null
  }

  private markFailure(reason: unknown): void {
    this.failureStreak += 1
    const message = reason instanceof Error ? reason.message : String(reason || '未知错误')
    if (this.failureStreak >= 2) console.warn('[MessagePushService] 同步连续失败 ' + this.failureStreak + ' 次:', message)
    this.lastFailureReason = message
  }

  private markSuccess(): void {
    this.failureStreak = 0
    this.lastFailureReason = null
  }

  private resetRuntimeState(): void {
    this.sessionBaseline.clear()
    this.handledMessageKeys.clear()
    this.groupNicknameCache.clear()
    this.baselineReady = false
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
      this.debounceTimer = null
    }
    if (this.retryTimer) {
      clearTimeout(this.retryTimer)
      this.retryTimer = null
    }
  }

  private isGenerationActive(generation: number): boolean {
    // 只比较代际：stop() 会递增代际使在途同步立即失效，started 标志无需重复参与
    // （这也允许测试/合成消息源在不 start() 定时器的情况下直接调用 flushPendingChanges）。
    return this.runGeneration === generation
  }

  private async refreshConfiguration(reason: string, generation: number): Promise<void> {
    if (!this.isGenerationActive(generation)) return
    if (!this.isPushEnabled()) {
      this.resetRuntimeState()
      return
    }
    const connectResult = await this.chatService.connect()
    if (!this.isGenerationActive(generation)) return
    if (!connectResult.success) {
      console.warn('[MessagePushService] Bootstrap connect failed (' + reason + '):', connectResult.error)
      return
    }
    await this.bootstrapBaseline(generation)
  }

  private async bootstrapBaseline(generation: number): Promise<void> {
    if (!this.isGenerationActive(generation)) return
    const sessionsResult = await this.chatService.getSessions()
    if (!this.isGenerationActive(generation)) return
    if (!sessionsResult.success || !sessionsResult.sessions) return
    this.setBaseline(sessionsResult.sessions as ChatSession[])
    this.baselineReady = true
  }

  private scheduleSync(delayMs = this.debounceMs): void {
    if (this.debounceTimer) {
      clearTimeout(this.debounceTimer)
    }
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null
      void this.flushPendingChanges()
    }, delayMs)
  }

  private scheduleRetry(): void {
    if (!this.configService.get('autoReconnect') || this.retryTimer) return
    this.retryTimer = setTimeout(() => {
      this.retryTimer = null
      this.scheduleSync()
    }, this.configService.get('reconnectIntervalSeconds') * 1000)
  }

  /**
   * 轮询调度：自续链 setTimeout（每轮重读配置，间隔改动即时生效）。
   * 基础间隔取 pollIntervalSeconds；若原生监控管道 60 秒内有过事件，
   * 说明数据库变更已有即时通道，本轮退避到 max(5×基础间隔, 10 秒) 以降低空转。
   */
  private scheduleNextPoll(): void {
    if (!this.started) return
    const baseSeconds = Math.max(1, Math.floor(Number(this.configService.get('pollIntervalSeconds')) || 2))
    const monitorActive = this.lastMonitorEventAt !== null && Date.now() - this.lastMonitorEventAt < 60_000
    const seconds = monitorActive ? Math.max(baseSeconds * 5, 10) : baseSeconds
    this.pollTimer = setTimeout(() => {
      this.pollTimer = null
      if (this.started && this.isPushEnabled()) this.scheduleSync(0)
      this.scheduleNextPoll()
    }, seconds * 1000)
  }

  private async flushPendingChanges(): Promise<void> {
    if (this.processing) {
      this.rerunRequested = true
      return
    }
    this.processing = true
    const generation = this.runGeneration
    let retryNeeded = false
    try {
      if (!this.isGenerationActive(generation) || !this.isPushEnabled()) return

      const connectResult = await this.chatService.connect()
      if (!this.isGenerationActive(generation)) return
      if (!connectResult.success) {
        console.warn('[MessagePushService] Sync connect failed:', connectResult.error)
        this.markFailure(connectResult.error || '连接失败')
        retryNeeded = true
        return
      }

      const sessionsResult = await this.chatService.getSessions()
      if (!this.isGenerationActive(generation)) return
      if (!sessionsResult.success || !sessionsResult.sessions) {
        this.markFailure(sessionsResult.error || '获取会话失败')
        retryNeeded = true
        return
      }
      const sessions = sessionsResult.sessions as ChatSession[]

      if (!this.baselineReady) {
        this.setBaseline(sessions)
        this.baselineReady = true
        return
      }

      const previousBaseline = new Map(this.sessionBaseline)
      const candidates = sessions.filter((session) => {
        const sessionId = String(session.username || '').trim()
        if (!sessionId) return false
        const previous = previousBaseline.get(sessionId)
        return this.shouldInspectSession(previous, session)
      })
      for (const session of candidates) {
        if (!this.isGenerationActive(generation)) return
        const sessionId = String(session.username || '').trim()
        const previous = previousBaseline.get(sessionId) || this.sessionBaseline.get(sessionId)
        let result: PushSessionResult
        try {
          result = await this.pushSessionMessages(session, previous)
        } catch (error) {
          console.warn('[MessagePushService] push session failed:', error)
          this.markFailure(error)
          retryNeeded = true
          continue
        }
        if (!this.isGenerationActive(generation)) return
        if (result.success) {
          this.updateBaseline(session, previous)
        } else {
          this.markFailure('会话消息推送失败: ' + sessionId)
          retryNeeded = true
        }
      }

      for (const session of sessions) {
        if (!this.isGenerationActive(generation)) return
        const sessionId = String(session.username || '').trim()
        if (!sessionId || candidates.some(c => c.username === sessionId)) continue
        this.updateBaseline(session, previousBaseline.get(sessionId))
      }
    } finally {
      this.processing = false
      if (!retryNeeded && this.isGenerationActive(generation) && this.isPushEnabled()) {
        this.markSuccess()
      }
      if (this.rerunRequested && this.isGenerationActive(generation)) {
        this.rerunRequested = false
        this.scheduleSync()
      } else if (retryNeeded && this.isGenerationActive(generation) && this.isPushEnabled()) {
        this.scheduleRetry()
      }
    }
  }

  /** wcdb 返回下划线字段，统一兼容读取 */
  private sessionTimestamp(session: ChatSession): number {
    return Number(session.last_timestamp ?? session.lastTimestamp ?? 0)
  }

  private sessionUnread(session: ChatSession): number {
    return Number(session.unread_count ?? session.unreadCount ?? 0)
  }

  private sessionDisplayName(session: ChatSession): string {
    return resolveSessionDisplayName(session)
  }

  private setBaseline(sessions: ChatSession[]): void {
    const previousBaseline = new Map(this.sessionBaseline)
    const nowSeconds = Math.floor(Date.now() / 1000)
    this.sessionBaseline.clear()
    for (const session of sessions) {
      const username = String(session.username || '').trim()
      if (!username) continue
      const previous = previousBaseline.get(username)
      const sessionTimestamp = this.sessionTimestamp(session)
      const initialTimestamp = sessionTimestamp > 0 ? sessionTimestamp : nowSeconds
      this.sessionBaseline.set(username, {
        lastTimestamp: Math.max(sessionTimestamp, Number(previous?.lastTimestamp || 0), previous ? 0 : initialTimestamp),
        unreadCount: this.sessionUnread(session)
      })
    }
  }

  private shouldInspectSession(previous: SessionBaseline | undefined, session: ChatSession): boolean {
    return shouldInspectSession(previous, this.sessionTimestamp(session), this.sessionUnread(session))
  }

  /** 已检查/已观察的会话回写基线（两种场景原本实现完全相同） */
  private updateBaseline(session: ChatSession, previous: SessionBaseline | undefined): void {
    const username = String(session.username || '').trim()
    if (!username) return
    this.sessionBaseline.set(username, {
      lastTimestamp: Math.max(this.sessionTimestamp(session), Number(previous?.lastTimestamp || 0)),
      unreadCount: this.sessionUnread(session)
    })
  }

  private async pushSessionMessages(session: ChatSession, previous: SessionBaseline | undefined): Promise<PushSessionResult> {
    const sessionId = String(session.username || '').trim()
    const previousTimestamp = Math.max(0, Number(previous?.lastTimestamp || 0))
    const since = calculateMessageQuerySince(
      previous,
      this.sessionTimestamp(session),
      this.lookbackSeconds,
      Math.floor(Date.now() / 1000)
    )

    const newMessagesResult = await this.chatService.getNewMessages(sessionId, since, 1000)
    if (!newMessagesResult.success || !Array.isArray(newMessagesResult.messages)) {
      return { pushedCount: 0, success: false }
    }
    const fetchedMessages = newMessagesResult.messages
    let pushedCount = 0
    let processingFailed = false
    const handledMessageKeys = new Set<string>()
    if (fetchedMessages.length === 0) return { pushedCount, success: true }
    const unreadIncreased = this.sessionUnread(session) > Number(previous?.unreadCount || 0)

    for (const message of fetchedMessages) {
      const messageKey = String(message.messageKey || '').trim()
      if (!messageKey) continue
      if (this.handledMessageKeys.has(messageKey)) continue
      const isRevoke = isRevokeSystemMessage(message)
      if (normalizeMessageSendState(message.isSend) === 1) {
        handledMessageKeys.add(messageKey)
        continue
      }
      if (isRevoke && isSelfRevokeMessage(message)) {
        handledMessageKeys.add(messageKey)
        continue
      }
      if (!isRevoke && !shouldPushIncomingMessage(message.isSend, unreadIncreased)) {
        handledMessageKeys.add(messageKey)
        continue
      }
      if (previous && Number(message.createTime || 0) < previousTimestamp) {
        handledMessageKeys.add(messageKey)
        continue
      }

      let payload: MessagePushPayload | null
      try {
        payload = isRevoke
          ? await this.buildRevokePayload(session, message, fetchedMessages)
          : await this.buildPayload(session, message)
      } catch (error) {
        console.warn('[MessagePushService] build payload failed:', error)
        processingFailed = true
        continue
      }
      if (!payload) {
        processingFailed = true
        continue
      }
      if (!this.shouldPushPayload(payload)) {
        handledMessageKeys.add(messageKey)
        continue
      }

      this.emit(payload.event, payload)
      handledMessageKeys.add(messageKey)
      pushedCount += 1
    }

    for (const messageKey of handledMessageKeys) {
      this.handledMessageKeys.remember(messageKey)
    }
    return { pushedCount, success: !processingFailed }
  }

  private async buildPayload(session: ChatSession, message: any): Promise<MessagePushPayload | null> {
    const sessionId = String(session.username || '').trim()
    const messageKey = String(message.messageKey || '').trim()
    if (!sessionId || !messageKey) return null

    const isGroup = sessionId.endsWith('@chatroom')
    const sessionType = this.getSessionType(sessionId, session)
    const content = getMessageDisplayContent(message)
    const rawid = String(message.serverIdRaw || message.serverId || '').trim() || String(message.localId || '')
    const createTime = Number(message.createTime || 0)

    if (isGroup) {
      const groupInfo = await this.chatService.getContactAvatar(sessionId)
      const groupName = groupInfo?.displayName || resolveGroupDisplayName(session) || sessionId
      const sourceName = await this.resolveGroupSourceName(sessionId, message, session)
      const avatarUrl = await this.normalizePushAvatarUrl(session.avatarUrl || groupInfo?.avatarUrl)
      return { event: 'message.new', sessionId, sessionType, rawid, avatarUrl, groupName, sourceName, content, timestamp: createTime }
    }

    const contactInfo = await this.chatService.getContactAvatar(sessionId)
    const avatarUrl = await this.normalizePushAvatarUrl(session.avatarUrl || contactInfo?.avatarUrl)
    return {
      event: 'message.new',
      sessionId,
      sessionType,
      rawid,
      avatarUrl,
      sourceName: contactInfo?.displayName || this.sessionDisplayName(session) || sessionId,
      content,
      timestamp: createTime
    }
  }

  private async buildRevokePayload(session: ChatSession, message: any, fetchedMessages: any[]): Promise<MessagePushPayload | null> {
    const sessionId = String(session.username || '').trim()
    const messageKey = String(message.messageKey || '').trim()
    if (!sessionId || !messageKey) return null
    if (isSelfRevokeMessage(message)) return null

    const original = findRevokedOriginalInMessages(fetchedMessages, message)
    const originalContent = original
      ? getMessageDisplayContent(original)
      : extractReplaceMsg(String(message.rawContent || message.parsedContent || ''))

    const isGroup = sessionId.endsWith('@chatroom')
    const sessionType = this.getSessionType(sessionId, session)
    const createTime = Number(message.createTime || 0)
    const safeContent = String(originalContent || '未知内容').trim() || '未知内容'
    const content = '对方撤回了一条消息，内容为「' + safeContent + '」'

    if (isGroup) {
      const groupInfo = await this.chatService.getContactAvatar(sessionId)
      const groupName = groupInfo?.displayName || resolveGroupDisplayName(session) || sessionId
      const sourceName = original?.senderUsername
        ? await this.resolveGroupSourceName(sessionId, original, session)
        : (resolveGroupDisplayName(session) || '群成员')
      const avatarUrl = await this.normalizePushAvatarUrl(session.avatarUrl || groupInfo?.avatarUrl)
      return { event: 'message.revoke', sessionId, sessionType, rawid: String(message.serverIdRaw || ''), avatarUrl, groupName, sourceName, content, timestamp: createTime }
    }

    const contactInfo = await this.chatService.getContactAvatar(sessionId)
    const avatarUrl = await this.normalizePushAvatarUrl(session.avatarUrl || contactInfo?.avatarUrl)
    return {
      event: 'message.revoke',
      sessionId,
      sessionType,
      rawid: String(message.serverIdRaw || ''),
      avatarUrl,
      sourceName: contactInfo?.displayName || this.sessionDisplayName(session) || sessionId,
      content,
      timestamp: createTime
    }
  }

  private async resolveGroupSourceName(chatroomId: string, message: any, session: ChatSession): Promise<string> {
    const senderUsername = String(message.senderUsername || '').trim()
    if (!senderUsername) return this.sessionDisplayName(session) || '未知发送者'

    const groupNicknames = await this.getGroupNicknames(chatroomId)
    const senderKey = senderUsername.toLowerCase()
    const nickname = groupNicknames[senderKey]
    if (nickname) return nickname

    const contactInfo = await this.chatService.getContactAvatar(senderUsername)
    return contactInfo?.displayName || senderUsername
  }

  private async getGroupNicknames(chatroomId: string): Promise<Record<string, string>> {
    const cacheKey = String(chatroomId || '').trim()
    if (!cacheKey) return {}
    const cached = this.groupNicknameCache.get(cacheKey)
    if (cached && Date.now() - cached.updatedAt < this.groupNicknameCacheTtlMs) {
      return cached.nicknames
    }
    const nicknames = await this.chatService.getGroupNicknames(cacheKey)
    this.groupNicknameCache.set(cacheKey, { nicknames, updatedAt: Date.now() })
    this.pruneGroupNicknameCache()
    return nicknames
  }

  /** 群昵称缓存条目软上限：超过后清理过期项，防止长期驻留时 Map 只增不减 */
  private pruneGroupNicknameCache(): void {
    if (this.groupNicknameCache.size <= 200) return
    const now = Date.now()
    for (const [key, entry] of this.groupNicknameCache) {
      if (now - entry.updatedAt >= this.groupNicknameCacheTtlMs) this.groupNicknameCache.delete(key)
    }
  }

  private normalizePushAvatarUrl(avatarUrl?: string): string | undefined {
    const normalized = String(avatarUrl || '').trim()
    if (!normalized) return undefined
    return normalized
  }

  private getSessionType(sessionId: string, session: ChatSession): MessagePushPayload['sessionType'] {
    if (sessionId.endsWith('@chatroom')) return 'group'
    const sessionType = String(session.type || '').trim().toLowerCase()
    if (sessionId.startsWith('gh_') || sessionType === 'official') return 'official'
    if (sessionType === 'friend' || sessionType === 'private' || sessionType === 'contact' || sessionType === 'single') return 'private'
    // WeChat contact sessions do not always expose a stable type field. Any
    // non-group, non-official session with an id is a direct conversation.
    return sessionId ? 'private' : 'other'
  }

  private shouldPushPayload(payload: MessagePushPayload): boolean {
    const sessionId = String(payload.sessionId || '').trim()
    const filterMode = this.configService.get('notificationFilterMode')
    if (filterMode === 'all') return true
    const filterList = this.configService.get('notificationFilterList')
    const listed = filterList.includes(sessionId)
    if (filterMode === 'whitelist') return listed
    return !listed
  }

  private collectMessageTableNamesFromPayload(payload: Record<string, unknown> | null): string[] {
    const tableNames: string[] = []
    const visit = (value: unknown, keyHint = '') => {
      if (value === null || value === undefined) return
      if (typeof value === 'string') {
        const trimmed = value.trim()
        if (!trimmed) return
        const key = keyHint.toLowerCase()
        if (key.includes('table') && this.isMessageTableChange(trimmed)) {
          tableNames.push(trimmed)
          return
        }
        for (const match of trimmed.matchAll(/\b(?:msg|message)_[a-z0-9_]+/gi)) {
          const tableName = String(match[0] || '').trim()
          if (tableName && this.isMessageTableChange(tableName)) tableNames.push(tableName)
        }
        return
      }
      if (Array.isArray(value)) {
        for (const item of value) visit(item, keyHint)
        return
      }
      if (typeof value !== 'object') return
      for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
        visit(nested, key)
      }
    }
    visit(payload)
    return Array.from(new Set(tableNames))
  }

  private isSessionTableChange(tableName: string): boolean {
    return String(tableName || '').trim().toLowerCase() === 'session'
  }

  private isMessageTableChange(tableName: string): boolean {
    const normalized = String(tableName || '').trim().toLowerCase()
    if (!normalized) return false
    return normalized === 'message' ||
      normalized === 'msg' ||
      normalized.startsWith('message_') ||
      normalized.startsWith('msg_') ||
      normalized.includes('message')
  }
}
