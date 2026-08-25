import React from 'react'
import { X, Undo2, Image as ImageIcon, Mic, Video, Smile } from 'lucide-react'
import './NotificationToast.scss'

export interface NotificationData {
  id: string
  sessionId: string
  sessionType?: string
  avatarUrl?: string
  title: string
  content: string | null
  timestamp: number
  event?: 'message.new' | 'message.revoke'
  position?: string
  notificationStyle?: 'standard' | 'compact' | 'layered' | 'minimal'
  accentColor?: string
  durationMs?: number
  mergeCount?: number
  opacity?: number
  showSummary?: boolean
  clickBehavior?: 'open-app' | 'none'
  soundEnabled?: boolean
  sound?: string
  receivedAtMs?: number
}

interface NotificationToastProps {
  data: NotificationData
  onClose: () => void
  onClick: (sessionId: string) => void
  isStatic?: boolean
  suppressEffects?: boolean
  position?: string
}

function Avatar({ src, name, size = 40 }: { src?: string; name: string; size?: number }) {
  const [failed, setFailed] = React.useState(false)
  if (src && !failed) {
    return (
      <img
        className="nt-avatar-img"
        src={src}
        width={size}
        height={size}
        alt={name}
        onError={() => setFailed(true)}
      />
    )
  }
  const initial = (name || '?').trim().charAt(0).toUpperCase() || '?'
  return (
    <div className="nt-avatar-fallback" style={{ width: size, height: size, fontSize: size * 0.42 }}>
      {initial}
    </div>
  )
}

function MessageTypeIcon({ content }: { content: string | null }) {
  const c = String(content || '')
  if (c.includes('[图片]')) return <ImageIcon size={13} className="nt-type-icon" />
  if (c.includes('[语音]')) return <Mic size={13} className="nt-type-icon" />
  if (c.includes('[视频]')) return <Video size={13} className="nt-type-icon" />
  if (c.includes('[表情]')) return <Smile size={13} className="nt-type-icon" />
  return null
}

/** 播放内置合成提示音（Web Audio 合成，无外部资源） */
function playNotificationSound(sound: string | undefined, enabled: boolean | undefined): void {
  if (enabled === false) return
  const tone = sound || 'ding'
  try {
    const AudioCtor = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AudioCtor) return
    const ctx = new AudioCtor()
    const now = ctx.currentTime
    const playTone = (freq: number, start: number, dur: number, vol = 0.12) => {
      const osc = ctx.createOscillator()
      const gain = ctx.createGain()
      osc.type = 'sine'
      osc.frequency.value = freq
      gain.gain.setValueAtTime(0.0001, now + start)
      gain.gain.exponentialRampToValueAtTime(vol, now + start + 0.01)
      gain.gain.exponentialRampToValueAtTime(0.0001, now + start + dur)
      osc.connect(gain)
      gain.connect(ctx.destination)
      osc.start(now + start)
      osc.stop(now + start + dur + 0.02)
    }
    if (tone === 'chime') {
      playTone(660, 0, 0.18)
      playTone(880, 0.16, 0.18)
      playTone(1320, 0.32, 0.3)
    } else if (tone === 'pop') {
      playTone(440, 0, 0.1, 0.1)
      playTone(880, 0.08, 0.12, 0.08)
    } else {
      playTone(880, 0, 0.22)
    }
    setTimeout(() => { void ctx.close().catch(() => { }) }, 1200)
  } catch { /* 音频不可用时静默 */ }
}

export function NotificationToast({
  data,
  onClose,
  onClick,
  isStatic = false,
  suppressEffects = false,
  position = 'top-right'
}: NotificationToastProps) {
  const playedRef = React.useRef<string | null>(null)
  React.useEffect(() => {
    if (suppressEffects) return
    const playKey = data.id + ':' + (data.receivedAtMs || data.timestamp) + ':' + (data.sound || 'ding')
    if (playedRef.current === playKey) return
    playedRef.current = playKey
    playNotificationSound(data.sound, data.soundEnabled)
  }, [data.id, data.receivedAtMs, data.timestamp, data.sound, data.soundEnabled, suppressEffects])

  const isRevoke = data.event === 'message.revoke'
  const isClickable = data.clickBehavior !== 'none'
  const accentColor = /^#[0-9a-f]{6}$/i.test(data.accentColor || '') ? data.accentColor : '#20a866'
  const progressKey = `${data.id}-${data.receivedAtMs || data.timestamp}`
  const accessibleLabel = isRevoke
    ? `${data.title} 撤回了一条消息`
    : `${data.title} 的通知：${data.content || '无文字内容'}`
  const notificationStyle = ['compact', 'layered', 'minimal'].includes(data.notificationStyle || '')
    ? data.notificationStyle
    : 'standard'
  const sessionLabel = isRevoke
    ? '消息撤回'
    : data.sessionType === 'group'
      ? '群聊消息'
      : data.sessionType === 'official'
        ? '公众号消息'
        : '新消息'

  const handleClose = (e: React.MouseEvent) => {
    e.stopPropagation()
    onClose()
  }

  const handleClick = () => {
    if (!isClickable) return
    onClick(data.sessionId)
  }

  return (
    <div
      className={
        'notification-toast-container ' +
        position +
        (isStatic ? ' static' : '') +
        (position === 'static' ? ' preview' : '') +
        ` style-${notificationStyle}` +
        (isClickable ? ' clickable' : ' non-clickable') +
        (isRevoke ? ' revoke' : '')
      }
      style={{ '--nt-accent': accentColor, '--nt-duration': `${Math.max(1000, Number(data.durationMs ?? 5000))}ms`, '--nt-opacity': Math.max(0.7, Math.min(1, Number(data.opacity ?? 100) / 100)) } as React.CSSProperties}
      role="status"
      aria-live="polite"
    >
      <button className="notification-content notification-open" onClick={handleClick} disabled={!isClickable} aria-label={isClickable ? `打开 ${accessibleLabel}` : accessibleLabel}>
        <div className="notification-avatar">
          <Avatar src={data.avatarUrl} name={data.title} />
        </div>
        <div className="notification-text">
          <span className="notification-kicker">{sessionLabel}</span>
          <div className="notification-header">
            <span className="notification-title">{data.title}</span>
            <span className="notification-time">
              {new Date(data.timestamp * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
            </span>
          </div>
          {data.showSummary !== false && <div className="notification-body">
            {isRevoke && <Undo2 size={13} className="nt-revoke-icon" />}
            <MessageTypeIcon content={data.content} />
            {data.content || '无文字内容'}
          </div>}
          <div className="notification-footer">
            <span>{data.mergeCount && data.mergeCount > 1 ? `最近 ${data.mergeCount} 条` : isRevoke ? '已撤回' : '微信通知'}</span>
            {data.mergeCount && data.mergeCount > 1 ? <span className="nt-merge-badge">{data.mergeCount}</span> : null}
          </div>
        </div>
      </button>
      <button className="notification-close" onClick={handleClose} aria-label="关闭通知" title="关闭通知"><X size={14} /></button>
      {!suppressEffects && <span key={progressKey} className="notification-progress" aria-hidden="true" />}
    </div>
  )
}

export default NotificationToast
