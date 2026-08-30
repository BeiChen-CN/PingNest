import { Fragment, useDeferredValue, useEffect, useMemo, useState } from 'react'
import { ArrowLeft, Check, Copy, Search, Trash2, X } from 'lucide-react'
import { Avatar, formatTime } from '../components/Avatar'
import { groupHistoryEntries, historyConversationId, historyMessageTime, normalizeHistorySessionType } from '../historyGrouping'
import { toast } from '../stores/toastStore'
import type { NotifyCenterEntry } from '../types'

interface Props {
  entries: NotifyCenterEntry[]
  selectedId: string | null
  onSelect: (sessionId: string, latestEntryId: string) => void
  onRequestRemove: (entry: NotifyCenterEntry) => void
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

export function HistoryPage({ entries, selectedId, onSelect, onRequestRemove }: Props) {
  const [query, setQuery] = useState('')
  const deferredQuery = useDeferredValue(query)
  const [typeFilter, setTypeFilter] = useState('all')
  const [copiedId, setCopiedId] = useState<string | null>(null)

  const selectedEntry = useMemo(() => entries.find((entry) => entry.id === selectedId), [entries, selectedId])
  const [activeConversationId, setActiveConversationId] = useState<string | null>(() => selectedEntry ? historyConversationId(selectedEntry) : null)
  const [mobileDetailOpen, setMobileDetailOpen] = useState(Boolean(selectedId))

  const filtered = useMemo(() => entries.filter((entry) => typeFilter === 'all' || normalizeHistorySessionType(entry) === typeFilter), [entries, typeFilter])
  const conversations = useMemo(() => {
    const normalized = deferredQuery.trim().toLowerCase()
    return groupHistoryEntries(filtered).filter((conversation) => {
      if (!normalized) return true
      return conversation.entries.some((entry) => `${conversation.name} ${entry.payload.sourceName} ${entry.payload.content || ''}`.toLowerCase().includes(normalized))
    })
  }, [filtered, deferredQuery])
  const activeConversation = conversations.find((conversation) => conversation.id === activeConversationId) || conversations[0] || null
  const timeline = useMemo(() => activeConversation ? [...activeConversation.entries].reverse() : [], [activeConversation])
  const [visibleCount, setVisibleCount] = useState(200)
  useEffect(() => { setVisibleCount(200) }, [activeConversationId])
  const visibleOffset = Math.max(0, timeline.length - visibleCount)
  const visibleTimeline = useMemo(() => timeline.slice(visibleOffset), [timeline, visibleOffset])
  const hiddenCount = timeline.length - visibleTimeline.length

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

  return <section className={'history-page' + (mobileDetailOpen ? ' mobile-detail-open' : '')}>
    <div className="hist-tools card">
      <label className="searchbar">
        <Search size={15} />
        <input aria-label="搜索历史通知" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索联系人、群聊或消息" />
        {query && <button type="button" className="icon-button" onClick={() => setQuery('')} aria-label="清除搜索" title="清除搜索"><X size={13} /></button>}
      </label>
      <div className="segf" role="group" aria-label="按消息类型筛选">
        {[{ v: 'all', l: '全部' }, { v: 'private', l: '私聊' }, { v: 'group', l: '群聊' }, { v: 'official', l: '公众号' }, { v: 'other', l: '其他' }].map((option) => (
          <button key={option.v} type="button" className={typeFilter === option.v ? 'on' : ''} onClick={() => setTypeFilter(option.v)}>{option.l}</button>
        ))}
      </div>
      <span className="hist-count">{conversations.length} 个会话 · {conversations.reduce((count, conversation) => count + conversation.entries.length, 0)} 条</span>
    </div>

    <div className="hist-layout">
      <section className="card hist-list" aria-label="历史会话">
        {conversations.length ? conversations.map((conversation) => {
          const latest = conversation.latestEntry
          const preview = conversation.type === 'group'
            ? `${latest.payload.sourceName}：${latest.payload.content || '无文字内容'}`
            : latest.payload.content || '无文字内容'
          return <button key={conversation.id} className={'hrow' + (activeConversation?.id === conversation.id ? ' on' : '')}
            onClick={() => selectConversation(conversation.id, latest.id)}>
            <Avatar entry={latest} size={36} />
            <div className="hm">
              <div className="h1"><span className="hn">{conversation.name}</span><span className="ht">{formatTime(conversation.lastMessageAt)}</span></div>
              <div className="h2">{preview}</div>
            </div>
            {conversation.unreadCount > 0 && <span className="chip">{conversation.unreadCount}</span>}
          </button>
        }) : <div className="empty-state"><Search size={20} /><b>{entries.length ? '没有匹配的会话' : '暂无通知记录'}</b><span>{entries.length ? '调整搜索词或筛选条件后重试' : '收到微信消息后会显示在这里'}</span></div>}
      </section>

      <section className="card hist-detail" aria-label="会话历史详情">
        {activeConversation ? <>
          <header className="hist-detail-head">
            <button className="icon-button hist-back" onClick={() => setMobileDetailOpen(false)} aria-label="返回会话列表" title="返回会话列表"><ArrowLeft size={16} /></button>
            <Avatar entry={activeConversation.latestEntry} size={34} />
            <div><b>{activeConversation.name}</b><span>{TYPE_LABELS[activeConversation.type] || '其他'} · {activeConversation.entries.length} 条消息</span></div>
          </header>
          <div className="hist-timeline">
            {hiddenCount > 0 && (
              <button type="button" className="md-button outlined timeline-load-earlier" onClick={() => setVisibleCount((count) => count + 200)}>
                加载更早的消息（还有 {hiddenCount} 条）
              </button>
            )}
            {visibleTimeline.map((entry, index) => {
              const time = historyMessageTime(entry)
              const previousEntry = visibleOffset + index > 0 ? timeline[visibleOffset + index - 1] : undefined
              const previousTime = previousEntry ? historyMessageTime(previousEntry) : 0
              const showDay = index === 0 || messageDay(previousTime) !== messageDay(time)
              return <Fragment key={entry.id}>
                {showDay && <div className="message-day"><span>{messageDay(time)}</span></div>}
                <article className={'hist-message' + (!entry.read ? ' unread' : '')}>
                  <div className="hm-head"><b>{activeConversation.type === 'group' ? entry.payload.sourceName : activeConversation.name}</b><time>{messageClock(time)}</time></div>
                  <p>{entry.payload.content || '无文字内容'}</p>
                  <div className="hm-acts">
                    <button className={'icon-button' + (copiedId === entry.id ? ' copied' : '')} onClick={() => void copyEntry(entry)} aria-label={copiedId === entry.id ? '已复制' : '复制消息'} title={copiedId === entry.id ? '已复制' : '复制消息'}>{copiedId === entry.id ? <Check size={13} /> : <Copy size={13} />}</button>
                    <button className="icon-button danger" onClick={() => onRequestRemove(entry)} aria-label="删除这条消息" title="删除这条消息"><Trash2 size={13} /></button>
                  </div>
                </article>
              </Fragment>
            })}
          </div>
        </> : <div className="empty-state"><Search size={20} /><span>选择一个会话查看历史消息</span></div>}
      </section>
    </div>
  </section>
}
