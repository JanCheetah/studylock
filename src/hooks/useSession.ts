import { useState, useEffect } from 'react'
import type { Mode, StudyItem, Rating, SessionResult, StudyDocument, Step } from '../types'
import { safeParse, saveJson, storageKeys } from '../lib/storage'
import { selectSessionItems, nextDueDate, calculateReadiness } from '../lib/studyEngine'
import { persistRepositoryWrite } from '../lib/persist'

export function useSession(
  step: Step,
  setStep: (step: Step) => void,
  activeDocument: StudyDocument | null,
  setDocuments: React.Dispatch<React.SetStateAction<StudyDocument[]>>,
  profileMinutes: number
) {
  const [mode, setMode] = useState<Mode>('recall')
  const [items, setItems] = useState<StudyItem[]>([])
  const [currentIndex, setCurrentIndex] = useState(0)
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [ratings, setRatings] = useState<Record<string, Rating>>({})
  const [blockedReason, setBlockedReason] = useState('')
  const [blockerCount, setBlockerCount] = useState(0)
  const [startedAt, setStartedAt] = useState<number | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const [results, setResults] = useState<SessionResult[]>(() => safeParse(storageKeys.results, []))
  const [sessionMinutes, setSessionMinutes] = useState(25)

  useEffect(() => saveJson(storageKeys.results, results), [results])

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(interval)
  }, [])

  const id = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`

  const startSession = (selectedMode: Mode, targetItems: number, panicMinutes?: number) => {
    const doc = activeDocument
    if (!doc) {
      setStep('material')
      return
    }
    const sessionItems = selectSessionItems(doc, selectedMode, targetItems)
    setMode(selectedMode)
    setSessionMinutes(panicMinutes ? Math.max(profileMinutes, panicMinutes) : profileMinutes)
    setItems(sessionItems)
    setCurrentIndex(0)
    setAnswers({})
    setRatings({})
    setBlockedReason('')
    setBlockerCount(0)
    setStartedAt(Date.now())
    setStep('session')
  }

  const startPanicSession = () => {
    startSession('exam', 12, 50)
  }

  const rateItem = (itemId: string, rating: Rating) => {
    setRatings((prev) => ({ ...prev, [itemId]: rating }))
    const updatedItems = activeDocument?.items.map((item) => item.id === itemId ? { ...item, ...nextDueDate(item, rating) } : item)
    setDocuments((prev) => prev.map((doc) => ({
      ...doc,
      items: doc.items.map((item) => item.id === itemId ? { ...item, ...nextDueDate(item, rating) } : item),
    })))
    if (activeDocument && updatedItems) persistRepositoryWrite((repository) => repository.saveStudyItems(activeDocument.id, updatedItems))
  }

  const registerBlocker = (reason: string) => {
    setBlockedReason(reason)
    setBlockerCount((count) => count + 1)
  }

  const insertMiniAnswer = () => {
    const activeItem = items[currentIndex]
    if (!activeItem) return
    setAnswers((prev) => ({
      ...prev,
      [activeItem.id]: `${prev[activeItem.id] ?? ''}${prev[activeItem.id] ? '\n' : ''}Mein erster Ansatz: ${activeItem.topic} bedeutet hier, dass ...`,
    }))
  }

  const answeredCount = Object.values(answers).filter((value) => value.trim().length > 8).length
  const ratedCount = Object.keys(ratings).length
  const sessionScore = Math.round(((answeredCount + ratedCount) / Math.max(items.length * 2, 1)) * 100)
  const elapsedSeconds = startedAt ? Math.floor((now - startedAt) / 1000) : 0
  const remainingSeconds = Math.max(sessionMinutes * 60 - elapsedSeconds, 0)
  const progress = Math.round(((currentIndex + 1) / Math.max(items.length, 1)) * 100)

  const finishSession = () => {
    if (!activeDocument) return
    const result: SessionResult = {
      id: id('session'),
      date: new Date().toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' }),
      subject: activeDocument.subject,
      documentTitle: activeDocument.title,
      mode,
      score: sessionScore,
      minutes: sessionMinutes,
      answered: answeredCount,
      blockers: blockerCount,
      readinessAfter: calculateReadiness(activeDocument.items),
    }
    setStartedAt(null)
    setResults((prev) => [result, ...prev].slice(0, 10))
    persistRepositoryWrite((repository) => repository.saveSession(result))
    setStep('done')
  }

  return {
    step,
    setStep,
    mode,
    setMode,
    items,
    setItems,
    currentIndex,
    setCurrentIndex,
    answers,
    setAnswers,
    ratings,
    setRatings,
    blockedReason,
    setBlockedReason,
    blockerCount,
    setBlockerCount,
    startedAt,
    now,
    results,
    setResults,
    sessionMinutes,
    setSessionMinutes,
    startSession,
    startPanicSession,
    rateItem,
    registerBlocker,
    insertMiniAnswer,
    finishSession,
    answeredCount,
    ratedCount,
    sessionScore,
    elapsedSeconds,
    remainingSeconds,
    progress,
  }
}
