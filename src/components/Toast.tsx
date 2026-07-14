import { useState, useCallback } from 'react'
import { ToastContext } from '../context/ToastContext'
import type { ToastType } from '../context/ToastContext'


type ToastItem = {
  id: number
  message: string
  type: ToastType
  exiting?: boolean
}


let toastCounter = 0

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([])

  const addToast = useCallback((message: string, type: ToastType = 'info') => {
    const id = ++toastCounter
    setToasts((prev) => [...prev, { id, message, type }])
    setTimeout(() => {
      setToasts((prev) => prev.map((t) => t.id === id ? { ...t, exiting: true } : t))
      setTimeout(() => {
        setToasts((prev) => prev.filter((t) => t.id !== id))
      }, 300)
    }, 4000)
  }, [])

  return (
    <ToastContext.Provider value={{ addToast }}>
      {children}
      <div className="toast-container">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`toast toast-${toast.type}${toast.exiting ? ' toast-exit' : ''}`}
          >
            <span className="toast-icon">
              {toast.type === 'success' ? '✓' : toast.type === 'error' ? '✕' : toast.type === 'warning' ? '⚠' : 'ℹ'}
            </span>
            {toast.message}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}
