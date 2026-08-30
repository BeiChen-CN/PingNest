import { useMemo } from 'react'
import { useCountUp } from '../hooks/useCountUp'
import { ArrowRight, Bell, CheckCircle2, Link2, VolumeX, Wifi, WifiOff } from 'lucide-react'
import { Avatar, formatTime } from '../components/Avatar'
import { groupHistoryEntries } from '../historyGrouping'
import type { AppStatus, NotifyCenterEntry, NotifyRule } from '../types'

interface Dashboard {
  status: AppStatus | null
  config: { historyRetentionDays: number; notificationEnabled: boolean } | null
  entries: NotifyCenterEntry[]
  rules?: NotifyRule[]
  busy: boolean
  hookBusy: boolean
  checkNow: () => Promise<boolean>
  reconnect: () => Promise<boolean>
}

interface Props {
  dashboard: Dashboard
  onOpenHistory: (id?: string) => void
  onGoRules: () => void
}

function hourGreeting(): string {
  const h = new Date().getHours()
  if (h < 6) return '夜深了'
  if (h < 12) return '早上好'
  if (h < 14) return '中午好'
  if (h < 18) return '下午好'
  return '晚上好'
}

/** 主页：纯数据 Bento 甲板。设置归设置页，动作归各功能页。 */
export function HomePage({ dashboard, onOpenHistory, onGoRules }: Props) {
  const { status, entries, config } = dashboard
  const rules: NotifyRule[] = dashboard.rules || []
  if (!status || !config) return null
  const today = new Date().toDateString()
  const todayCount = entries.filter((entry) => new Date(entry.receivedAt).toDateString() === today).length
  const unreadCount = entries.filter((entry) => !entry.read).length
  const enabledRules = rules.filter((rule) => rule.enabled).length
  const recent = entries.slice(0, 5)
  const conversations = useMemo(() => groupHistoryEntries(entries).slice(0, 3), [entries])
  const healthy = status.connected && status.wcdbReady && !status.pushError

  const health = healthy ? 92 : status.wechatRunning ? 58 : 0
  // 数字滚动（首挂从 0 缓动到目标值）
  const nToday = useCountUp(todayCount)
  const nUnread = useCountUp(unreadCount)
  const nHealth = useCountUp(health)
  const nHistory = useCountUp(entries.length)

  return <>
    <div className="greet">
      <div>
        <h3>{hourGreeting()}</h3>
        <div className="gd">
          {new Date().toLocaleDateString('zh-CN', { year: 'numeric', month: 'long', day: 'numeric', weekday: 'long' })}
          {' · '}{healthy ? '通知一切正常' : status.pushError ? '消息同步异常' : status.wechatRunning ? '等待连接' : '微信未运行'}
        </div>
      </div>
      <span className="sp" />
      <button className="md-button outlined" disabled={dashboard.busy} onClick={() => void dashboard.checkNow()}>立即检查</button>
      <button className="md-button filled" disabled={dashboard.hookBusy || !status.wechatRunning} onClick={() => void dashboard.reconnect()}>重新连接</button>
    </div>

    <div className="bento">
      <div className="bx bx-hero">
        <h4>实时消息流</h4>
        <div className="big">{nToday}<small> 条 · 今日</small></div>
        <div className="live">
          {recent.length === 0 && <div className="ln empty">收到微信消息后会显示在这里</div>}
          {recent.map((entry) => <button key={entry.id} className="ln" onClick={() => onOpenHistory(entry.id)}>
            <span className="av">{(entry.payload.groupName || entry.payload.sourceName || '?').charAt(0)}</span>
            <span className="who">{entry.payload.groupName ? entry.payload.sourceName + ' · ' + entry.payload.groupName : entry.payload.sourceName}</span>
            <span className="tx">{entry.payload.content || '无文字内容'}</span>
            <span className="tm">{formatTime(entry.receivedAt)}</span>
          </button>)}
        </div>
      </div>

      <div className="bx">
        <h4>未读</h4>
        <div className="big" style={{ color: 'var(--brand-deep)' }}>{nUnread}</div>
        <div className="sub">{unreadCount > 0 ? '点击「历史」逐条处理' : '全部已读'}</div>
      </div>

      <div className="bx">
        <h4>连接详情</h4>
        <div className="kv2"><span><Wifi size={12} /> 微信进程</span><b>{status.wechatRunning ? '运行中' : '未运行'}</b></div>
        <div className="kv2"><span>数据库</span><b>{status.wcdbReady ? '已解密' : '未就绪'}</b></div>
        <div className="kv2"><span>监听</span><b>{status.pushError ? '异常' : healthy ? '正常' : '未连接'}</b></div>
        <div className="meter"><i style={{ width: nHealth + '%' }} /></div>
        <div className="sub" style={{ marginTop: 5 }}>连接健康度 {health}%{status.pushError ? ' · ' + status.pushError : ''}</div>
      </div>

      <div className="bx">
        <h4>静音规则</h4>
        <button className="big as-link" onClick={onGoRules}>{enabledRules}</button>
        <div className="sub">{rules.length} 条规则 · {enabledRules} 条启用</div>
        <div className="chiprow">
          {rules.filter((rule) => rule.enabled).slice(0, 2).map((rule) => <span key={rule.id} className="chip">{rule.name}</span>)}
          {rules.some((rule) => !rule.enabled) && <span className="chip warn">{rules.filter((rule) => !rule.enabled).length} 条停用</span>}
          {rules.length === 0 && <button className="chip as-chip-btn" onClick={onGoRules}>去创建<ArrowRight size={10} /></button>}
        </div>
      </div>

      <div className="bx" style={{ gridColumn: 'span 2' }}>
        <h4>最近会话</h4>
        <div className="sess">
          {conversations.length === 0 && <div className="ln empty">暂无会话</div>}
          {conversations.map((conversation) => <button key={conversation.id} className="hrow" onClick={() => onOpenHistory(conversation.latestEntry.id)}>
            <Avatar entry={conversation.latestEntry} size={34} />
            <div className="hm">
              <div className="h1"><span className="hn">{conversation.name}</span><span className="hg">{conversation.type === 'group' ? '群聊' : conversation.type === 'official' ? '公众号' : '私聊'}</span><span className="ht">{formatTime(conversation.lastMessageAt)}</span></div>
              <div className="h2">{conversation.type === 'group' ? conversation.latestEntry.payload.sourceName + '：' : ''}{conversation.latestEntry.payload.content || '无文字内容'}</div>
            </div>
            {conversation.unreadCount > 0 && <span className="chip">{conversation.unreadCount} 新</span>}
          </button>)}
        </div>
      </div>

      <div className="bx">
        <h4>今日概览</h4>
        <div className="kv2"><span><Bell size={12} /> 已推送通知</span><b>{todayCount} 条</b></div>
        <div className="kv2"><span><VolumeX size={12} /> 静音规则命中</span><b>见规则页</b></div>
        <div className="kv2"><span><CheckCircle2 size={12} /> 未读消息</span><b>{unreadCount} 条</b></div>
      </div>

      <div className="bx">
        <h4>本地历史</h4>
        <div className="big">{nHistory}</div>
        <div className="sub">{status.history?.writeEncrypted === false ? '明文存储' : '加密存储'} · 保留 {config.historyRetentionDays} 天</div>
        <div className="meter"><i style={{ width: Math.min(100, entries.length / 2) + '%' }} /></div>
      </div>

      <div className="bx">
        <h4>数据安全</h4>
        <div className="kv2"><span><Link2 size={12} /> 存储</span><b>{status.history?.writeEncrypted === false ? '明文' : 'safeStorage'}</b></div>
        <div className="kv2"><span>上传</span><b>无外联</b></div>
        <div className="kv2"><span>{status.history?.degraded ? <WifiOff size={12} /> : <CheckCircle2 size={12} />} 状态</span><b>{status.history?.degraded ? '已降级' : '正常'}</b></div>
      </div>
    </div>
  </>
}
