import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  Bell, History, Home, Info, Minus, Paintbrush, Search, Settings, Square, VolumeX, X, Check
} from 'lucide-react'
import { ConfirmDialog } from '../features/dashboard/components/ConfirmDialog'
import { useDashboardData } from '../features/dashboard/hooks/useDashboardData'
import { HomePage } from '../features/dashboard/pages/HomePage'
import { HistoryPage } from '../features/dashboard/pages/HistoryPage'
import { RulesPage } from '../features/dashboard/pages/RulesPage'
import { AppearancePage } from '../features/dashboard/pages/AppearancePage'
import { SystemSettingsPage } from '../features/dashboard/pages/SystemSettingsPage'
import { AboutPage } from '../features/dashboard/pages/AboutPage'
import { PAGE_PATHS, type NotifyCenterEntry, type PageId } from '../features/dashboard/types'
import { ToastHost } from '../features/dashboard/components/Toast'
import { normalizeMotionScheme } from '../../shared/motionScheme'
import './AppShell.scss'

const NAV_MAIN: Array<{ id: PageId; label: string; icon: typeof Home }> = [
  { id: 'overview', label: '主页', icon: Home },
  { id: 'history', label: '历史', icon: History },
  { id: 'rules', label: '静音规则', icon: VolumeX }
]
const NAV_PREF: Array<{ id: PageId; label: string; icon: typeof Home }> = [
  { id: 'appearance', label: '外观', icon: Paintbrush },
  { id: 'settings', label: '设置', icon: Settings },
  { id: 'about', label: '关于', icon: Info }
]
const PAGE_TITLE: Record<PageId, { title: string; sub: string }> = {
  overview: { title: '主页', sub: '一眼看全今日通知与连接状态' },
  history: { title: '历史', sub: '搜索、筛选并处理本地通知记录' },
  rules: { title: '静音规则', sub: '命中规则的消息只进历史，不弹桌面通知' },
  appearance: { title: '外观', sub: '九种通知样式 · 位置 · 卡片大小 · 堆叠' },
  settings: { title: '设置', sub: '启动 · 监听 · 数据 · 隐私' },
  about: { title: '关于', sub: '本地优先的 Windows 微信通知中心' }
}
const PATH_TO_PAGE = Object.fromEntries(Object.entries(PAGE_PATHS).map(([page, path]) => [path, page])) as Record<string, PageId>

interface Command {
  id: string
  label: string
  hint: string
  run: () => void
}

