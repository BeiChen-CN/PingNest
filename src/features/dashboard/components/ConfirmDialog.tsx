import { useEffect, useRef } from 'react'
import { Trash2 } from 'lucide-react'

interface Props {
  count?: number
  title?: string
  description?: string
  confirmLabel?: string
  busy?: boolean
  onCancel: () => void
  onConfirm: () => void
}

export function ConfirmDialog({ count = 0, title = '清空全部通知记录？', description, confirmLabel = '清空记录', busy = false, onCancel, onConfirm }: Props) {
  const dialogRef = useRef<HTMLDivElement>(null)
  const cancelRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null
    cancelRef.current?.focus()
    return () => previousFocus?.focus()
  }, [])

  const handleKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      if (!busy) onCancel()
      return
    }
    if (event.key !== 'Tab') return
    const focusable = dialogRef.current?.querySelectorAll<HTMLElement>('button:not(:disabled), [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')
    if (!focusable?.length) return
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }

  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (!busy && event.target === event.currentTarget) onCancel() }}><div ref={dialogRef} className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="confirm-title" aria-describedby="confirm-description" onKeyDown={handleKeyDown}><div className="dialog-icon"><Trash2 size={18} /></div><h2 id="confirm-title">{title}</h2><p id="confirm-description">{description || `将永久删除本机保存的 ${count} 条通知记录，此操作无法撤销。`}</p><div><button ref={cancelRef} className="button" disabled={busy} onClick={onCancel}>取消</button><button className="button danger" disabled={busy} onClick={onConfirm}>{busy ? '正在处理' : confirmLabel}</button></div></div></div>
}
