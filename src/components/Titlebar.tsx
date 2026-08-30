import { Maximize2, Minus, X } from 'lucide-react'

type TitlebarVariant = 'app' | 'hook'

const VARIANT_CLASS_NAMES: Record<TitlebarVariant, { root: string; brand: string; actions: string }> = {
  app: { root: 'titlebar', brand: 'brand', actions: 'window-actions' },
  hook: { root: 'hook-titlebar', brand: 'hook-brand', actions: 'hook-window-actions' }
}

/**
 * 无边框窗口的自绘标题栏（拖拽区 + 品牌 + 最小化/最大化/关闭）。
 * 主窗口与连接引导页共用，类名按 variant 区分以兼容各自样式表。
 */
export function Titlebar({ variant = 'app', closeLabel }: { variant?: TitlebarVariant; closeLabel?: string }) {
  const names = VARIANT_CLASS_NAMES[variant]
  const closeText = closeLabel || (variant === 'app' ? '关闭窗口' : '退出应用')
  return (
    <header className={names.root}>
      <div className={names.actions}>
        <button onClick={() => window.electronAPI?.app.minimize()} aria-label="最小化" title="最小化"><Minus size={14} /></button>
        <button onClick={() => window.electronAPI?.app.toggleMaximize()} aria-label="最大化或还原" title="最大化或还原"><Maximize2 size={13} /></button>
        <button
          className="close"
          onClick={() => window.electronAPI?.app.closeWindow()}
          aria-label={closeText}
          title={closeText}
        ><X size={14} /></button>
      </div>
    </header>
  )
}
