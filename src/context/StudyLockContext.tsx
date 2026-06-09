import React, { createContext, useContext, useState, useEffect } from 'react'
import { useDocuments } from '../hooks/useDocuments'
import { useExamProfile } from '../hooks/useExamProfile'
import { useSession } from '../hooks/useSession'
import { useCloudSync } from '../hooks/useCloudSync'
import { safeParse, saveJson, storageKeys } from '../lib/storage'
import { calculateReadiness, buildTopicStats, buildDailyPlan } from '../lib/studyEngine'
import type { Step } from '../types'

type StudyLockContextType = ReturnType<typeof useStudyLockState>

const StudyLockContext = createContext<StudyLockContextType | null>(null)

function useStudyLockState() {
  const [step, setStep] = useState<Step>('checkin')
  const [activeExamProfileId, setActiveExamProfileId] = useState<string | null>(() =>
    safeParse<string | null>(storageKeys.activeExamProfile, null)
  )

  useEffect(() => saveJson(storageKeys.activeExamProfile, activeExamProfileId), [activeExamProfileId])

  // Instantiate hooks in correct dependency order
  const docManager = useDocuments(setStep, activeExamProfileId)
  
  const examProfileManager = useExamProfile(
    setStep,
    docManager.subject,
    docManager.setSubject,
    docManager.activeDocument,
    docManager.setDocuments,
    activeExamProfileId,
    setActiveExamProfileId
  )

  const sessionManager = useSession(
    step,
    setStep,
    docManager.activeDocument,
    docManager.setDocuments,
    examProfileManager.minutes
  )

  const cloudSyncManager = useCloudSync(
    docManager.setDocuments,
    examProfileManager.setExamProfiles,
    sessionManager.setResults
  )

  // Derived states
  const dueCount = docManager.activeDocument
    ? docManager.activeDocument.items.filter((item) => new Date(item.dueAt).getTime() <= sessionManager.now).length
    : 0

  const readiness = docManager.activeDocument ? calculateReadiness(docManager.activeDocument.items) : 0
  const topicStats = docManager.activeDocument ? buildTopicStats(docManager.activeDocument.items) : []
  const weakestTopics = topicStats.slice(0, 3)
  
  const dailyPlan = buildDailyPlan(
    examProfileManager.activeExamProfile,
    dueCount,
    docManager.activeDocument?.items.length ?? 0
  )

  return {
    // Document hook state and methods
    ...docManager,

    // Exam profile hook state and methods
    ...examProfileManager,

    // Session hook state and methods
    ...sessionManager,

    // Cloud sync hook state and methods
    ...cloudSyncManager,

    // Derived states
    dueCount,
    readiness,
    topicStats,
    weakestTopics,
    dailyPlan,
  }
}

export function StudyLockProvider({ children }: { children: React.ReactNode }) {
  const state = useStudyLockState()
  return <StudyLockContext.Provider value={state}>{children}</StudyLockContext.Provider>
}

export function useStudyLock() {
  const context = useContext(StudyLockContext)
  if (!context) {
    throw new Error('useStudyLock must be used within a StudyLockProvider')
  }
  return context
}
