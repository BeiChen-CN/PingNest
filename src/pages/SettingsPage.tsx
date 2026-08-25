import { useCallback, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  AlertTriangle, History, Info, LayoutDashboard, Maximize2, Minus,
  Paintbrush, Settings, VolumeX, X
} from 'lucide-react'
import { ConfirmDialog } from '../features/dashboard/components/ConfirmDialog'
import { useDashboardData } from '../features/dashboard/hooks/useDashboardData'
import { AppearancePage } from '../features/dashboard/pages/AppearancePage'
import { HistoryPage } from '../features/dashboard/pages/HistoryPage'
import { OverviewPage } from '../features/dashboard/pages/OverviewPage'
import { RulesPage } from '../features/dashboard/pages/RulesPage'
import { SystemSettingsPage } from '../features/dashboard/pages/SystemSettingsPage'
import { AboutPage } from '../features/dashboard/pages/AboutPage'
import { PAGE_PATHS, type NotifyCenterEntry, type PageId } from '../features/dashboard/types'
import { ToastHost } from '../features/dashboard/components/Toast'
import './SettingsPage.scss'

const NAV_ITEMS: Array<{ id: PageId; label: string; icon: typeof LayoutDashboard }> = [
  { id: 'overview', label: '概览', icon: LayoutDashboard },
  { id: 'history', label: '历史', icon: History },
  { id: 'rules', label: '静音', icon: VolumeX },
  { id: 'appearance', label: '外观', icon: Paintbrush },
  { id: 'settings', label: '设置', icon: Settings },
  { id: 'about', label: '关于', icon: Info }
]

const PAGE_META: Record<PageId, { title: string }> = {
  overview: { title: '运行概览' },
  history: { title: '通知历史' },
  rules: { title: '静音规则' },
  appearance: { title: '外观设置' },
  settings: { title: '系统设置' },
  about: { title: '关于 PingNest' }
}

const PATH_PAGES = Object.fromEntries(Object.entries(PAGE_PATHS).map(([page, path]) => [path, page])) as Record<string, PageId>

