import { Check, Info, X, AlertTriangle } from 'lucide-react'
import { useToastStore, type ToastType } from '../stores/toastStore'
import './Toast.scss'

const ICONS: Record<ToastType, typeof Check> = {
  success: Check,
  error: AlertTriangle,
  info: Info
}

export function ToastHost() {
  const toasts = useToastStore((state) => state.toasts)
  const remove = useToastStore((state) => state.remove)

  return (
    <div className="toast-host" aria-live="polite" aria-atomic="false">
      {toasts.map((item) => {
        const Icon = ICONS[item.type]
        return (
          <div key={item.id} className={'toast-item ' + item.type} role="status">
            <Icon size={14} />
            <span>{item.message}</span>
            <button type="button" className="icon-button" onClick={() => remove(item.id)} aria-label="关闭提示" title="关闭"><X size={12} /></button>
          </div>
        )
      })}
    </div>
  )
}
