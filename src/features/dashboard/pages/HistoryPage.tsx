import { Fragment, useDeferredValue, useEffect, useMemo, useState } from 'react'
import { ArrowLeft, CalendarDays, Check, Copy, Inbox, Search, Trash2, Users, X } from 'lucide-react'
import { Avatar, formatTime } from '../components/Avatar'
import { groupHistoryEntries, historyConversationId, historyMessageTime, normalizeHistorySessionType } from '../historyGrouping'
import { toast } from '../stores/toastStore'
import type { NotifyCenterEntry } from '../types'

interface Props {
  entries: NotifyCenterEntry[]
  selectedId: string | null
  onSelect: (sessionId: string, latestEntryId: string) => void
  onRequestRemove: (entry: NotifyCenterEntry) => void
  onRequestClear: () => void
}

const TYPE_LABELS: Record<string, string> = { private: '私聊', group: '群聊', official: '公众号', other: '其他' }

function messageDay(value: number): string {
  const date = new Date(value)
  const today = new Date()
  const yesterday = new Date()
  yesterday.setDate(today.getDate() - 1)
  if (date.toDateString() === today.toDateString()) return '今天'
  if (date.toDateString() === yesterday.toDateString()) return '昨天'
  return date.toLocaleDateString([], { year: 'numeric', month: 'long', day: 'numeric' })
}

