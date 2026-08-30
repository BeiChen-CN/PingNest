import React, { useEffect, useRef, useState } from 'react'
import { X, Undo2, Image as ImageIcon, Mic, Video, Smile } from 'lucide-react'
import { MESSAGE_PLACEHOLDER } from '../../shared/messageContent'
import type { NotificationStyle } from '../../shared/notificationMetrics'
import './NotificationToast.scss'

export interface NotificationData {
  id: string
  sessionId: string
  sessionType?: string
  groupName?: string
  avatarUrl?: string
  title: string
  content: string | null
  timestamp: number
  event?: 'message.new' | 'message.revoke'
  position?: string
  notificationStyle?: NotificationStyle
  accentColor?: string
  durationMs?: number
  mergeCount?: number
  opacity?: number
  showSummary?: boolean
  clickBehavior?: 'open-app' | 'open-wechat' | 'none'
  soundEnabled?: boolean
  sound?: string
  receivedAtMs?: number
  /** 卡片整体缩放系数（来自设置“卡片大小”：large 1.15 / medium 1 / small 0.85） */
  sizeScale?: number
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
  if (c.includes(MESSAGE_PLACEHOLDER.image)) return <ImageIcon size={13} className="nt-type-icon" />
  if (c.includes(MESSAGE_PLACEHOLDER.voice)) return <Mic size={13} className="nt-type-icon" />
  if (c.includes(MESSAGE_PLACEHOLDER.video)) return <Video size={13} className="nt-type-icon" />
  if (c.includes(MESSAGE_PLACEHOLDER.emoticon)) return <Smile size={13} className="nt-type-icon" />
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

function formatTime(timestamp: number): string {
  return new Date(timestamp * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
}

/** 会话 ID → 稳定色相（蜂巢每格一色） */
function sessionHue(sessionId: string): number {
  let hash = 0
  for (let i = 0; i < sessionId.length; i++) hash = (hash * 31 + sessionId.charCodeAt(i)) % 360
  return hash
}

function mailNote(sessionType: string | undefined): string {
  if (sessionType === 'group') return '群启'
  if (sessionType === 'official') return '公告'
  return '亲启'
}

/** 单条通知的九套风格视图。视觉与动效基准：public/notification-styles-2026.html。 */
export function NotificationToast({
  data,
  onClose,
  onClick,
  isStatic = false,
  suppressEffects = false,
  position = 'top-right'
}: NotificationToastProps) {
  const playedRef = useRef<string | null>(null)
  useEffect(() => {
    if (suppressEffects) return
    const playKey = data.id + ':' + (data.receivedAtMs || data.timestamp) + ':' + (data.sound || 'ding')
    if (playedRef.current === playKey) return
    playedRef.current = playKey
    playNotificationSound(data.sound, data.soundEnabled)
  }, [data.id, data.receivedAtMs, data.timestamp, data.sound, data.soundEnabled, suppressEffects])

  const style: NotificationStyle = data.notificationStyle || 'capsule'
  // 卡片大小（大/中/小）：以 CSS zoom 整体缩放，设计比例与动效原样保留
  const sizeZoom = Math.max(0.7, Math.min(1.3, Number(data.sizeScale) || 1))
  const isRevoke = data.event === 'message.revoke'
  const isClickable = data.clickBehavior !== 'none'
  const isMerged = (data.mergeCount || 1) > 1
  const accentColor = /^#[0-9a-f]{6}$/i.test(data.accentColor || '') ? data.accentColor : '#5f8a4c'
  const progressKey = `${data.id}-${data.receivedAtMs || data.timestamp}`
  const timeText = formatTime(data.timestamp)
  const group = data.groupName
  const content = data.showSummary === false ? null : (data.content ?? null)
  const mergeCount = data.mergeCount || 1

  // halo：真实倒计时驱动圆环（--p 100→0），临 1/4 转警示色
  const ringRef = useRef<HTMLDivElement | null>(null)
  const [haloRemainSec, setHaloRemainSec] = useState(Math.max(1, Math.round((data.durationMs ?? 5000) / 1000)))
  const [haloUrgent, setHaloUrgent] = useState(false)
  useEffect(() => {
    if (style !== 'halo') return
    if (isStatic || suppressEffects) {
      ringRef.current?.style.setProperty('--p', '78')
      return
    }
    const total = Math.max(1000, Number(data.durationMs ?? 5000))
    const start = data.receivedAtMs ?? Date.now()
    const tick = () => {
      const remaining = Math.max(0, 1 - (Date.now() - start) / total)
      ringRef.current?.style.setProperty('--p', String(Math.round(remaining * 100)))
      setHaloRemainSec(Math.max(1, Math.ceil(remaining * total / 1000)))
      setHaloUrgent(remaining <= 0.25)
    }
    tick()
    const id = setInterval(tick, 200)
    return () => clearInterval(id)
  }, [style, isStatic, suppressEffects, data.durationMs, data.receivedAtMs])

  const handleClose = (e: React.MouseEvent) => {
    e.stopPropagation()
    onClose()
  }

  const avatar = <Avatar src={data.avatarUrl} name={data.title} size={40} />

  let body: React.ReactNode = null
  if (style === 'tidal') {
    body = (
      <div className="ns ns-tidal">
        <span className="td-drift" aria-hidden="true" />
        <span className="td-edge" aria-hidden="true" />
        <div className="nt-avatar">{avatar}</div>
        <div className="td-body">
          <div className="td-r1">
            <span className="td-name">{data.title}</span>
            {group && <span className="td-grp">{group}</span>}
            <span className="td-time">{timeText}</span>
          </div>
          {content !== null && <div className="td-content"><MessageTypeIcon content={content} />{content}</div>}
        </div>
        {isMerged && <span className="nt-badge">{mergeCount}</span>}
      </div>
    )
  } else if (style === 'terminal') {
    body = (
      <div className="ns ns-term">
        <div className="tm-bar" aria-hidden="true"><i /><i /><i /></div>
        <div className="tm-ln">
          <span className="tm-ts">{timeText}</span>
          <span className="tm-who">{data.title}</span>
          <span className="tm-msg">{content ?? '—'}</span>
          <span className="tm-cursor" aria-hidden="true" />
        </div>
      </div>
    )
  } else if (style === 'mail') {
    body = (
      <div className="ns ns-mail">
        <span className="ml-stamp" aria-hidden="true">PINGNEST<br />{timeText}<br />· 今日 ·</span>
        <div className="ml-head">
          <div className="nt-avatar"><Avatar src={data.avatarUrl} name={data.title} size={30} /></div>
          <span className="ml-name">{data.title}</span>
          <span className="ml-note">· {mailNote(data.sessionType)} ·</span>
        </div>
        {content !== null && <div className="ml-body">{content}</div>}
        <div className="ml-foot">DELIVERED BY PINGNEST</div>
        {isRevoke && <span className="ml-seal" aria-hidden="true">已 撤 回</span>}
      </div>
    )
  } else if (style === 'neon') {
    body = (
      <div className="ns ns-neon">
        <div className="nt-avatar">{avatar}</div>
        <div className="ns-body">
          <div className="ns-r1">
            <span className="ns-name">{data.title}</span>
            {group && <span className="ns-grp">{group}</span>}
            <span className="ns-time">{timeText}</span>
          </div>
          {content !== null && <div className="ns-content"><MessageTypeIcon content={content} />{content}</div>}
        </div>
        {isMerged && <span className="nt-badge">{mergeCount}</span>}
      </div>
    )
  } else if (style === 'wave') {
    body = (
      <div className="ns ns-wave">
        <div className="wv-eq" aria-hidden="true"><i /><i /><i /><i /><i /><i /></div>
        <div className="ns-body">
          <div className="ns-r1">
            <span className="ns-name">{data.title}</span>
            {group && <span className="ns-grp">{group}</span>}
            <span className="ns-time">{timeText}</span>
          </div>
          {content !== null && <div className="ns-content"><MessageTypeIcon content={content} />{content}</div>}
          <div className="wv-lvl">{isRevoke ? 'SIGNAL · REVOKED' : `SIGNAL · ${mergeCount} MSG${mergeCount > 1 ? 'S' : ''} · ${mergeCount > 1 ? 'STRONG' : 'CALM'}`}</div>
        </div>
        {isMerged && <span className="nt-badge">{mergeCount}</span>}
      </div>
    )
  } else if (style === 'hex') {
    body = (
      <div className="ns ns-hex" style={{ '--c': `hsl(${sessionHue(data.sessionId)} 45% 36%)` } as React.CSSProperties}>
        {isMerged && <span className="hx-count">{mergeCount}</span>}
        <div className="nt-avatar hx-av"><Avatar src={data.avatarUrl} name={data.title} size={34} /></div>
        <span className="hx-name">{data.title}</span>
        {content !== null && <span className="hx-content">{content}</span>}
      </div>
    )
  } else if (style === 'scroll') {
    body = (
      <div className="ns ns-scroll">
        <div className="sc-head">
          <span>PINGNEST · 接收流水</span>
          <span>NO.{String(data.timestamp % 10000).padStart(4, '0')}</span>
        </div>
        <div className={'sc-item' + (isRevoke ? '' : ' hot')}>
          <span className="sc-t">{timeText}</span>
          <span className="sc-who">{data.title}</span>
          <span className="sc-c">{content ?? '—'}</span>
        </div>
      </div>
    )
  } else if (style === 'halo') {
    body = (
      <div className={'ns ns-halo' + (haloUrgent ? ' urgent' : '')}>
        <div className="hl-ring" ref={ringRef}>
          <div className="nt-avatar">{avatar}</div>
        </div>
        <div className="ns-body">
          <div className="ns-r1">
            <span className="ns-name">{data.title}</span>
            {group && <span className="ns-grp">{group}</span>}
            <span className="ns-time">{timeText}</span>
          </div>
          {content !== null && <div className="ns-content">{isRevoke && <Undo2 size={13} className="nt-revoke-icon" />}{content}</div>}
          <div className="hl-ttl">
            <i aria-hidden="true" />
            {haloUrgent ? '即将消失' : `剩余 ${haloRemainSec} 秒 · 点击直达会话`}
          </div>
        </div>
      </div>
    )
  } else {
    body = (
      <div className="ns ns-capsule">
        <div className="nt-avatar">{avatar}</div>
        <div className="ns-body">
          <div className="ns-r1">
            <span className="ns-name">{data.title}</span>
            {group && <span className="ns-grp">{group}</span>}
            <span className="ns-time">{timeText}</span>
          </div>
          {content !== null && <div className="ns-content"><MessageTypeIcon content={content} />{content}</div>}
        </div>
        {isMerged && <span className="nt-badge">{mergeCount}</span>}
        <span className="ns-live" aria-hidden="true"><i /><i /><i /></span>
      </div>
    )
  }

  return (
    <div
      className={
        'notification-toast-container ' +
        position +
        (isStatic ? ' static' : '') +
        (position === 'static' ? ' preview' : '') +
        ` style-${style}` +
        (isClickable ? ' clickable' : ' non-clickable') +
        (isRevoke ? ' revoke' : '') +
        (isMerged ? ' merged' : '')
      }
      style={{
        '--nt-accent': accentColor,
        '--nt-hue': String(sessionHue(data.sessionId)),
        '--nt-duration': `${Math.max(1000, Number(data.durationMs ?? 5000))}ms`,
        '--nt-opacity': Math.max(0.7, Math.min(1, Number(data.opacity ?? 100) / 100)),
        zoom: sizeZoom
      } as React.CSSProperties}
      role="status"
      aria-live="polite"
    >
      <button
        className="nt-open"
        onClick={() => { if (isClickable) onClick(data.sessionId) }}
        disabled={!isClickable}
        aria-label={isClickable ? `打开 ${data.title} 的通知` : `${data.title} 的通知`}
      >
        {body}
      </button>
      <button className="nt-close" onClick={handleClose} aria-label="关闭通知" title="关闭通知"><X size={13} /></button>
      {style !== 'halo' && !suppressEffects && <span key={progressKey} className="nt-timebar" aria-hidden="true" />}
    </div>
  )
}

export default NotificationToast
