import { useCallback, useEffect, useRef, useState } from 'react'
import { DEFAULT_CONFIG, type AppConfig, type AppStatus, type HookProgress, type NotifyCenterEntry, type NotifyCenterPatch, type SaveConfig } from '../types'
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
  const [destructiveBusy, setDestructiveBusy] = useState(false)
  const entriesRef = useRef<NotifyCenterEntry[]>([])
  const navigateRef = useRef(onNavigateToSession)
  const saveRevisionRef = useRef<Record<string, number>>({})
  navigateRef.current = onNavigateToSession

  const applyEntries = useCallback((nextEntries: NotifyCenterEntry[]) => {
    entriesRef.current = nextEntries
    setEntries(nextEntries)
  }, [])

  /**
   * 通知中心增量合并：主进程只推送变更条目（万条级历史时避免每次全量传输）。
   * 载荷形状异常时回退为全量拉取，保证渲染层与主进程最终一致。
   */
  const applyNotifyCenterPatch = useCallback((incoming: unknown) => {
    const patch = incoming as NotifyCenterPatch | null
    if (!patch || patch.kind !== 'patch') {
      void window.electronAPI?.notifyCenter.list()
        .then((list) => applyEntries(list as NotifyCenterEntry[]))
        .catch(() => {})
      return
    }
    if (patch.clear) {
      applyEntries([])
      return
    }
    let next = entriesRef.current
    let mutated = false
    if (patch.removedIds && patch.removedIds.length > 0) {
      const removedIds = new Set(patch.removedIds)
      next = next.filter((entry) => !removedIds.has(entry.id))
      mutated = true
    }
    if (patch.updated && patch.updated.length > 0) {
      const byId = new Map(patch.updated.map((entry) => [entry.id, entry]))
      next = next.map((entry) => byId.get(entry.id) ?? entry)
      mutated = true
    }
    if (patch.added && patch.added.length > 0) {
      const existingIds = new Set(next.map((entry) => entry.id))
      const fresh = patch.added.filter((entry) => !existingIds.has(entry.id))
      if (fresh.length > 0) {
        next = [...fresh, ...next]
        mutated = true
      }
    }
    if (mutated) applyEntries(next)
  }, [applyEntries])

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
    const removeUpdate = window.electronAPI?.notifyCenter.onUpdate(applyNotifyCenterPatch)
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
  }, [applyEntries, applyNotifyCenterPatch, loadStatus, refresh])

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

  /**
   * 通用操作流程：占用 busy → 执行 → 成功/失败提示 → 释放 busy（可选刷新）。
   * run() 抛出的 Error.message 直接面向用户展示。
   */
  const performAction = useCallback(async (options: {
    run: () => Promise<void>
    setBusy?: (busy: boolean) => void
    refreshAfter?: boolean
    successToast?: string
    errorPrefix?: string
    onSuccess?: () => void
    onError?: (message: string) => void
  }): Promise<boolean> => {
    options.setBusy?.(true)
    try {
      await options.run()
      options.onSuccess?.()
      if (options.successToast) toast(options.successToast, 'success')
      setErrorMessage('')
      return true
    } catch (error) {
      const raw = error instanceof Error ? error.message : String(error)
      const message = (options.errorPrefix || '') + raw
      setErrorMessage(message)
      toast(message, 'error')
      options.onError?.(message)
      return false
    } finally {
      options.setBusy?.(false)
      if (options.refreshAfter) void refresh()
    }
  }, [refresh])

  const reconnect = (): Promise<boolean> => performAction({
    setBusy: setBusy,
    refreshAfter: true,
    successToast: '已恢复微信消息监听',
    errorPrefix: '重新连接失败：',
    run: async () => {
      if (!window.electronAPI) return
      const result = await window.electronAPI.app.reconnect()
      if (!result.success) throw new Error(result.error || '重新连接失败')
    }
  })

  const rehook = (): Promise<boolean> => {
    if (hookBusy) return Promise.resolve(false)
    setHookProgress({ stage: 'detecting', message: '正在查找微信账号' })
    return performAction({
      setBusy: setHookBusy,
      refreshAfter: true,
      successToast: '微信连接已更新，消息监听已恢复',
      run: async () => {
        if (!window.electronAPI) {
          setHookProgress({ stage: 'success', message: '微信连接成功' })
          return
        }
        const result = await window.electronAPI.app.hook()
        if (!result.success) throw new Error(result.error || '重新连接失败')
        setHookProgress({ stage: 'success', message: '微信连接成功' })
      },
      onError: (message) => setHookProgress({ stage: 'error', message })
    })
  }

  const removeHook = (): Promise<boolean> => {
    if (hookBusy) return Promise.resolve(false)
    return performAction({
      setBusy: setHookBusy,
      run: async () => {
        if (window.electronAPI) {
          const result = await window.electronAPI.app.removeHook()
          if (!result.success) throw new Error(result.error || '删除连接失败')
        }
        window.dispatchEvent(new CustomEvent('hook-status-changed', { detail: { ready: false } }))
      },
      errorPrefix: '删除连接失败：'
    })
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
      const result = await window.electronAPI.notifyCenter.markSessionRead(sessionId)
      if (result && !result.success) throw new Error('会话已读状态未保存')
    } catch (error) {
      applyEntries(previous)
      setErrorMessage(`更新会话状态失败：${String(error)}`)
    }
  }

  const removeEntry = (id: string): Promise<boolean> => performAction({
    setBusy: setDestructiveBusy,
    successToast: '已删除该条记录',
    errorPrefix: '删除通知失败：',
    run: async () => {
      const result = await window.electronAPI?.notifyCenter.remove(id)
      if (result && !result.success) throw new Error('删除操作失败')
      applyEntries(entriesRef.current.filter((entry) => entry.id !== id))
    }
  })

  const clearEntries = (): Promise<boolean> => performAction({
    setBusy: setDestructiveBusy,
    successToast: '通知历史已清空',
    errorPrefix: '清空通知历史失败：',
    run: async () => {
      const result = await window.electronAPI?.notifyCenter.clear()
      if (result && !result.success) throw new Error('清空操作失败')
      applyEntries([])
    }
  })

  return {
    status, config, entries, busy, checking, hookBusy, hookProgress, lastStatusAt, errorMessage, destructiveBusy,
    setErrorMessage, refresh, checkNow, saveConfig, reconnect, rehook, removeHook, markEntryRead, markSessionRead, removeEntry, clearEntries
  }
}
