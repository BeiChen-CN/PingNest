import { Activity, Bell, Database, Inbox, RefreshCw, ShieldCheck, VolumeX } from 'lucide-react'
import { Avatar, formatTime } from '../components/Avatar'
import { Switch } from '../components/Switch'
import type { AppConfig, AppStatus, NotifyCenterEntry, NotifyRule } from '../types'

interface Props {
  status: AppStatus
  config: AppConfig
  entries: NotifyCenterEntry[]
  rules: NotifyRule[]
  busy: boolean
  checking: boolean
  lastStatusAt: number | null
  onOpenHistory: (id?: string) => void
  onRefresh: () => Promise<boolean>
  onAutoSetup: () => void
  onReconnect: () => void
  onToggleNotifications: (enabled: boolean) => void
}

export function OverviewPage({ status, config, entries, rules, busy, checking, lastStatusAt, onOpenHistory, onRefresh, onAutoSetup, onReconnect, onToggleNotifications }: Props) {
  const todayCount = entries.filter((entry) => new Date(entry.receivedAt).toDateString() === new Date().toDateString()).length
  const healthy = status.connected && status.wcdbReady
  const connectionLabel = !status.hasFullConfig ? '未配置' : !status.wechatRunning ? '等待微信' : healthy ? '监听中' : '连接中断'
  const enabledRules = rules.filter((rule) => rule.enabled).length

  return <section className="overview-page page-body">
    <section className="surface overview-hero"><div className="overview-hero-copy"><span className="overview-eyebrow">运行概览</span><h2>今天的通知，一眼掌握</h2><p>查看连接状态、通知摘要和最近收到的消息。</p></div><div className="overview-hero-actions"><span className={'overview-status-pill' + (healthy ? ' good' : '')}><i />{connectionLabel}</span><label className="overview-notification-toggle"><span>桌面弹窗</span><Switch checked={config.notificationEnabled} onChange={onToggleNotifications} label="开启或关闭桌面弹窗" /></label></div></section>

    <div className="overview-metrics"><article className="overview-metric"><span className="metric-icon green"><Activity size={17} /></span><div><small>消息监听</small><b>{connectionLabel}</b><em>{healthy ? '连接稳定' : '需要检查'}</em></div></article><article className="overview-metric"><span className="metric-icon blue"><Bell size={17} /></span><div><small>今日通知</small><b>{todayCount}</b><em>条通知</em></div></article><article className="overview-metric"><span className="metric-icon violet"><VolumeX size={17} /></span><div><small>静音规则</small><b>{enabledRules}</b><em>条已启用</em></div></article><article className="overview-metric"><span className="metric-icon amber"><Database size={17} /></span><div><small>本地历史</small><b>{entries.length}</b><em>条记录</em></div></article></div>

    <div className="overview-content-grid"><section className="surface recent-surface"><div className="overview-section-head"><div><span className="section-kicker">INBOX</span><h3>最近通知</h3></div><button className="text-action" onClick={() => onOpenHistory()}>查看全部</button></div>{entries.length ? <div className="compact-list">{entries.slice(0, 6).map((entry) => <button key={entry.id} onClick={() => onOpenHistory(entry.id)}><Avatar entry={entry} /><span className="compact-main"><b>{entry.payload.groupName || entry.payload.sourceName}</b><small>{entry.payload.content || '无文字内容'}</small></span><time>{formatTime(entry.receivedAt)}</time>{!entry.read && <i className="count-dot" />}</button>)}</div> : <div className="empty-state"><Inbox size={24} /><b>暂无通知记录</b><span>收到微信消息后会显示在这里</span></div>}</section>
      <aside className="overview-side-stack"><section className="surface runtime-surface"><div className="overview-section-head compact"><div><span className="section-kicker">SYSTEM</span><h3>运行状态</h3></div><span className={'mini-state' + (healthy ? ' good' : '')}><i />{healthy ? '正常' : '检查中'}</span></div><dl><div><dt>微信进程</dt><dd>{status.wechatRunning ? '已运行' : '未运行'}</dd></div><div><dt>微信连接</dt><dd>{status.wcdbReady ? '就绪' : '不可用'}</dd></div><div><dt>状态更新</dt><dd>{lastStatusAt ? new Date(lastStatusAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '等待检查'}</dd></div><div><dt>自动重连</dt><dd>{config.autoReconnect ? `${config.reconnectIntervalSeconds} 秒` : '关闭'}</dd></div></dl><button className="button full" disabled={checking} onClick={() => void onRefresh()}><RefreshCw size={13} className={checking ? 'spin' : ''} />{checking ? '正在检查' : '检查连接'}</button></section><section className="surface overview-privacy"><ShieldCheck size={16} /><div><b>本地数据保护</b><span>通知内容只保存在本机。</span></div></section></aside>
    </div>

    {!status.hasFullConfig && <section className="connection-callout"><Database size={20} /><div><b>连接微信</b><span>请先启动并登录微信。</span></div><button className="button primary" disabled={busy} onClick={onAutoSetup}>{busy ? '正在连接' : '开始连接'}</button></section>}
    {status.hasFullConfig && !healthy && <section className="connection-callout warning"><Database size={20} /><div><b>{status.wechatRunning ? '消息监听已中断' : '等待微信启动'}</b><span>{status.wechatRunning ? '请重新连接微信。' : '启动并登录微信后再连接。'}</span></div><button className="button primary" disabled={busy || !status.wechatRunning} onClick={onReconnect}>{busy ? '正在连接' : '重新连接'}</button></section>}
  </section>
}
