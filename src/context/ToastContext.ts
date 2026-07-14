import { createContext, useContext, useEffect } from 'react'

export type ToastType = 'success' | 'error' | 'info' | 'warning'

type ToastContextType = {
  addToast: (message: string, type?: ToastType) => void
}

export const ToastContext = createContext<ToastContextType>({ addToast: () => {} })

export function useToast() {
  return useContext(ToastContext)
}

/** Auto-shows a toast when the supplied message changes. */
export function useAutoToast(message: string | null, type: ToastType = 'info') {
  const { addToast } = useToast()
  useEffect(() => {
    if (message) addToast(message, type)
  }, [message, type, addToast])
}