import { useState, useEffect, useCallback, createContext, useContext } from 'react'

type ToastType = 'success' | 'error' | 'info' | 'warning'

type ToastItem = {
  id: number
  message: string
  type: ToastType
  exiting?: boolean
}

type ToastContextType = {
  addToast: (message: string, type?: ToastType) => void
}

const ToastContext = createContext<ToastContextType>({ addToast: () => {} })

export function useToast() {
  return useContext(ToastContext)
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

/**
 * Standalone hook: auto-shows a toast when deps change.
 */
export function useAutoToast(message: string | null, type: ToastType = 'info') {
  const { addToast } = useToast()
  useEffect(() => {
    if (message) addToast(message, type)
  }, [message, type, addToast])
}
