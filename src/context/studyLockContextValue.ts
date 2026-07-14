import { createContext, useContext } from 'react'
import type { StudyLockContextType } from './StudyLockContext'

export const StudyLockContext = createContext<StudyLockContextType | null>(null)

export function useStudyLock() {
  const context = useContext(StudyLockContext)
  if (!context) throw new Error('useStudyLock must be used within a StudyLockProvider')
  return context
}