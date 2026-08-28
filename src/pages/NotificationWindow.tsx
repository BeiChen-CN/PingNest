import { useEffect, useRef, useState } from 'react'
import { NotificationToast, type NotificationData } from '../components/NotificationToast'
import { calculateNotificationMaxHeight, calculateNotificationWidth, type NotificationStyle } from '../../shared/notificationMetrics'
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
}

const NOTIFICATION_EXIT_MS = 260

type TimerKind = 'close' | 'hide' | 'click'

/**
 * 通知弹窗窗口：
 * - 支持同会话合并（mergeWindowMs 内连发折叠为一张卡片 + 计数）
 * - 自动关闭（durationMs）
 * - 旧卡片淡出动画
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
  const [notification, setNotification] = useState<NotificationData | null>(null)
  const [prevNotification, setPrevNotification] = useState<NotificationData | null>(null)
  const [position, setPosition] = useState('top-right')
  const notificationRef = useRef<NotificationData | null>(null)
  const timersRef = useRef<Record<TimerKind, ReturnType<typeof setTimeout> | null>>({ close: null, hide: null, click: null })
  const mergeWindowMsRef = useRef(3500)

  useEffect(() => {
    notificationRef.current = notification
  }, [notification])

  const clearTimer = (kind: TimerKind) => {
    if (timersRef.current[kind]) {
      clearTimeout(timersRef.current[kind])
      timersRef.current[kind] = null
    }
  }

  const clearAllTimers = () => {
    for (const kind of ['close', 'hide', 'click'] as TimerKind[]) clearTimer(kind)
  }

  const setTimer = (kind: TimerKind, fn: () => void, delayMs: number) => {
    clearTimer(kind)
    timersRef.current[kind] = setTimeout(() => {
      timersRef.current[kind] = null
      fn()
    }, delayMs)
  }

  /** 当前卡片播放退场动画后关闭窗口 */
  const dismissWithAnimation = (onExited: () => void) => {
    clearAllTimers()
    const current = notificationRef.current
    if (current) setPrevNotification(current)
    notificationRef.current = null
    setNotification(null)
    const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
    setTimer('hide', onExited, reduceMotion ? 0 : NOTIFICATION_EXIT_MS)
  }

  const scheduleClose = (durationMs: number) => {
    setTimer('close', () => dismissWithAnimation(closeWindow), durationMs)
  }

  const handleShow = (data: RawNotificationData) => {
    const nowMs = Date.now()
    const durationMs = data.durationMs || 5000
    mergeWindowMsRef.current = Math.max(0, Number(data.mergeWindowMs ?? 3500))
    clearTimer('hide')
    clearTimer('click')

    if (data.position) setPosition(data.position)

    // 同会话合并：当前卡片还在显示且时间在合并窗口内
    const current = notificationRef.current
    if (current) {
      const merged = mergeNotification(current, data, mergeWindowMsRef.current, nowMs)
      if (merged) {
        notificationRef.current = merged
        setNotification(merged)
        scheduleClose(durationMs)
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
      receivedAtMs: nowMs
    }

    if (notificationRef.current) {
      setPrevNotification(notificationRef.current)
    }
    notificationRef.current = newNoti
    setNotification(newNoti)
    scheduleClose(durationMs)
  }

  useEffect(() => {
    const remove = window.electronAPI?.notification?.onShow?.(handleShow)
    window.electronAPI?.notification?.ready?.()
    return () => {
      remove?.()
      clearAllTimers()
    }
  }, [])

  // 清理 prevNotification
  useEffect(() => {
    if (prevNotification) {
      const timer = setTimeout(() => setPrevNotification(null), NOTIFICATION_EXIT_MS)
      return () => clearTimeout(timer)
    }
  }, [prevNotification])

  const handleClose = () => {
    dismissWithAnimation(closeWindow)
  }

  const handleClick = (sessionId: string) => {
    if (notificationRef.current?.clickBehavior === 'none') return
    const current = notificationRef.current
    if (!current) return
    dismissWithAnimation(() => {
      window.electronAPI?.notification?.click(sessionId)
    })
  }

  // 测量并上报尺寸
  useEffect(() => {
    if (!notification && !prevNotification) return
    const timer = setTimeout(() => {
      const root = document.getElementById('notification-root')
      if (root) {
        const height = root.offsetHeight
        const style: NotificationStyle = notification?.notificationStyle || prevNotification?.notificationStyle || 'standard'
        const width = calculateNotificationWidth(position === 'top-center' ? 'top-center' : 'top-right', style)
        const maxHeight = calculateNotificationMaxHeight(style)
        window.electronAPI?.notification?.resize(width, Math.min(height + 4, maxHeight))
      }
    }, 60)
    return () => clearTimeout(timer)
  }, [notification, prevNotification, position])

  if (!notification && !prevNotification) return null

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
        padding: '2px',
        boxSizing: 'border-box'
      }}
    >
      {prevNotification && (
        <div
          id="notification-prev"
          key={prevNotification.id}
          className={`notification-position-${position} notification-style-${prevNotification.notificationStyle || 'standard'}`}
          style={{
            position: 'absolute',
            top: 2,
            left: 2,
            width: 'calc(100% - 4px)',
            zIndex: 1,
            pointerEvents: 'none'
          }}
        >
          <NotificationToast
            data={prevNotification}
            onClose={() => { }}
            onClick={() => { }}
            position={position}
            isStatic
            suppressEffects
          />
        </div>
      )}

      {notification && (
        <div
          id="notification-current"
          key={notification.id}
          className={`notification-position-${position} notification-style-${notification.notificationStyle || 'standard'}`}
          style={{
            position: 'relative',
            zIndex: 2,
            width: '100%'
          }}
        >
          <NotificationToast
            key={notification.id}
            data={notification}
            onClose={handleClose}
            onClick={handleClick}
            position={position}
            isStatic
          />
        </div>
      )}
    </div>
  )
}

function closeWindow(): void {
  void window.electronAPI?.notification?.close()
}
