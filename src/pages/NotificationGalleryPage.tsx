import { useState } from 'react'
import { AppearancePage } from '../features/dashboard/pages/AppearancePage'
import { DEFAULT_CONFIG, type AppConfig, type SaveConfig } from '../features/dashboard/types'
import './AppShell.scss'

export default function NotificationGalleryPage() {
  const [config, setConfig] = useState<AppConfig>(DEFAULT_CONFIG)
  const saveConfig: SaveConfig = async (key, value) => {
    setConfig((current) => ({ ...current, [key]: value }))
    return true
  }

  return <div className="app-shell browser-preview-shell">
    <main className="workspace">
      <section className="page-heading"><div><h1>外观设置</h1></div></section>
      <AppearancePage config={config} saveConfig={saveConfig} />
    </main>
  </div>
}
