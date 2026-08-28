import { useState } from 'react'
import { AppearancePage } from '../features/dashboard/pages/AppearancePage'
import { DEFAULT_CONFIG, type AppConfig, type SaveConfig } from '../features/dashboard/types'
import '../features/dashboard/pages/pages.scss'
import './AppShell.scss'

/** DEV 专用：浏览器里预览外观页与通知样式，不走 Electron。 */
export default function NotificationGalleryPage() {
  const [config, setConfig] = useState<AppConfig>(DEFAULT_CONFIG)
  const saveConfig: SaveConfig = async (key, value) => {
    setConfig((current) => ({ ...current, [key]: value }))
    return true
  }

  return <div className="app-shell browser-preview-shell">
    <main className="workspace">
      <header className="top-app-bar">
        <div>
          <h1>外观与弹窗</h1>
          <p>调整桌面通知的位置与交互方式</p>
        </div>
      </header>
      <div className="content">
        <AppearancePage config={config} saveConfig={saveConfig} />
      </div>
    </main>
  </div>
}
