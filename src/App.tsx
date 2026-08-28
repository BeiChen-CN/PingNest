import { useCallback, useEffect, useState } from 'react'
import { Routes, Route } from 'react-router-dom'
import NotificationWindow from './pages/NotificationWindow'
import AppShell from './pages/AppShell'
import NotificationGalleryPage from './pages/NotificationGalleryPage'
import HookPage from './pages/HookPage'

function MainAppGate() {
  const previewHook = !window.electronAPI && new URLSearchParams(window.location.search).get('hook') === '1'
  const [ready, setReady] = useState<boolean | null>(null)
  const [wechatRunning, setWechatRunning] = useState(false)
  const [loadError, setLoadError] = useState('')

  const loadGateStatus = useCallback(async () => {
    if (!window.electronAPI) {
      setWechatRunning(true)
      setReady(!previewHook)
      return
    }
    try {
      const status = await window.electronAPI.app.getStatus()
      setWechatRunning(status.wechatRunning)
      setReady(status.hookReady)
      setLoadError('')
    } catch (error) {
      setLoadError(`无法读取 Hook 状态：${String(error)}`)
      setReady(null)
    }
  }, [previewHook])

  useEffect(() => {
    void loadGateStatus()
    const handleChange = (event: Event) => {
      const detail = (event as CustomEvent<{ ready: boolean }>).detail
      if (detail) setReady(detail.ready)
      else void loadGateStatus()
    }
    window.addEventListener('hook-status-changed', handleChange)
    return () => window.removeEventListener('hook-status-changed', handleChange)
  }, [loadGateStatus])

  if (loadError) return <div className="page-loading load-error"><b>Hook 状态读取失败</b><span>{loadError}</span><button className="button" onClick={() => void loadGateStatus()}>重试</button></div>
  if (ready === null) return <div className="page-loading">正在检查本地连接...</div>
  if (!ready) return <HookPage initialWechatRunning={wechatRunning} onComplete={() => setReady(true)} />
  return <AppShell />
}

// 独立弹窗路由与主界面路由
export default function App() {
  return (
    <Routes>
      <Route path="/notification-window" element={<NotificationWindow />} />
      {import.meta.env.DEV && <Route path="/notification-gallery" element={<NotificationGalleryPage />} />}
      <Route path="*" element={<MainAppGate />} />
    </Routes>
  )
}