export default function SettingsPage() {
  const location = useLocation()
  const navigate = useNavigate()
  const page = PATH_PAGES[location.pathname] || 'overview'
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [confirmClear, setConfirmClear] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<NotifyCenterEntry | null>(null)
  const [confirmRemoveHook, setConfirmRemoveHook] = useState(false)
  const [destructiveBusy, setDestructiveBusy] = useState(false)

  const handleNotificationNavigate = useCallback((sessionId: string, entries: NotifyCenterEntry[]) => {
    const match = entries.find((entry) => entry.payload.sessionId === sessionId)
    setSelectedId(match?.id || null)
    navigate(PAGE_PATHS.history)
  }, [navigate])

  const dashboard = useDashboardData(handleNotificationNavigate)
  const { status, config, entries, errorMessage } = dashboard
  const unreadCount = entries.filter((entry) => !entry.read).length

  const openHistory = (id?: string) => {
    setSelectedId(id || null)
    navigate(PAGE_PATHS.history)
  }

  const removePendingEntry = async () => {
    if (!pendingDelete || destructiveBusy) return
    setDestructiveBusy(true)
    const success = await dashboard.removeEntry(pendingDelete.id)
    setDestructiveBusy(false)
    if (success) {
      if (selectedId === pendingDelete.id) setSelectedId(null)
      setPendingDelete(null)
    }
  }

  const clearAllEntries = async () => {
    if (destructiveBusy) return
    setDestructiveBusy(true)
    const success = await dashboard.clearEntries()
    setDestructiveBusy(false)
    if (success) {
      setConfirmClear(false)
      setSelectedId(null)
    }
  }

  const removeHook = async () => {
    const success = await dashboard.removeHook()
    if (success) setConfirmRemoveHook(false)
  }

  if ((!config || !status) && errorMessage) return <div className="page-loading load-error"><AlertTriangle size={22} /><b>应用初始化失败</b><span>{errorMessage}</span><button className="button" onClick={() => void dashboard.refresh()}>重试</button></div>
  if (!config || !status) return <div className="page-loading">正在准备应用...</div>

  return <div className="app-shell">
    <header className="titlebar"><div className="brand"><img src="./icon.png" alt="" /><b>PingNest</b></div><div className="window-actions"><button onClick={() => window.electronAPI?.app.minimize()} aria-label="最小化" title="最小化"><Minus size={14} /></button><button onClick={() => window.electronAPI?.app.toggleMaximize()} aria-label="最大化或还原" title="最大化或还原"><Maximize2 size={13} /></button><button className="close" onClick={() => window.electronAPI?.app.closeWindow()} aria-label={config.closeToTray ? '隐藏到系统托盘' : '退出应用'} title={config.closeToTray ? '隐藏到系统托盘' : '退出应用'}><X size={14} /></button></div></header>
    <aside className="sidebar"><nav aria-label="主导航">{NAV_ITEMS.map((item) => { const Icon = item.icon; return <button key={item.id} className={page === item.id ? 'active' : ''} aria-current={page === item.id ? 'page' : undefined} onClick={() => navigate(PAGE_PATHS[item.id])} title={item.label}><Icon size={18} /><span>{item.label}</span>{item.id === 'history' && unreadCount > 0 && <i>{Math.min(unreadCount, 99)}</i>}</button> })}</nav></aside>
    <main className="workspace" key={page}>
      {errorMessage && <div className="error-banner" role="alert"><AlertTriangle size={15} /><span>{errorMessage}</span><button className="icon-button" onClick={() => dashboard.setErrorMessage('')} aria-label="关闭错误提示" title="关闭"><X size={14} /></button></div>}
      <section className="page-heading"><div><h1>{PAGE_META[page].title}</h1></div></section>
      {page === 'overview' && <OverviewPage status={status} config={config} entries={entries} rules={config.notifyRules} busy={dashboard.busy} checking={dashboard.checking} lastStatusAt={dashboard.lastStatusAt} onOpenHistory={openHistory} onRefresh={dashboard.checkNow} onAutoSetup={() => void dashboard.runAutoSetup()} onReconnect={() => void dashboard.reconnect()} onToggleNotifications={(enabled) => void dashboard.saveConfig('notificationEnabled', enabled)} />}
      {page === 'history' && <HistoryPage entries={entries} selectedId={selectedId} onSelect={(sessionId, latestEntryId) => { setSelectedId(latestEntryId); void dashboard.markSessionRead(sessionId) }} onRequestRemove={setPendingDelete} onRequestClear={() => setConfirmClear(true)} />}
      {page === 'rules' && <RulesPage config={config} entries={entries} saveConfig={dashboard.saveConfig} />}
      {page === 'appearance' && <AppearancePage config={config} saveConfig={dashboard.saveConfig} />}
      {page === 'settings' && <SystemSettingsPage config={config} status={status} hookBusy={dashboard.busy || dashboard.hookBusy} hookProgress={dashboard.hookProgress} entryCount={entries.length} saveConfig={dashboard.saveConfig} onRequestClear={() => setConfirmClear(true)} onReconnect={() => void dashboard.reconnect()} onRehook={() => void dashboard.rehook()} onRequestRemoveHook={() => setConfirmRemoveHook(true)} />}
      {page === 'about' && <AboutPage config={config} status={status} entryCount={entries.length} />}
    </main>
    {confirmClear && <ConfirmDialog count={entries.length} busy={destructiveBusy} onCancel={() => setConfirmClear(false)} onConfirm={() => void clearAllEntries()} />}
    {pendingDelete && <ConfirmDialog title="删除这条消息？" description={`将删除“${pendingDelete.payload.groupName || pendingDelete.payload.sourceName}”会话中的这条本地记录，此操作无法撤销。`} confirmLabel="删除消息" busy={destructiveBusy} onCancel={() => setPendingDelete(null)} onConfirm={() => void removePendingEntry()} />}
    {confirmRemoveHook && <ConfirmDialog title="删除微信连接？" description="删除后将停止消息监听并返回连接页面。通知历史和其他设置不会被清除。" confirmLabel="删除连接" busy={dashboard.hookBusy} onCancel={() => setConfirmRemoveHook(false)} onConfirm={() => void removeHook()} />}
    <ToastHost />
  </div>
}
