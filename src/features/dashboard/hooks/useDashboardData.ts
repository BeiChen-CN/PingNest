import { useCallback, useEffect, useRef, useState } from 'react'
import { DEFAULT_CONFIG, type AppConfig, type AppStatus, type HookProgress, type NotifyCenterEntry, type SaveConfig } from '../types'
import { toast } from '../stores/toastStore'

const DEMO_ENTRIES: NotifyCenterEntry[] = [
  ['demo-1', '姜北尘', '今晚 8 点前把方案发我，我们需要做最后评审', 'private', false, 0],
  ['demo-2', '产品群', '会议改到下周三下午两点，地点在多功能会议室', 'group', false, 9],
  ['demo-3', '设计评审群', 'UI 走查发现多处图片不匹配，需要重新核对规范', 'group', true, 28],
  ['demo-4', '老王', '项目进度有更新，记得看最新提交的文档', 'private', true, 165]
].map(([id, name, content, type, read, minutes]) => ({
  id: String(id),
  payload: {
    sessionId: String(id), sessionType: String(type), sourceName: String(name),
    content: String(content), timestamp: Math.floor((Date.now() - Number(minutes) * 60000) / 1000), event: 'message.new'
  },
  effect: {}, receivedAt: Date.now() - Number(minutes) * 60000, read: Boolean(read)
}))

