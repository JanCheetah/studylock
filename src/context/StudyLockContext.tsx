import React, { useState, useEffect } from 'react'
import { StudyLockContext } from './studyLockContextValue'
import { useDocuments } from '../hooks/useDocuments'
import { useExamProfile } from '../hooks/useExamProfile'
import { useSession } from '../hooks/useSession'
import { useCloudSync } from '../hooks/useCloudSync'
import { useStartupHydration } from '../hooks/startupHydration'
import { safeParse, saveJson, storageKeys } from '../lib/storage'
import { calculateReadiness, buildTopicStats, buildDailyPlan } from '../lib/studyEngine'
import type { Step } from '../types'

export type StudyLockContextType = ReturnType<typeof useStudyLockState>

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
    docManager.documents,
    docManager.setDocuments,
    examProfileManager.minutes
  )

  const hydrationManager = useStartupHydration({
    setDocuments: docManager.setDocuments,
    setExamProfiles: examProfileManager.setExamProfiles,
    setResults: sessionManager.setResults,
  })

  const cloudSyncManager = useCloudSync()

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

    // IndexedDB startup state (errors remain visible to the UI/context).
    ...hydrationManager,

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
