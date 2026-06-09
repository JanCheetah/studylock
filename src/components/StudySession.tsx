import { useState, useEffect, useCallback } from 'react'
import { useStudyLock } from '../context/StudyLockContext'
import { modeLabels } from '../lib/studyEngine'
import { evaluateAnswer, generateHint, isAIAvailable } from '../lib/aiStudyEngine'

const blockerActions: Record<string, string> = {
  'Zu schwer': 'Beantworte nur den ersten Teilsatz. Eine halbe Antwort zählt mehr als Flucht.',
  'Keine Motivation': '2-Minuten-Regel: Schreibe einen Mini-Satz, dann darfst du neu entscheiden.',
  'Verstehe es nicht': 'Markiere die unklaren Begriffe und formuliere eine konkrete Rückfrage.',
  Ablenkung: 'Timer läuft weiter. Tab nicht wechseln. Schreibe den nächsten Satz.',
}

type AIFeedback = {
  score: number
  rating: 'again' | 'hard' | 'good'
  feedback: string
  strengths: string[]
  weaknesses: string[]
  suggestion: string
}

export function StudySession() {
  const {
    mode,
    activeDocument,
    remainingSeconds,
    progress,
    items,
    currentIndex,
    setCurrentIndex,
    answers,
    setAnswers,
    ratings,
    rateItem,
    blockedReason,
    registerBlocker,
    insertMiniAnswer,
    finishSession,
  } = useStudyLock()

  const [aiFeedback, setAiFeedback] = useState<AIFeedback | null>(null)
  const [isEvaluating, setIsEvaluating] = useState(false)
  const [hint, setHint] = useState<string | null>(null)
  const [isLoadingHint, setIsLoadingHint] = useState(false)
  const [timerWarning, setTimerWarning] = useState(false)

  const activeItem = items[currentIndex]
  const hasAI = isAIAvailable()

  // Reset AI state when moving to a different question
  useEffect(() => {
    setAiFeedback(null)
    setHint(null)
  }, [currentIndex])

  // Timer warning when < 60 seconds
  useEffect(() => {
    setTimerWarning(remainingSeconds > 0 && remainingSeconds <= 60)
  }, [remainingSeconds])

  const handleAIEvaluate = useCallback(async () => {
    if (!activeItem || !activeDocument) return
    const userAnswer = answers[activeItem.id] ?? ''
    if (userAnswer.trim().length < 10) return

    setIsEvaluating(true)
    try {
      const result = await evaluateAnswer(
        activeItem.question,
        activeItem.answer,
        userAnswer,
        activeDocument.subject
      )
      setAiFeedback(result)
      // Auto-apply AI rating
      rateItem(activeItem.id, result.rating)
    } catch (error) {
      console.warn('AI evaluation failed:', error)
    } finally {
      setIsEvaluating(false)
    }
  }, [activeItem, activeDocument, answers, rateItem])

  const handleGetHint = useCallback(async () => {
    if (!activeItem || !activeDocument) return
    setIsLoadingHint(true)
    try {
      const h = await generateHint(activeItem.question, activeItem.answer, activeDocument.subject)
      setHint(h)
    } catch (error) {
      setHint('Hinweis konnte nicht geladen werden.')
    } finally {
      setIsLoadingHint(false)
    }
  }, [activeItem, activeDocument])

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Don't intercept when typing in textarea
      if (e.target instanceof HTMLTextAreaElement || e.target instanceof HTMLInputElement) return

      if (e.key === 'ArrowRight' || e.key === 'n') {
        e.preventDefault()
        if (currentIndex < items.length - 1) setCurrentIndex((prev) => prev + 1)
      } else if (e.key === 'ArrowLeft' || e.key === 'p') {
        e.preventDefault()
        if (currentIndex > 0) setCurrentIndex((prev) => prev - 1)
      } else if (e.key === '1' && activeItem) {
        e.preventDefault()
        rateItem(activeItem.id, 'again')
      } else if (e.key === '2' && activeItem) {
        e.preventDefault()
        rateItem(activeItem.id, 'hard')
      } else if (e.key === '3' && activeItem) {
        e.preventDefault()
        rateItem(activeItem.id, 'good')
      } else if (e.key === 'h' && hasAI) {
        e.preventDefault()
        handleGetHint()
      } else if (e.key === 'e' && hasAI) {
        e.preventDefault()
        handleAIEvaluate()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [currentIndex, items.length, activeItem, hasAI, rateItem, setCurrentIndex, handleGetHint, handleAIEvaluate])

  if (!activeItem || !activeDocument) return null

  const formatTime = (seconds: number) =>
    `${Math.floor(seconds / 60)
      .toString()
      .padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`

  const canShowExamRating =
    mode !== 'exam' || (activeItem && (answers[activeItem.id] ?? '').trim().length >= 30)

  return (
    <div className="flow session-screen">
      <div className="session-top">
        <span className="step-label">
          {modeLabels[mode]} · {activeDocument.title}
        </span>
        <span className={`timer${timerWarning ? ' timer-warning' : ''}`}>
          {formatTime(remainingSeconds)}
        </span>
      </div>
      <div className="progressbar">
        <span style={{ width: `${progress}%`, transition: 'width 0.3s ease' }} />
      </div>
      <div className="question-meta">
        <span>{activeItem.type}</span>
        <span>{activeItem.difficulty}</span>
        <span>{activeItem.topic}</span>
        <span>{activeItem.aiGenerated ? '🤖 AI' : '📝'}</span>
        <span>{currentIndex + 1}/{items.length}</span>
      </div>
      <h2>{activeItem.question}</h2>

      {hint && (
        <div className="hint-box">
          <strong>💡 Hinweis:</strong> {hint}
        </div>
      )}

      <textarea
        className="answer-box"
        value={answers[activeItem.id] ?? ''}
        onChange={(event) =>
          setAnswers((prev) => ({ ...prev, [activeItem.id]: event.target.value }))
        }
        placeholder="Antworte aus dem Kopf. Erst danach Musterlösung öffnen."
      />

      {hasAI && !aiFeedback && (
        <div className="ai-actions-row">
          <button
            className="secondary mini"
            onClick={handleAIEvaluate}
            disabled={isEvaluating || (answers[activeItem.id] ?? '').trim().length < 10}
          >
            {isEvaluating ? '🤖 Bewerte...' : '🤖 AI Bewertung (E)'}
          </button>
          <button
            className="secondary mini"
            onClick={handleGetHint}
            disabled={isLoadingHint || !!hint}
          >
            {isLoadingHint ? '💡 Lade...' : '💡 Hinweis (H)'}
          </button>
        </div>
      )}

      {aiFeedback && (
        <div className="ai-feedback-panel">
          <div className="ai-feedback-header">
            <strong>🤖 AI Bewertung: {aiFeedback.score}%</strong>
            <span className={`ai-rating-badge ${aiFeedback.rating}`}>
              {aiFeedback.rating === 'good' ? '✓ Sitzt' : aiFeedback.rating === 'hard' ? '~ Teilweise' : '✕ Nochmal'}
            </span>
          </div>
          <p>{aiFeedback.feedback}</p>
          {aiFeedback.strengths.length > 0 && (
            <div className="ai-feedback-section">
              <strong>✓ Stärken:</strong>
              <ul>{aiFeedback.strengths.map((s, i) => <li key={i}>{s}</li>)}</ul>
            </div>
          )}
          {aiFeedback.weaknesses.length > 0 && (
            <div className="ai-feedback-section">
              <strong>✕ Lücken:</strong>
              <ul>{aiFeedback.weaknesses.map((w, i) => <li key={i}>{w}</li>)}</ul>
            </div>
          )}
          {aiFeedback.suggestion && (
            <div className="ai-feedback-suggestion">
              <strong>💡 Tipp:</strong> {aiFeedback.suggestion}
            </div>
          )}
        </div>
      )}

      <details className="solution">
        <summary>Musterlösung / Quelle ansehen</summary>
        <p>{activeItem.answer}</p>
      </details>

      {!canShowExamRating && (
        <p className="nudge">Prüfungsmodus: erst mindestens 30 Zeichen selbst antworten, dann bewerten.</p>
      )}
      {canShowExamRating && !aiFeedback && (
        <div className="rating-row">
          <button
            className={ratings[activeItem.id] === 'again' ? 'rating active bad' : 'rating bad'}
            onClick={() => rateItem(activeItem.id, 'again')}
          >
            {mode === 'exam' ? '0 Punkte (1)' : 'Nochmal (1)'}
          </button>
          <button
            className={ratings[activeItem.id] === 'hard' ? 'rating active' : 'rating'}
            onClick={() => rateItem(activeItem.id, 'hard')}
          >
            {mode === 'exam' ? 'Teilweise (2)' : 'Schwer (2)'}
          </button>
          <button
            className={ratings[activeItem.id] === 'good' ? 'rating active good' : 'rating good'}
            onClick={() => rateItem(activeItem.id, 'good')}
          >
            {mode === 'exam' ? 'Vollständig (3)' : 'Sitzt (3)'}
          </button>
        </div>
      )}

      <div className="blocker-box">
        <strong>Blockiert?</strong>
        <div className="chips">
          {Object.keys(blockerActions).map((reason) => (
            <button key={reason} className="chip" onClick={() => registerBlocker(reason)}>
              {reason}
            </button>
          ))}
        </div>
        {blockedReason && <p className="nudge">{blockerActions[blockedReason]}</p>}
        <button className="secondary mini" onClick={insertMiniAnswer}>
          Miniantwort übernehmen
        </button>
      </div>

      <div className="session-actions">
        <button
          className="secondary"
          disabled={currentIndex === 0}
          onClick={() => setCurrentIndex((prev) => Math.max(prev - 1, 0))}
        >
          ← Zurück (P)
        </button>
        {currentIndex < items.length - 1 ? (
          <button onClick={() => setCurrentIndex((prev) => prev + 1)}>Nächste Frage (N) →</button>
        ) : (
          <button onClick={finishSession}>Session abschließen ✓</button>
        )}
      </div>

      <div className="keyboard-hints">
        <span>1/2/3 = Bewerten</span>
        <span>←/→ = Navigation</span>
        {hasAI && <span>H = Hinweis</span>}
        {hasAI && <span>E = AI Bewertung</span>}
      </div>
    </div>
  )
}

export default StudySession
