import { useState, useEffect, useRef } from 'react'
import type { Mode, StudyItem, Rating, SessionResult, StudyDocument, Step } from '../types'
import { selectSessionItems, nextDueDate, calculateReadiness, buildStudyAttempts, id } from '../lib/studyEngine'
import { getStudyRepository } from '../lib/repositories'
import type { StudyRepository } from '../lib/repositories/studyRepository'

export function applyFinalRatingsToDocuments(
  documents: StudyDocument[],
  documentId: string,
  ratings: Record<string, Rating>,
  schedule: typeof nextDueDate = nextDueDate,
): StudyDocument[] {
  return documents.map((document) => document.id !== documentId ? document : {
    ...document,
    items: document.items.map((item) => {
      const rating = ratings[item.id]
      return rating ? { ...item, ...schedule(item, rating) } : item
    }),
  })
}

export type CompletionCommand = {
  result: SessionResult
  attempts: ReturnType<typeof buildStudyAttempts>
  finalDocuments: StudyDocument[]
  finalItems: StudyItem[]
}

type CreateCompletionCommandInput = {
  activeDocument: StudyDocument
  documents: StudyDocument[]
  mode: Mode
  sessionScore: number
  sessionMinutes: number
  answeredCount: number
  blockerCount: number
  items: StudyItem[]
  answers: Record<string, string>
  ratings: Record<string, Rating>
  elapsedSeconds: number
  finishedAt: string
  sessionId: string
}

export function createCompletionCommand(input: CreateCompletionCommandInput): CompletionCommand {
  const finalDocuments = applyFinalRatingsToDocuments(
    input.documents,
    input.activeDocument.id,
    input.ratings,
  )
  const finalDocument = finalDocuments.find(({ id: documentId }) => documentId === input.activeDocument.id)!
  const attempts = buildStudyAttempts({
    sessionId: input.sessionId,
    items: input.items,
    answers: input.answers,
    ratings: input.ratings,
    elapsedSeconds: input.elapsedSeconds,
    now: input.finishedAt,
  })
  const attemptedIds = new Set(attempts.map((attempt) => attempt.studyItemId))
  const finalItems = finalDocument.items.filter((item) => attemptedIds.has(item.id))
  const result: SessionResult = {
    id: input.sessionId,
    date: input.finishedAt,
    documentId: input.activeDocument.id,
    subject: input.activeDocument.subject,
    documentTitle: input.activeDocument.title,
    mode: input.mode,
    score: input.sessionScore,
    minutes: input.sessionMinutes,
    answered: input.answeredCount,
    blockers: input.blockerCount,
    readinessAfter: calculateReadiness(finalDocument.items),
  }
  return { result, attempts, finalDocuments, finalItems }
}

export async function persistCompletedSession(
  repository: Pick<StudyRepository, 'completeSession'>,
  result: SessionResult,
  attempts: ReturnType<typeof buildStudyAttempts>,
  finalItems: StudyItem[],
): Promise<void> {
  const attemptedIds = new Set(attempts.map((attempt) => attempt.studyItemId))
  await repository.completeSession(result, attempts, finalItems.filter((item) => attemptedIds.has(item.id)))
}

export async function commitCompletionCommand(
  repository: Pick<StudyRepository, 'completeSession'>,
  command: CompletionCommand,
  publish: (completed: CompletionCommand) => void,
): Promise<void> {
  await persistCompletedSession(repository, command.result, command.attempts, command.finalItems)
  publish(command)
}

export function useSession(
  step: Step,
  setStep: (step: Step) => void,
  activeDocument: StudyDocument | null,
  documents: StudyDocument[],
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
  const [results, setResults] = useState<SessionResult[]>([])
  const [sessionMinutes, setSessionMinutes] = useState(25)
  const [isFinishing, setIsFinishing] = useState(false)
  const [sessionSaveError, setSessionSaveError] = useState('')
  const pendingCompletionRef = useRef<CompletionCommand | null>(null)
  const finishingRef = useRef(false)

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(interval)
  }, [])

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
    setSessionSaveError('')
    pendingCompletionRef.current = null
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

  const finishSession = async () => {
    if (!activeDocument || finishingRef.current) return

    const command = pendingCompletionRef.current ?? createCompletionCommand({
      activeDocument,
      documents,
      mode,
      sessionScore,
      sessionMinutes,
      answeredCount,
      blockerCount,
      items,
      answers,
      ratings,
      elapsedSeconds,
      finishedAt: new Date().toISOString(),
      sessionId: id('session'),
    })
    pendingCompletionRef.current = command
    finishingRef.current = true
    setIsFinishing(true)
    setSessionSaveError('')

    try {
      const repository = await getStudyRepository()
      await commitCompletionCommand(repository, command, (completed) => {
        setDocuments(completed.finalDocuments)
        setResults((prev) => [completed.result, ...prev].slice(0, 10))
        setStartedAt(null)
        pendingCompletionRef.current = null
        setStep('done')
      })
    } catch (error) {
      setSessionSaveError(
        error instanceof Error
          ? `Session konnte nicht gespeichert werden: ${error.message}`
          : 'Session konnte nicht gespeichert werden. Bitte erneut versuchen.',
      )
    } finally {
      finishingRef.current = false
      setIsFinishing(false)
    }
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
    isFinishing,
    sessionSaveError,
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
