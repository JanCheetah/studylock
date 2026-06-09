import { useState, useEffect } from 'react'
import type { ExamProfile, ExamGoal, Confidence, StudyDocument, Step } from '../types'
import { safeParse, saveJson, storageKeys } from '../lib/storage'
import { persistRepositoryWrite } from '../lib/persist'

const todayPlus = (days: number) => {
  const date = new Date()
  date.setDate(date.getDate() + days)
  return date.toISOString().slice(0, 10)
}

export function useExamProfile(
  setStep: (step: Step) => void,
  subject: string,
  setSubject: (subject: string) => void,
  activeDocument: StudyDocument | null,
  setDocuments: React.Dispatch<React.SetStateAction<StudyDocument[]>>,
  activeExamProfileId: string | null,
  setActiveExamProfileId: (id: string | null) => void
) {
  const [examProfiles, setExamProfiles] = useState<ExamProfile[]>(() => safeParse(storageKeys.examProfiles, []))
  const [examDate, setExamDate] = useState(todayPlus(21))
  const [examGoal, setExamGoal] = useState<ExamGoal>('bestehen')
  const [confidence, setConfidence] = useState<Confidence>(2)
  const [minutes, setMinutes] = useState(25)

  useEffect(() => saveJson(storageKeys.examProfiles, examProfiles), [examProfiles])

  const id = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`

  const activeExamProfile = examProfiles.find((profile) => profile.id === (activeDocument?.examProfileId ?? activeExamProfileId)) ?? null

  const saveExamProfile = () => {
    const profileId = activeExamProfile?.id ?? id('exam')
    const profile: ExamProfile = {
      id: profileId,
      subject,
      examDate,
      dailyMinutes: minutes,
      goal: examGoal,
      confidence,
      createdAt: activeExamProfile?.createdAt ?? new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    }
    setExamProfiles((prev) => [profile, ...prev.filter((item) => item.id !== profileId)])
    setActiveExamProfileId(profileId)
    setDocuments((prev) =>
      prev.map((doc) =>
        doc.id === activeDocument?.id
          ? { ...doc, subject, examProfileId: profileId, updatedAt: new Date().toISOString() }
          : doc
      )
    )
    persistRepositoryWrite(async (repository) => {
      await repository.saveExamProfile(profile)
      if (activeDocument) {
        await repository.saveDocument({
          ...activeDocument,
          subject,
          examProfileId: profileId,
          updatedAt: new Date().toISOString(),
        })
      }
    })
    setStep('checkin')
  }

  const hydrateExamForm = () => {
    setSubject(activeDocument?.subject ?? subject)
    if (activeExamProfile) {
      setExamDate(activeExamProfile.examDate)
      setExamGoal(activeExamProfile.goal)
      setConfidence(activeExamProfile.confidence)
      setMinutes(activeExamProfile.dailyMinutes)
    }
    setStep('exam-setup')
  }

  return {
    examProfiles,
    setExamProfiles,
    activeExamProfileId,
    setActiveExamProfileId,
    activeExamProfile,
    examDate,
    setExamDate,
    examGoal,
    setExamGoal,
    confidence,
    setConfidence,
    minutes,
    setMinutes,
    saveExamProfile,
    hydrateExamForm,
  }
}
