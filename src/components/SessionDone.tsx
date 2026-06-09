import { useState, useEffect } from 'react'
import { useStudyLock } from '../context/StudyLockContext'
import { modeLabels, readinessLabel } from '../lib/studyEngine'

function AnimatedNumber({ target, suffix = '' }: { target: number; suffix?: string }) {
  const [value, setValue] = useState(0)

  useEffect(() => {
    const duration = 1200
    const start = performance.now()
    const step = (now: number) => {
      const elapsed = now - start
      const progress = Math.min(elapsed / duration, 1)
      // Ease-out cubic
      const eased = 1 - Math.pow(1 - progress, 3)
      setValue(Math.round(eased * target))
      if (progress < 1) requestAnimationFrame(step)
    }
    requestAnimationFrame(step)
  }, [target])

  return <span className="animated-number">{value}{suffix}</span>
}

export function SessionDone() {
  const {
    activeDocument,
    sessionScore,
    readiness,
    answeredCount,
    ratedCount,
    blockerCount,
    weakestTopics,
    startSession,
    exportAnki,
    exportMarkdown,
    results,
    dailyPlan,
    setStep,
  } = useStudyLock()

  if (!activeDocument) return null

  // Compare to previous session
  const previousResult = results.length > 1 ? results[1] : null
  const readinessChange = previousResult ? readiness - previousResult.readinessAfter : null
  const scoreChange = previousResult ? sessionScore - previousResult.score : null

  return (
    <div className="flow done-screen">
      <span className="step-label">4 / Auswertung</span>

      <div className="done-hero">
        <div className="done-score-circle">
          <AnimatedNumber target={sessionScore} suffix="%" />
          <span>Session Score</span>
        </div>
        <div className="done-score-circle">
          <AnimatedNumber target={readiness} suffix="%" />
          <span>Readiness</span>
        </div>
      </div>

      {(readinessChange !== null || scoreChange !== null) && (
        <div className="done-comparison">
          {readinessChange !== null && (
            <span className={readinessChange >= 0 ? 'positive' : 'negative'}>
              {readinessChange >= 0 ? '↑' : '↓'} {Math.abs(readinessChange)}% Readiness vs. letzte Session
            </span>
          )}
          {scoreChange !== null && (
            <span className={scoreChange >= 0 ? 'positive' : 'negative'}>
              {scoreChange >= 0 ? '↑' : '↓'} {Math.abs(scoreChange)}% Score vs. letzte Session
            </span>
          )}
        </div>
      )}

      <p>
        {answeredCount} Antworten, {ratedCount} Bewertungen, {blockerCount} Blocker überwunden.{' '}
        {readinessLabel(readiness)}.
      </p>

      {weakestTopics[0] && (
        <div className="decision-box">
          <strong>Nächster Hebel:</strong> {weakestTopics[0].topic} gezielt wiederholen.
          {weakestTopics[0].readiness < 40 && (
            <small>Readiness nur {weakestTopics[0].readiness}% – hier ist der größte Hebel.</small>
          )}
        </div>
      )}

      <div className="hero-actions">
        <button onClick={() => startSession('review', dailyPlan.targetItems)}>
          Direkt Review starten
        </button>
        <button className="secondary" onClick={() => setStep('checkin')}>
          Zum Dashboard
        </button>
        <button className="secondary" onClick={() => exportAnki()}>
          Anki CSV
        </button>
        <button className="secondary" onClick={() => exportMarkdown()}>
          Markdown
        </button>
      </div>

      {results.length > 0 && (
        <>
          <h3>Session-Historie</h3>
          <div className="recap-grid">
            {results.map((result) => (
              <div className="recap" key={result.id}>
                <strong>{result.documentTitle}</strong>
                <span>
                  {modeLabels[result.mode]} · {result.minutes} Min · {result.score}%
                </span>
                <small>
                  {result.date} · Readiness {result.readinessAfter}% · Blocker {result.blockers}
                </small>
              </div>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

export default SessionDone
