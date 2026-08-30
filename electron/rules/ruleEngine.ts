import type { ConfigService } from '../services/config'
import type { MessagePushPayload } from '../services/messagePushService'
import type { NotificationPosition, NotifyRule } from '../../shared/appConfig'

export interface RuleEffect {
  accentColor?: string
  durationMs?: number
  position?: NotificationPosition
  sound?: string
  muted?: boolean
}

/**
 * 规则引擎：根据会话/关键词匹配规则，输出弹窗覆盖效果。
 * 纯逻辑模块（仅类型导入，零 electron 依赖），生产单例在 main.ts 组装。
 */
export class RuleEngine {
  private readonly configService: Pick<ConfigService, 'get'>

  // 显式赋值而非参数属性：node:test 直接加载本文件时类型擦除不支持 parameter property
  constructor(configService: Pick<ConfigService, 'get'>) {
    this.configService = configService
  }

  match(payload: MessagePushPayload): RuleEffect {
    const rules = this.configService.get('notifyRules')
    if (!Array.isArray(rules) || rules.length === 0) return {}

    const content = String(payload.content || '').toLowerCase()
    const sessionId = payload.sessionId

    for (const rawRule of rules) {
      if (!rawRule || typeof rawRule !== 'object') continue
      const rule = rawRule as Partial<NotifyRule>
      const sessionIds = Array.isArray(rule.sessionIds) ? rule.sessionIds.filter((value): value is string => typeof value === 'string') : []
      const keywords = Array.isArray(rule.keywords) ? rule.keywords : []
      if (rule.enabled !== true) continue

      const sessionHit = sessionIds.includes(sessionId)
      const keywordHit = keywords.some((kw) => {
        const k = String(kw || '').trim().toLowerCase()
        return k !== '' && content.includes(k)
      })

      let hit = false
      if (rule.matchMode === 'all') {
        hit = (sessionIds.length > 0 ? sessionHit : true) && (keywords.length > 0 ? keywordHit : true)
      } else {
        hit = sessionHit || keywordHit
      }

      if (hit) {
        return {
          accentColor: rule.accentColor || undefined,
          durationMs: rule.durationMs || undefined,
          position: rule.position || undefined,
          sound: rule.sound || undefined,
          muted: rule.muted === true
        }
      }
    }
    return {}
  }
}
