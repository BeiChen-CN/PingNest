import { useCallback, useEffect, useRef, useState } from 'react'
import { NotificationToast, type NotificationData } from '../components/NotificationToast'
import type { NotificationStyle } from '../../shared/notificationMetrics'
import '../components/NotificationToast.scss'
import './NotificationWindow.scss'

interface RawNotificationData {
  sessionId: string
  sessionType?: string
  title: string
  content: string | null
  avatarUrl?: string
  timestamp: number
  event?: 'message.new' | 'message.revoke'
  position?: string
  notificationStyle?: NotificationStyle
  accentColor?: string
  durationMs?: number
  mergeWindowMs?: number
  opacity?: number
  showSummary?: boolean
  clickBehavior?: 'open-app' | 'open-wechat' | 'none'
  soundEnabled?: boolean
  sound?: string
  /** 同屏堆叠上限（主进程随每条通知下发） */
  queueSize?: number
  /** 卡片整体缩放系数（设置“卡片大小”） */
  sizeScale?: number
}

const NOTIFICATION_EXIT_MS = 260
const MIN_CARD_MS = 1000
const STACK_GAP_PX = 10

interface QueueCard {
  data: NotificationData
  exiting: boolean
}

/**
 * 通知堆叠队列窗口：
 * - 同屏最多 queueSize 张卡片（配置 notificationQueueSize，1 = 单卡替换的旧行为）
 * - 同会话合并（mergeWindowMs 内连发折叠进已有卡片 + 计数），合并卡片移到最靠角落的位置
 * - 超出上限时最旧的卡片播放退场动画后移除；全部卡片退场后自动隐藏窗口
 * - 测量内容高度并通过 IPC 调整窗口尺寸
 */

/** 同会话合并窗口内的消息折叠进当前卡片；不在窗口内返回 null（开新卡）。 */
export function mergeNotification(
  current: NotificationData,
  data: RawNotificationData,
  mergeWindowMs: number,
  nowMs: number
): NotificationData | null {
  if (current.sessionId !== data.sessionId) return null
  const elapsedMs = nowMs - (current.receivedAtMs || current.timestamp * 1000)
  if (elapsedMs >= mergeWindowMs) return null
  return {
    ...current,
    content: data.content ?? current.content,
    timestamp: Math.floor(nowMs / 1000),
    receivedAtMs: nowMs,
    mergeCount: (current.mergeCount || 1) + 1,
    opacity: data.opacity,
    showSummary: data.showSummary,
    clickBehavior: data.clickBehavior,
    soundEnabled: data.soundEnabled,
    sound: data.sound,
    notificationStyle: data.notificationStyle
  }
}