export default function AppShell() {
  const location = useLocation()
  const navigate = useNavigate()
  const page = PATH_TO_PAGE[location.pathname] || 'overview'
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [confirmClear, setConfirmClear] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<NotifyCenterEntry | null>(null)
  const [confirmRemoveHook, setConfirmRemoveHook] = useState(false)
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [paletteQuery, setPaletteQuery] = useState('')
  const [paletteIndex, setPaletteIndex] = useState(0)
  const paletteInputRef = useRef<HTMLInputElement>(null)
  const sidebarRef = useRef<HTMLElement>(null)
  const [navPill, setNavPill] = useState<{ top: number; height: number } | null>(null)

  const dashboard = useDashboardData(useCallback((sessionId: string, entries: NotifyCenterEntry[]) => {
    const match = entries.find((entry) => entry.payload.sessionId === sessionId)
    setSelectedId(match?.id || null)
    navigate(PAGE_PATHS.history)
  }, [navigate]))
  const { status, config, entries, errorMessage } = dashboard
  const unreadCount = entries.filter((entry) => !entry.read).length

  const openHistory = (id?: string) => {
    setSelectedId(id || null)
    navigate(PAGE_PATHS.history)
  }

  const removePendingEntry = async () => {
    if (!pendingDelete || dashboard.destructiveBusy) return
    const ok = await dashboard.removeEntry(pendingDelete.id)
    if (ok) {
      if (selectedId === pendingDelete.id) setSelectedId(null)
      setPendingDelete(null)
    }
  }
  const clearAllEntries = async () => {
    if (dashboard.destructiveBusy) return
    const ok = await dashboard.clearEntries()
    if (ok) { setConfirmClear(false); setSelectedId(null) }
  }
  const removeHook = async () => {
    const ok = await dashboard.removeHook()
    if (ok) setConfirmRemoveHook(false)
  }

  // Ctrl+K 命令面板
  const commands: Command[] = useMemo(() => {
    const go = (id: PageId): Command => ({ id: 'go-' + id, label: '转到 · ' + PAGE_TITLE[id].title, hint: '页面', run: () => navigate(PAGE_PATHS[id]) })
    const list = [go('overview'), go('history'), go('rules'), go('appearance'), go('settings'), go('about')]
    if (dashboard.checkNow) list.push({ id: 'check', label: '立即检查连接状态', hint: '操作', run: () => void dashboard.checkNow() })
    if (dashboard.reconnect) list.push({ id: 'reconnect', label: '重新连接微信', hint: '操作', run: () => void dashboard.reconnect() })
    if (config) list.push({
      id: 'popup', label: (config.notificationEnabled ? '关闭' : '开启') + '桌面弹窗', hint: config.notificationEnabled ? '开 → 关' : '关 → 开',
      run: () => void dashboard.saveConfig('notificationEnabled', !config.notificationEnabled)
    })
    return list
  }, [navigate, dashboard, config])
  const filteredCommands = useMemo(() => {
    const q = paletteQuery.trim().toLowerCase()
    if (!q) return commands
    return commands.filter((c) => c.label.toLowerCase().includes(q))
  }, [commands, paletteQuery])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setPaletteOpen((open) => !open)
        setPaletteQuery('')
        setPaletteIndex(0)
      }
      if (event.key === 'Escape') setPaletteOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
  useEffect(() => {
    if (paletteOpen) window.requestAnimationFrame(() => paletteInputRef.current?.focus())
  }, [paletteOpen])

  // 动效方案：驱动 <html data-motion> 整套 CSS 变量切换
  useEffect(() => {
    document.documentElement.dataset.motion = normalizeMotionScheme(config?.motionScheme)
  }, [config?.motionScheme])

  // 侧栏滑行胶囊：用 rect 相对测量，原点与绝对定位的 padding 盒一致，
  // 避免 offsetTop（边框盒原点，含侧栏 padding）造成的整体下移压住下一行
  const layoutNavPill = useCallback(() => {
    const sidebar = sidebarRef.current
    if (!sidebar) return
    const active = sidebar.querySelector<HTMLButtonElement>('.bnav.on')
    if (!active) { setNavPill(null); return }
    const sidebarRect = sidebar.getBoundingClientRect()
    const rect = active.getBoundingClientRect()
    setNavPill({ top: rect.top - sidebarRect.top + sidebar.scrollTop, height: rect.height })
  }, [])
  useLayoutEffect(() => { layoutNavPill() }, [page, status, layoutNavPill])
  useEffect(() => {
    const sidebar = sidebarRef.current
    window.addEventListener('resize', layoutNavPill)
    sidebar?.addEventListener('scroll', layoutNavPill, { passive: true })
    void document.fonts?.ready.then(layoutNavPill)
    const observer = sidebar ? new ResizeObserver(layoutNavPill) : null
    if (sidebar && observer) observer.observe(sidebar)
    return () => {
      window.removeEventListener('resize', layoutNavPill)
      sidebar?.removeEventListener('scroll', layoutNavPill)
      observer?.disconnect()
    }
  }, [layoutNavPill])

  const runCommand = (command?: Command) => {
    if (!command) return
    setPaletteOpen(false)
    command.run()
  }

  const healthy = !!status && status.connected && status.wcdbReady && !status.pushError
  const serviceLabel = !status ? '正在准备' : !status.hasFullConfig ? '未配置' : !status.wechatRunning ? '等待微信' : healthy ? '监听中' : status.pushError ? '同步异常' : '连接中断'

  if ((!config || !status) && errorMessage) return <div className="page-loading load-error"><b>应用初始化失败</b><span>{errorMessage}</span><button className="md-button outlined" onClick={() => void dashboard.refresh()}>重试</button></div>
  if (!config || !status) return <div className="page-loading">正在准备应用...</div>

  return <div className="app-shell">
    <div className="shell-body">
      <aside className="sidebar" ref={sidebarRef}>
        <span className={'navpill' + (navPill ? ' ready' : '')} style={navPill ? { transform: `translateY(${navPill.top}px)`, height: navPill.height } : undefined} aria-hidden="true" />
        <div className="brandline">
          <img className="logo" src="./icon.png" alt="" />
          <div><b>PingNest</b><span>通知伴侣</span></div>
        </div>
        <div className="navlabel">工作台</div>
        {NAV_MAIN.map((item) => {
          const Icon = item.icon
          return <button key={item.id} className={'bnav' + (page === item.id ? ' on' : '')}
            onClick={() => navigate(PAGE_PATHS[item.id])}>
            <span className="bdot" /><Icon size={15} /><span>{item.label}</span>
            {item.id === 'history' && unreadCount > 0 && <span className="bsub">{Math.min(unreadCount, 99)}</span>}
          </button>
        })}
        <div className="navlabel">偏好</div>
        {NAV_PREF.map((item) => {
          const Icon = item.icon
          return <button key={item.id} className={'bnav' + (page === item.id ? ' on' : '')}
            onClick={() => navigate(PAGE_PATHS[item.id])}>
            <span className="bdot" /><Icon size={15} /><span>{item.label}</span>
          </button>
        })}
        <div className="ministat">
          <b><i />{healthy ? '微信已连接' : serviceLabel}</b>
          {status.wechatRunning ? `WCDB ${status.wcdbReady ? '已解密' : '未就绪'} · ${config.reconnectIntervalSeconds}s 重连` : '等待微信启动'}
        </div>
      </aside>

      <main className="workarea">
        <div className="topbar">
          <button className="cmdbar" onClick={() => setPaletteOpen(true)} aria-label="打开命令面板">
            <Search size={14} />
            <span>搜索或输入命令…</span>
            <kbd>Ctrl K</kbd>
          </button>
          <span className="topbar-sp" />
          <span className={'status-pill' + (healthy ? ' ok' : '')}><i />{serviceLabel}</span>
          <div className="wbtns">
            <button className="wbtn" onClick={() => window.electronAPI?.app.minimize()} aria-label="最小化" title="最小化"><Minus size={13} /></button>
            <button className="wbtn" onClick={() => window.electronAPI?.app.toggleMaximize()} aria-label="最大化或还原" title="最大化或还原"><Square size={11} /></button>
            <button className="wbtn close" onClick={() => window.electronAPI?.app.closeWindow()} aria-label={config.closeToTray ? '隐藏到系统托盘' : '退出应用'} title={config.closeToTray ? '隐藏到系统托盘' : '退出应用'}><X size={13} /></button>
          </div>
        </div>

        {errorMessage && <div className="workarea-error"><div className="error-banner" role="alert"><span>{errorMessage}</span><button className="icon-button" onClick={() => dashboard.setErrorMessage('')} aria-label="关闭错误提示" title="关闭"><X size={14} /></button></div></div>}

        <div className="page" key={page}>
          <div className="ph">
            <div><h3>{PAGE_TITLE[page].title}</h3><p>{PAGE_TITLE[page].sub}</p></div>
            {page === 'history' && <div className="acts"><button className="md-button danger-action sm" disabled={!entries.length} onClick={() => setConfirmClear(true)}>清空历史</button></div>}
          </div>

          {page === 'overview' && <HomePage dashboard={dashboard} onOpenHistory={openHistory} onGoRules={() => navigate(PAGE_PATHS.rules)} />}
          {page === 'history' && <HistoryPage entries={entries} selectedId={selectedId}
            onSelect={(sessionId, latestEntryId) => { setSelectedId(latestEntryId); void dashboard.markSessionRead(sessionId) }}
            onRequestRemove={setPendingDelete} />}
          {page === 'rules' && <RulesPage config={config} entries={entries} saveConfig={dashboard.saveConfig} />}
          {page === 'appearance' && <AppearancePage config={config} saveConfig={dashboard.saveConfig} />}
          {page === 'settings' && <SystemSettingsPage config={config} status={status} hookBusy={dashboard.busy || dashboard.hookBusy} hookProgress={dashboard.hookProgress} entryCount={entries.length} saveConfig={dashboard.saveConfig} onReconnect={() => void dashboard.reconnect()} onRehook={() => void dashboard.rehook()} onRequestRemoveHook={() => setConfirmRemoveHook(true)} />}
          {page === 'about' && <AboutPage config={config} status={status} entryCount={entries.length} />}
        </div>
      </main>
    </div>

    {paletteOpen && <div className="palette-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) setPaletteOpen(false) }}>
      <div className="palette" role="dialog" aria-modal="true" aria-label="命令面板">
        <div className="palette-input">
          <Search size={15} />
          <input ref={paletteInputRef} value={paletteQuery} placeholder="搜索页面或操作…"
            onChange={(e) => { setPaletteQuery(e.target.value); setPaletteIndex(0) }}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') { e.preventDefault(); setPaletteIndex((i) => Math.min(i + 1, filteredCommands.length - 1)) }
              else if (e.key === 'ArrowUp') { e.preventDefault(); setPaletteIndex((i) => Math.max(i - 1, 0)) }
              else if (e.key === 'Enter') { e.preventDefault(); runCommand(filteredCommands[paletteIndex]) }
            }} />
          <kbd>Esc</kbd>
        </div>
        <div className="palette-list">
          {filteredCommands.length === 0 && <div className="palette-empty">没有匹配的命令</div>}
          {filteredCommands.map((command, index) => <button key={command.id}
            className={'palette-item' + (index === paletteIndex ? ' on' : '')}
            onMouseEnter={() => setPaletteIndex(index)}
            onClick={() => runCommand(command)}>
            <span>{command.label}</span><span className="hint">{command.hint}</span>
            {index === paletteIndex && <Check size={13} />}
          </button>)}
        </div>
      </div>
    </div>}

    {confirmClear && <ConfirmDialog count={entries.length} busy={dashboard.destructiveBusy} onCancel={() => setConfirmClear(false)} onConfirm={() => void clearAllEntries()} />}
    {pendingDelete && <ConfirmDialog title="删除这条消息？" description={`将删除「${pendingDelete.payload.groupName || pendingDelete.payload.sourceName}」会话中的这条本地记录，此操作无法撤销。`} confirmLabel="删除消息" busy={dashboard.destructiveBusy} onCancel={() => setPendingDelete(null)} onConfirm={() => void removePendingEntry()} />}
    {confirmRemoveHook && <ConfirmDialog title="删除微信连接？" description="删除后将停止消息监听并返回连接页面。通知历史和其他设置不会被清除。" confirmLabel="删除连接" busy={dashboard.hookBusy} onCancel={() => setConfirmRemoveHook(false)} onConfirm={() => void removeHook()} />}
    <ToastHost />
  </div>
}