export function useDashboardData(onNavigateToSession: (sessionId: string, entries: NotifyCenterEntry[]) => void) {
  const [status, setStatus] = useState<AppStatus | null>(null)
  const [config, setConfig] = useState<AppConfig | null>(null)
  const [entries, setEntries] = useState<NotifyCenterEntry[]>([])
  const [busy, setBusy] = useState(false)
  const [checking, setChecking] = useState(false)
  const [hookBusy, setHookBusy] = useState(false)
  const [hookProgress, setHookProgress] = useState<HookProgress | null>(null)
  const [lastStatusAt, setLastStatusAt] = useState<number | null>(null)
  const [errorMessage, setErrorMessage] = useState('')
  const entriesRef = useRef<NotifyCenterEntry[]>([])
  const navigateRef = useRef(onNavigateToSession)
  const saveRevisionRef = useRef<Record<string, number>>({})
  navigateRef.current = onNavigateToSession

  const applyEntries = useCallback((nextEntries: NotifyCenterEntry[]) => {
    entriesRef.current = nextEntries
    setEntries(nextEntries)
  }, [])

  const loadStatus = useCallback(async (): Promise<boolean> => {
    if (!window.electronAPI) {
      const isExplicitPreview = import.meta.env.DEV || new URLSearchParams(window.location.search).get('preview') === '1'
      if (isExplicitPreview) {
        setStatus((current) => current || { connected: true, wcdbReady: true, wechatRunning: true, hasFullConfig: true, hookReady: true, config: { ...DEFAULT_CONFIG, myWxid: 'wxid_preview', myWxName: '姜北尘' } })
        setLastStatusAt(Date.now())
        return true
      } else {
        setErrorMessage('应用未准备好，请重新启动。')
        return false
      }
    }
    try {
      const nextStatus = await window.electronAPI.app.getStatus()
      setStatus(nextStatus as AppStatus)
      setLastStatusAt(Date.now())
      return true
    } catch (error) {
      setErrorMessage(`读取连接状态失败：${String(error)}`)
      return false
    }
  }, [])

  const refresh = useCallback(async (): Promise<boolean> => {
    if (!window.electronAPI) {
      const previewReady = await loadStatus()
      if (previewReady) {
        setConfig(DEFAULT_CONFIG)
        applyEntries(DEMO_ENTRIES)
      }
      return previewReady
    }
    try {
      // 状态接口包含完整配置，先用它渲染工作台；历史数据慢或损坏不应阻塞首屏。
      const nextStatus = await window.electronAPI.app.getStatus()
      setStatus(nextStatus as AppStatus)
      setConfig((nextStatus as AppStatus).config || DEFAULT_CONFIG)
      const [configResult, entriesResult] = await Promise.allSettled([
        window.electronAPI.config.get(), window.electronAPI.notifyCenter.list()
      ])
      if (configResult.status === 'fulfilled') setConfig(configResult.value as AppConfig)
      if (entriesResult.status === 'fulfilled') applyEntries(entriesResult.value as NotifyCenterEntry[])
      setLastStatusAt(Date.now())
      setErrorMessage('')
      return true
    } catch (error) {
      setErrorMessage(`读取本地状态失败：${String(error)}`)
      return false
    }
  }, [applyEntries, loadStatus])

  useEffect(() => {
    void refresh()
    const removeUpdate = window.electronAPI?.notifyCenter.onUpdate((next) => applyEntries(next as NotifyCenterEntry[]))
    const removeHookProgress = window.electronAPI?.app.onHookProgress(setHookProgress)
    const removeNavigate = window.electronAPI?.onNavigateToSession(async (sessionId) => {
      try {
        const nextEntries = (await window.electronAPI?.notifyCenter.list() || entriesRef.current) as NotifyCenterEntry[]
        applyEntries(nextEntries)
        navigateRef.current(sessionId, nextEntries)
      } catch (error) {
        navigateRef.current(sessionId, entriesRef.current)
        setErrorMessage(`定位通知失败：${String(error)}`)
      }
    })
    const statusTimer = window.setInterval(() => { void loadStatus() }, 5000)
    return () => { removeUpdate?.(); removeHookProgress?.(); removeNavigate?.(); window.clearInterval(statusTimer) }
  }, [applyEntries, loadStatus, refresh])

  const saveConfig: SaveConfig = async (key, value) => {
    const revision = (saveRevisionRef.current[String(key)] || 0) + 1
    saveRevisionRef.current[String(key)] = revision
    const previousValue = config?.[key]
    setConfig((current) => ({ ...(current || DEFAULT_CONFIG), [key]: value }))
    if (!window.electronAPI) return true
    try {
      const result = await window.electronAPI.config.set(key, value)
      if (!result.success) throw new Error(result.error || '主进程拒绝了配置更新')
      setErrorMessage('')
      return true
    } catch (error) {
      if (saveRevisionRef.current[String(key)] === revision) {
        setConfig((current) => current?.[key] === value ? { ...current, [key]: previousValue } as AppConfig : current)
      }
      const message = '保存设置失败：' + String(error)
      setErrorMessage(message)
      toast(message, 'error')
      return false
    }
  }

  const reconnect = async () => {
    if (!window.electronAPI) return false
    setBusy(true)
    try {
      const result = await window.electronAPI.app.reconnect()
      if (!result.success) throw new Error(result.error || '重新连接失败')
      toast('已恢复微信消息监听', 'success')
      setErrorMessage('')
      return true
    } catch (error) {
      const message = '重新连接失败：' + String(error)
      setErrorMessage(message)
      toast(message, 'error')
      return false
    } finally {
      setBusy(false)
      void refresh()
    }
  }

  const rehook = async (): Promise<boolean> => {
    if (hookBusy) return false
    setHookBusy(true)
    setHookProgress({ stage: 'detecting', message: '正在查找微信账号' })
    try {
      if (!window.electronAPI) {
        setHookProgress({ stage: 'success', message: '微信连接成功' })
        toast('微信连接已更新', 'success')
        return true
      }
      const result = await window.electronAPI.app.hook()
      if (!result.success) throw new Error(result.error || '重新连接失败')
      setHookProgress({ stage: 'success', message: '微信连接成功' })
      toast('微信连接已更新，消息监听已恢复', 'success')
      setErrorMessage('')
      return true
    } catch (error) {
      const message = '重新连接失败：' + String(error)
      setHookProgress({ stage: 'error', message })
      setErrorMessage(message)
      toast(message, 'error')
      return false
    } finally {
      setHookBusy(false)
      void refresh()
    }
  }

  const removeHook = async (): Promise<boolean> => {
    if (hookBusy) return false
    setHookBusy(true)
    try {
      if (window.electronAPI) {
        const result = await window.electronAPI.app.removeHook()
        if (!result.success) throw new Error(result.error || '删除连接失败')
      }
      window.dispatchEvent(new CustomEvent('hook-status-changed', { detail: { ready: false } }))
      return true
    } catch (error) {
      const message = '删除连接失败：' + String(error)
      setErrorMessage(message)
      toast(message, 'error')
      return false
    } finally {
      setHookBusy(false)
    }
  }

  const checkNow = async () => {
    setChecking(true)
    try {
      return await refresh()
    } finally {
      setChecking(false)
    }
  }

  const markEntryRead = async (id: string) => {
    const previous = entriesRef.current
    applyEntries(previous.map((entry) => entry.id === id ? { ...entry, read: true } : entry))
    try {
      const result = await window.electronAPI?.notifyCenter.markRead(id)
      if (result && !result.success) throw new Error('已读状态未保存')
    } catch (error) {
      applyEntries(previous)
      setErrorMessage(`更新通知状态失败：${String(error)}`)
    }
  }

  const markSessionRead = async (sessionId: string) => {
    const previous = entriesRef.current
    const hasUnread = previous.some((entry) => entry.payload.sessionId === sessionId && !entry.read)
    if (!hasUnread) return
    applyEntries(previous.map((entry) => entry.payload.sessionId === sessionId ? { ...entry, read: true } : entry))
    try {
      if (!window.electronAPI) return
      try {
        const markSessionRead = window.electronAPI.notifyCenter.markSessionRead
        if (typeof markSessionRead !== 'function') throw new Error('No handler registered for notify:markSessionRead')
        const result = await markSessionRead(sessionId)
        if (result && !result.success) throw new Error('会话已读状态未保存')
      } catch (error) {
        // 兼容已经启动的旧主进程：逐条标记，不让历史页因 IPC 版本不一致报错。
        if (!String(error).includes('No handler registered')) throw error
        const unreadIds = previous.filter((entry) => entry.payload.sessionId === sessionId && !entry.read).map((entry) => entry.id)
        await Promise.all(unreadIds.map((id) => window.electronAPI!.notifyCenter.markRead(id)))
      }
    } catch (error) {
      applyEntries(previous)
      setErrorMessage(`更新会话状态失败：${String(error)}`)
    }
  }

  const removeEntry = async (id: string): Promise<boolean> => {
    try {
      const result = await window.electronAPI?.notifyCenter.remove(id)
      if (result && !result.success) throw new Error('删除操作失败')
      applyEntries(entriesRef.current.filter((entry) => entry.id !== id))
      toast('已删除该条记录', 'success')
      return true
    } catch (error) {
      const message = '删除通知失败：' + String(error)
      setErrorMessage(message)
      toast(message, 'error')
      return false
    }
  }

  const clearEntries = async (): Promise<boolean> => {
    try {
      const result = await window.electronAPI?.notifyCenter.clear()
      if (result && !result.success) throw new Error('清空操作失败')
      applyEntries([])
      toast('通知历史已清空', 'success')
      return true
    } catch (error) {
      const message = '清空通知历史失败：' + String(error)
      setErrorMessage(message)
      toast(message, 'error')
      return false
    }
  }

  return {
    status, config, entries, busy, checking, hookBusy, hookProgress, lastStatusAt, errorMessage,
    setErrorMessage, refresh, checkNow, saveConfig, reconnect, rehook, removeHook, markEntryRead, markSessionRead, removeEntry, clearEntries
  }
}
