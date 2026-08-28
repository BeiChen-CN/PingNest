import { Activity, Bell, RefreshCw, ShieldCheck, VolumeX } from 'lucide-react'
import { Avatar, formatTime } from '../components/Avatar'
import type { AppConfig, AppStatus, NotifyCenterEntry, NotifyRule } from '../types'

interface Props {
  status: AppStatus
  config: AppConfig
  entries: NotifyCenterEntry[]
  rules: NotifyRule[]
  busy: boolean
  connecting: boolean
  checking: boolean
  lastStatusAt: number | null
  onOpenHistory: (id?: string) => void
  onRefresh: () => Promise<boolean>
  onConnect: () => void
  onReconnect: () => void
}

export function OverviewPage({ status, config, entries, rules, busy, connecting, checking, lastStatusAt, onOpenHistory, onRefresh, onConnect, onReconnect }: Props) {
  const todayCount = entries.filter((entry) => new Date(entry.receivedAt).toDateString() === new Date().toDateString()).length
  const healthy = status.connected && status.wcdbReady
  const connectionLabel = !status.hasFullConfig ? '未配置' : !status.wechatRunning ? '等待微信' : healthy ? '监听中' : '连接中断'
  const enabledRules = rules.filter((rule) => rule.enabled).length

  return <section className="overview-page page-body">
    <div className="summary-grid">
      <section className={'stat stat-featured'}>
        <div className="stat-head"><span>监听状态</span><Activity size={18} /></div>
        <strong>{connectionLabel}</strong>
        <small>{healthy ? '连接稳定' : '需要检查'}</small>
      </section>
      <section className="stat">
        <div className="stat-head"><span>今日通知</span><Bell size={18} /></div>
        <strong>{todayCount}</strong>
        <small>条通知</small>
      </section>
      <section className="stat">
        <div className="stat-head"><span>静音规则</span><VolumeX size={18} /></div>
        <strong>{enabledRules} 条</strong>
        <small>已启用 {rules.length} 条规则</small>
      </section>
    </div>

    <div className="overview-grid">
      <section className="surface">
        <div className="section-head">
          <h3>最近通知</h3>
          <button className="text-action" onClick={() => onOpenHistory()}>查看全部</button>
        </div>
        {entries.length ? (
          <div className="message-list">
            {entries.slice(0, 6).map((entry) => (
              <button key={entry.id} className="message-row" onClick={() => onOpenHistory(entry.id)}>
                <Avatar entry={entry} size={36} />
                <span className="message-copy">
                  <b>{entry.payload.groupName || entry.payload.sourceName}</b>
                  <span>{entry.payload.content || '无文字内容'}</span>
                </span>
                <time>{formatTime(entry.receivedAt)}</time>
                {!entry.read && <i className="unread-dot" aria-label="未读" />}
              </button>
            ))}
          </div>
        ) : (
          <div className="empty-state"><b>暂无通知记录</b><span>收到微信消息后会显示在这里</span></div>
        )}
      </section>

      <aside className="surface runtime">
        <h2>监控运行状态</h2>
        <dl>
          <div><dt>微信进程</dt><dd>{status.wechatRunning ? '已运行' : '未运行'}</dd></div>
          <div><dt>数据库连接</dt><dd>{status.wcdbReady ? '就绪' : '不可用'}</dd></div>
          <div><dt>本地历史</dt><dd>{config.notifyCenterEnabled ? `${entries.length} 条` : '未启用'}</dd></div>
          <div><dt>自动重连</dt><dd>{config.autoReconnect ? `${config.reconnectIntervalSeconds} 秒` : '关闭'}</dd></div>
          <div><dt>状态更新</dt><dd>{lastStatusAt ? new Date(lastStatusAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '等待检查'}</dd></div>
        </dl>
        <button className="md-button tonal full" disabled={checking} onClick={() => void onRefresh()}>
          <RefreshCw size={15} className={checking ? 'spin' : ''} />{checking ? '正在检查' : '立即检查'}
        </button>
        <div className="privacy-note">
          <ShieldCheck size={15} />
          <span>通知内容只保存在本机。</span>
        </div>
      </aside>
    </div>

    {!status.hasFullConfig && (
      <section className="inline-alert">
        <div><b>连接微信</b><span>请先启动并登录微信。</span></div>
        <button className="md-button filled" disabled={connecting} onClick={onConnect}>{connecting ? '正在连接' : '开始连接'}</button>
      </section>
    )}
    {status.hasFullConfig && !healthy && (
      <section className="inline-alert warning">
        <div><b>{status.wechatRunning ? '消息监听已中断' : '等待微信启动'}</b><span>{status.wechatRunning ? '请重新连接微信。' : '启动并登录微信后再连接。'}</span></div>
        <button className="md-button filled" disabled={busy || !status.wechatRunning} onClick={onReconnect}>{busy ? '正在连接' : '重新连接'}</button>
      </section>
    )}
  </section>
}