function messageClock(value: number): string {
  return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

function localDateKey(value: number): string {
  const date = new Date(value)
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

export function HistoryPage({ entries, selectedId, onSelect, onRequestRemove, onRequestClear }: Props) {
  const [query, setQuery] = useState('')
  const deferredQuery = useDeferredValue(query)
  const [dateFilter, setDateFilter] = useState('all')
  const [typeFilter, setTypeFilter] = useState('all')
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const selectedEntry = useMemo(() => entries.find((entry) => entry.id === selectedId), [entries, selectedId])
  const [activeConversationId, setActiveConversationId] = useState<string | null>(() => selectedEntry ? historyConversationId(selectedEntry) : null)
  const [mobileDetailOpen, setMobileDetailOpen] = useState(Boolean(selectedId))

  const scopedEntries = useMemo(() => {
    return entries.filter((entry) => {
      return (dateFilter === 'all' || localDateKey(historyMessageTime(entry)) === dateFilter)
        && (typeFilter === 'all' || normalizeHistorySessionType(entry) === typeFilter)
    })
  }, [entries, dateFilter, typeFilter])

  const conversations = useMemo(() => {
    const normalized = deferredQuery.trim().toLowerCase()
    return groupHistoryEntries(scopedEntries).filter((conversation) => {
      if (!normalized) return true
      return conversation.entries.some((entry) => `${conversation.name} ${entry.payload.sourceName} ${entry.payload.content || ''}`.toLowerCase().includes(normalized))
    })
  }, [scopedEntries, deferredQuery])
  const activeConversation = conversations.find((conversation) => conversation.id === activeConversationId) || conversations[0] || null
  const timeline = useMemo(() => activeConversation ? [...activeConversation.entries].reverse() : [], [activeConversation])
  const hasFilters = Boolean(query.trim() || dateFilter !== 'all' || typeFilter !== 'all')

  useEffect(() => {
    if (!selectedEntry) return
    setActiveConversationId(historyConversationId(selectedEntry))
    setMobileDetailOpen(true)
  }, [selectedEntry])

  useEffect(() => {
    if (!copiedId) return
    const timer = window.setTimeout(() => setCopiedId(null), 1500)
    return () => window.clearTimeout(timer)
  }, [copiedId])

  const selectConversation = (conversationId: string, latestEntryId: string) => {
    setActiveConversationId(conversationId)
    setMobileDetailOpen(true)
    onSelect(conversationId, latestEntryId)
  }

  const copyEntry = async (entry: NotifyCenterEntry) => {
    if (!navigator.clipboard) return
    try {
      await navigator.clipboard.writeText(entry.payload.content || '')
      setCopiedId(entry.id)
    } catch {
      toast('复制消息失败，请检查剪贴板权限', 'error')
    }
  }

  const resetFilters = () => {
    setQuery('')
    setDateFilter('all')
    setTypeFilter('all')
  }

  return <section className={'history-page page-body' + (mobileDetailOpen ? ' mobile-detail-open' : '')}>
    <div className="page-tools">
      <label className="search-bar">
        <Search size={16} />
        <input aria-label="搜索历史通知" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索联系人、群聊或消息" />
        {query && <button type="button" className="icon-button" onClick={() => setQuery('')} aria-label="清除搜索" title="清除搜索"><X size={13} /></button>}
      </label>
      <div className="chip-row" role="group" aria-label="按消息类型筛选">
        {[{ value: 'all', label: '全部' }, { value: 'private', label: '私聊' }, { value: 'group', label: '群聊' }, { value: 'official', label: '公众号' }, { value: 'other', label: '其他' }].map((option) => (
          <button key={option.value} type="button" className={'chip' + (typeFilter === option.value ? ' active' : '')} aria-pressed={typeFilter === option.value} onClick={() => setTypeFilter(option.value)}>{option.label}</button>
        ))}
      </div>
      <label className={'history-date-field' + (dateFilter !== 'all' ? ' has-value' : '')}>
        <CalendarDays size={14} aria-hidden="true" />
        <input type="date" aria-label="选择日期" value={dateFilter === 'all' ? '' : dateFilter} onChange={(event) => setDateFilter(event.target.value || 'all')} />
        {dateFilter !== 'all' && <button type="button" onClick={() => setDateFilter('all')} aria-label="清除日期筛选" title="清除日期筛选"><X size={13} /></button>}
      </label>
      <span className="history-result-count" aria-live="polite">{conversations.length} 个会话 · {conversations.reduce((count, conversation) => count + conversation.entries.length, 0)} 条</span>
      <button className="md-button outlined danger-action" disabled={!entries.length} onClick={onRequestClear}><Trash2 size={14} />清空全部</button>
    </div>

    <div className="history-layout">
      <section className="surface conversation-list" aria-label="历史会话">
        {conversations.length ? conversations.map((conversation) => {
          const latest = conversation.latestEntry
          const preview = conversation.type === 'group'
            ? `${latest.payload.sourceName}：${latest.payload.content || '无文字内容'}`
            : latest.payload.content || '无文字内容'
          return <button key={conversation.id} className={activeConversation?.id === conversation.id ? 'selected' : ''} onClick={() => selectConversation(conversation.id, latest.id)} aria-current={activeConversation?.id === conversation.id ? 'true' : undefined}>
            <Avatar entry={latest} size={38} />
            <span className="conversation-copy"><b>{conversation.name}</b><small>{preview}</small></span>
            <span className="conversation-meta"><time>{formatTime(conversation.lastMessageAt)}</time>{conversation.unreadCount > 0 && <i aria-label={`${conversation.unreadCount} 条未读`}>{Math.min(conversation.unreadCount, 99)}</i>}</span>
          </button>
        }) : <div className="empty-state"><Search size={22} /><b>{entries.length ? '没有匹配的会话' : '暂无通知记录'}</b><span>{entries.length ? '调整搜索词或筛选条件后重试' : '收到微信消息后会显示在这里'}</span>{hasFilters && <button type="button" className="button" onClick={resetFilters}>重置筛选</button>}</div>}
      </section>

      <section className="surface conversation-detail" aria-label="会话历史详情">
        {activeConversation ? <>
          <header className="conversation-detail-head">
            <button className="icon-button conversation-back" onClick={() => setMobileDetailOpen(false)} aria-label="返回会话列表" title="返回会话列表"><ArrowLeft size={17} /></button>
            <Avatar entry={activeConversation.latestEntry} size={38} />
            <div><b>{activeConversation.name}</b><span>{TYPE_LABELS[activeConversation.type] || '其他'} · {activeConversation.entries.length} 条消息</span></div>
            {activeConversation.type === 'group' && <Users size={17} aria-label="群聊" />}
          </header>
          <div className="conversation-timeline">
            {timeline.map((entry, index) => {
              const time = historyMessageTime(entry)
              const showDay = index === 0 || messageDay(historyMessageTime(timeline[index - 1])) !== messageDay(time)
              return <Fragment key={entry.id}>
                {showDay && <div className="message-day"><span>{messageDay(time)}</span></div>}
                <article className={'history-message' + (!entry.read ? ' unread' : '')}>
                  <div className="history-message-head"><b>{activeConversation.type === 'group' ? entry.payload.sourceName : activeConversation.name}</b><time dateTime={new Date(time).toISOString()}>{messageClock(time)}</time></div>
                  <p>{entry.payload.content || '无文字内容'}</p>
                  <div className="history-message-actions">
                    <button className={'icon-button' + (copiedId === entry.id ? ' copied' : '')} onClick={() => void copyEntry(entry)} aria-label={copiedId === entry.id ? '已复制' : '复制消息'} title={copiedId === entry.id ? '已复制' : '复制消息'}>{copiedId === entry.id ? <Check size={14} /> : <Copy size={14} />}</button>
                    <button className="icon-button danger-icon" onClick={() => onRequestRemove(entry)} aria-label="删除这条消息" title="删除这条消息"><Trash2 size={14} /></button>
                  </div>
                </article>
              </Fragment>
            })}
          </div>
        </> : <div className="empty-state"><Inbox size={22} /><span>选择一个会话查看历史消息</span></div>}
      </section>
    </div>
  </section>
}