export default function NotificationWindow() {
  const [cards, setCards] = useState<QueueCard[]>([])
  const [position, setPosition] = useState('top-right')
  const cardsRef = useRef<QueueCard[]>([])
  const timersRef = useRef(new Map<string, ReturnType<typeof setTimeout>>())
  const queueSizeRef = useRef(3)
  const mergeWindowMsRef = useRef(3500)

  const clearTimer = (key: string) => {
    const timer = timersRef.current.get(key)
    if (timer) {
      clearTimeout(timer)
      timersRef.current.delete(key)
    }
  }

  const setTimer = (key: string, fn: () => void, delayMs: number) => {
    clearTimer(key)
    timersRef.current.set(key, setTimeout(() => {
      timersRef.current.delete(key)
      fn()
    }, delayMs))
  }

  const clearAllTimers = () => {
    for (const timer of timersRef.current.values()) clearTimeout(timer)
    timersRef.current.clear()
  }

  /** 所有卡片状态变更都经过这里，保证 cardsRef 与渲染状态同步（供 IPC 事件回读最新队列） */
  const applyCards = useCallback((updater: (prev: QueueCard[]) => QueueCard[]) => {
    cardsRef.current = updater(cardsRef.current)
    setCards(cardsRef.current)
  }, [])

  const prefersReducedMotion = () =>
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true

  const closeWindow = useCallback(() => {
    void window.electronAPI?.notification?.close()
  }, [])

  /** 卡片进入退场动画；移除后若队列已空则隐藏窗口 */
  const removeCard = useCallback((id: string, afterRemove?: () => void) => {
    clearTimer('close:' + id)
    applyCards(cs => cs.map(card => card.data.id === id ? { ...card, exiting: true } : card))
    setTimer('remove:' + id, () => {
      applyCards(cs => cs.filter(card => card.data.id !== id))
      afterRemove?.()
      if (!cardsRef.current.some(card => !card.exiting)) closeWindow()
    }, prefersReducedMotion() ? 0 : NOTIFICATION_EXIT_MS)
  }, [applyCards, closeWindow])

  const scheduleClose = useCallback((id: string, durationMs: number) => {
    setTimer('close:' + id, () => removeCard(id), Math.max(MIN_CARD_MS, durationMs))
  }, [removeCard])

  const handleShow = useCallback((data: RawNotificationData) => {
    const nowMs = Date.now()
    queueSizeRef.current = Math.max(1, Math.min(6, Math.floor(Number(data.queueSize) || 3)))
    mergeWindowMsRef.current = Math.max(0, Number(data.mergeWindowMs ?? 3500))
    if (data.position) setPosition(data.position)

    const durationMs = data.durationMs || 5000
    const active = cardsRef.current.filter(card => !card.exiting)

    // 同会话合并：折叠进已有卡片并移到最靠角落的位置
    const current = active.find(card => card.data.sessionId === data.sessionId)
    if (current) {
      const merged = mergeNotification(current.data, data, mergeWindowMsRef.current, nowMs)
      if (merged) {
        applyCards(cs => [{ ...current, data: merged }, ...cs.filter(card => card.data.id !== current.data.id)])
        scheduleClose(current.data.id, durationMs)
        return
      }
    }

    const newNoti: NotificationData = {
      id: 'noti_' + nowMs + '_' + Math.random().toString(36).slice(2, 11),
      sessionId: data.sessionId,
      sessionType: data.sessionType,
      title: data.title,
      content: data.content,
      timestamp: Math.floor(nowMs / 1000),
      avatarUrl: data.avatarUrl,
      event: data.event,
      position: data.position,
      notificationStyle: data.notificationStyle,
      accentColor: data.accentColor,
      durationMs,
      mergeCount: 1,
      opacity: data.opacity,
      showSummary: data.showSummary,
      clickBehavior: data.clickBehavior,
      soundEnabled: data.soundEnabled,
      sound: data.sound,
      receivedAtMs: nowMs,
      sizeScale: data.sizeScale
    }

    // 新卡插入队首；超出同屏上限时最旧的活跃卡片退场
    const keepCount = Math.max(0, queueSizeRef.current - 1)
    const evictIds = new Set(active.slice(keepCount).map(card => card.data.id))
    applyCards(cs => [
      { data: newNoti, exiting: false },
      ...cs.map(card => evictIds.has(card.data.id) ? { ...card, exiting: true } : card)
    ])
    for (const id of evictIds) {
      clearTimer('close:' + id)
      setTimer('remove:' + id, () => {
        applyCards(cs => cs.filter(card => card.data.id !== id))
        if (!cardsRef.current.some(card => !card.exiting)) closeWindow()
      }, prefersReducedMotion() ? 0 : NOTIFICATION_EXIT_MS)
    }
    scheduleClose(newNoti.id, durationMs)
  }, [applyCards, scheduleClose])

  useEffect(() => {
    const remove = window.electronAPI?.notification?.onShow?.(handleShow)
    window.electronAPI?.notification?.ready?.()
    return () => {
      remove?.()
      clearAllTimers()
    }
  }, [handleShow])

  const handleClose = useCallback((id: string) => {
    removeCard(id)
  }, [removeCard])

  const handleClick = useCallback((card: QueueCard) => {
    if (card.data.clickBehavior === 'none') return
    // 与旧行为一致：导航在退场动画结束后触发
    removeCard(card.data.id, () => {
      window.electronAPI?.notification?.click(card.data.sessionId)
    })
  }, [removeCard])

  // 测量并上报尺寸（含堆叠间距与卡片 zoom）。
  // 用 getBoundingClientRect：zoom 缩放后 offsetHeight 不反映视觉尺寸。
  useEffect(() => {
    if (!cards.length) return
    const timer = setTimeout(() => {
      const root = document.getElementById('notification-root')
      if (root) {
        const rect = root.getBoundingClientRect()
        window.electronAPI?.notification?.resize(Math.ceil(rect.width), Math.ceil(rect.height) + 4)
      }
    }, 60)
    return () => clearTimeout(timer)
  }, [cards, position])

  if (!cards.length) return null

  const style: NotificationStyle = cards.find(card => !card.exiting)?.data.notificationStyle || cards[0].data.notificationStyle || 'capsule'
  // 蜂巢：卡片横向拼成蜂窝；其余样式纵向堆叠
  const isHex = style === 'hex'
  // 底部位置：数组末尾（最新）离角落最近，展示时反转
  const ordered = position.startsWith('bottom') ? [...cards].reverse() : cards

  return (
    <div
      id="notification-root"
      style={{
        width: '100vw',
        height: 'auto',
        minHeight: '10px',
        background: 'transparent',
        position: 'relative',
        overflow: 'hidden',
        padding: '6px',
        boxSizing: 'border-box',
        display: 'flex',
        flexDirection: isHex ? 'row' : 'column',
        alignItems: isHex ? 'center' : 'stretch',
        justifyContent: isHex ? 'center' : 'flex-start',
        gap: STACK_GAP_PX
      }}
    >
      {ordered.map(card => (
        <div
          key={card.data.id}
          className={
            `notification-card ` +
            (card.exiting ? 'is-exiting' : 'is-active') +
            ` notification-position-${position}` +
            ` notification-style-${card.data.notificationStyle || 'capsule'}`
          }
          style={{ position: 'relative', width: isHex ? 116 : '100%' }}
        >
          <NotificationToast
            key={card.data.id}
            data={card.data}
            onClose={() => handleClose(card.data.id)}
            onClick={() => handleClick(card)}
            position={position}
            isStatic
          />
        </div>
      ))}
    </div>
  )
}
