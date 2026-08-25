import { useEffect, useMemo, useState } from 'react'
import {
  AlertCircle, Check, CheckCircle2, Database, LoaderCircle, LockKeyhole,
  Maximize2, Minus, RefreshCw, ShieldCheck, Unplug, X
} from 'lucide-react'
import type { HookProgress, HookStage } from '../features/dashboard/types'
import './HookPage.scss'

interface Props {
  initialWechatRunning: boolean
  onComplete: () => void
}

const STEP_STAGE: Record<'wechat' | 'hook' | 'verify', HookStage[]> = {
  wechat: ['waiting-wechat', 'hooking', 'verifying', 'success'],
  hook: ['hooking', 'verifying', 'success'],
  verify: ['verifying', 'success']
}

export default function HookPage({ initialWechatRunning, onComplete }: Props) {
  const [wechatRunning, setWechatRunning] = useState(initialWechatRunning)
  const [progress, setProgress] = useState<HookProgress>({ stage: 'idle', message: '等待连接' })
  const [busy, setBusy] = useState(false)
  const [checking, setChecking] = useState(false)

  useEffect(() => window.electronAPI?.app.onHookProgress(setProgress), [])

  useEffect(() => {
    if (!window.electronAPI || busy) return
    const updateWechatState = async () => {
      try {
        const status = await window.electronAPI?.app.getStatus()
        if (status) setWechatRunning(status.wechatRunning)
      } catch { }
    }
    const timer = window.setInterval(() => void updateWechatState(), 3000)
    return () => window.clearInterval(timer)
  }, [busy])

  const activeStep = useMemo(() => {
    if (STEP_STAGE.verify.includes(progress.stage)) return 'verify'
    if (STEP_STAGE.hook.includes(progress.stage)) return 'hook'
    return 'wechat'
  }, [progress.stage])

  const isStepDone = (step: keyof typeof STEP_STAGE) => {
    if (progress.stage === 'success') return true
    if (step === 'wechat') return ['hooking', 'verifying'].includes(progress.stage)
    if (step === 'hook') return progress.stage === 'verifying'
    return false
  }

  const refreshWechat = async () => {
    if (checking) return
    setChecking(true)
    try {
      if (!window.electronAPI) {
        setWechatRunning(true)
        return
      }
      const status = await window.electronAPI.app.getStatus()
      setWechatRunning(status.wechatRunning)
    } finally {
      setChecking(false)
    }
  }

  const runPreviewHook = async () => {
    const wait = (ms: number) => new Promise((resolve) => window.setTimeout(resolve, ms))
    for (const next of [
      { stage: 'detecting', message: '正在查找微信账号' },
      { stage: 'hooking', message: '正在连接微信' },
      { stage: 'verifying', message: '正在验证本地数据' },
      { stage: 'success', message: '微信连接成功' }
    ] as HookProgress[]) {
      setProgress(next)
      await wait(520)
    }
    onComplete()
  }

  const startHook = async () => {
    if (busy || !wechatRunning) return
    setBusy(true)
    setProgress({ stage: 'detecting', message: '正在查找微信账号' })
    try {
      if (!window.electronAPI) {
        await runPreviewHook()
        return
      }
      const result = await window.electronAPI.app.hook()
      if (!result.success) {
        setProgress({ stage: 'error', message: result.error || '连接未完成，请重试' })
        return
      }
      setProgress({ stage: 'success', message: '微信连接成功' })
      window.setTimeout(onComplete, 350)
    } catch (error) {
      setProgress({ stage: 'error', message: `连接失败：${String(error)}` })
    } finally {
      setBusy(false)
    }
  }

  return <div className="hook-shell">
    <header className="hook-titlebar">
      <div className="hook-brand"><img src="./icon.png" alt="" /><b>PingNest</b></div>
      <div className="hook-window-actions">
        <button onClick={() => window.electronAPI?.app.minimize()} aria-label="最小化" title="最小化"><Minus size={14} /></button>
        <button onClick={() => window.electronAPI?.app.toggleMaximize()} aria-label="最大化或还原" title="最大化或还原"><Maximize2 size={13} /></button>
        <button className="close" onClick={() => window.electronAPI?.app.closeWindow()} aria-label="退出应用" title="退出应用"><X size={14} /></button>
      </div>
    </header>

    <main className="hook-main">
      <section className="hook-intro" aria-labelledby="hook-title">
        <div className="hook-mark"><LockKeyhole size={26} /></div>
        <span className="hook-eyebrow">首次连接</span>
        <h1 id="hook-title">连接微信</h1>
        <p>连接微信后即可开始接收通知。</p>
      </section>

      <section className="hook-panel">
        <div className="hook-panel-head">
          <div>
            <b>连接状态</b>
            <span>{wechatRunning ? '微信已就绪，可以开始' : '请先启动并登录微信'}</span>
          </div>
          <span className={'wechat-state' + (wechatRunning ? ' ready' : '')}>
            <i />{wechatRunning ? '微信已运行' : '未检测到微信'}
          </span>
        </div>

        <ol className="hook-steps">
          {([
            ['wechat', '确认微信', wechatRunning ? '已检测到登录状态' : '等待微信运行', ShieldCheck],
            ['hook', '连接微信', progress.stage === 'hooking' ? progress.message : '建立微信连接', Unplug],
            ['verify', '检查连接', progress.stage === 'verifying' ? progress.message : '确认通知可以正常接收', Database]
          ] as const).map(([id, label, description, Icon]) => {
            const done = isStepDone(id)
            const active = busy && activeStep === id
            return <li key={id} className={done ? 'done' : active ? 'active' : ''}>
              <span className="step-icon">{done ? <Check size={15} /> : active ? <LoaderCircle className="spin" size={16} /> : <Icon size={16} />}</span>
              <span><b>{label}</b><small>{description}</small></span>
            </li>
          })}
        </ol>

        {progress.stage === 'error' && <div className="hook-feedback error" role="alert"><AlertCircle size={16} /><span>{progress.message}</span></div>}
        {progress.stage === 'success' && <div className="hook-feedback success" role="status"><CheckCircle2 size={16} /><span>连接完成，正在进入工作台</span></div>}

        <div className="hook-actions">
          {!wechatRunning && <button className="hook-secondary" disabled={checking} onClick={() => void refreshWechat()}><RefreshCw className={checking ? 'spin' : ''} size={15} />{checking ? '正在检查' : '重新检查'}</button>}
          <button className="hook-primary" disabled={busy || !wechatRunning} onClick={() => void startHook()}>
            {busy ? <LoaderCircle className="spin" size={16} /> : <LockKeyhole size={16} />}
            {busy ? '正在连接' : progress.stage === 'error' ? '重新连接' : '开始连接'}
          </button>
        </div>
      </section>

    </main>
  </div>
}
