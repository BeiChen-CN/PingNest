import { create } from 'zustand'

export type ToastType = 'success' | 'error' | 'info'

export interface ToastItem {
  id: string
  message: string
  type: ToastType
}

interface ToastState {
  toasts: ToastItem[]
  push: (message: string, type?: ToastType) => void
  remove: (id: string) => void
}

let seq = 0

export const useToastStore = create<ToastState>((set) => ({
  toasts: [],
  push: (message, type = 'info') => {
    const id = 'toast_' + Date.now() + '_' + (++seq)
    set((state) => ({ toasts: [...state.toasts, { id, message, type }] }))
    window.setTimeout(() => {
      set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }))
    }, 2200)
  },
  remove: (id) => set((state) => ({ toasts: state.toasts.filter((t) => t.id !== id) }))
}))

export const toast = (message: string, type: ToastType = 'info'): void => {
  useToastStore.getState().push(message, type)
}
