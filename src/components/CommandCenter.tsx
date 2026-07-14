import { useMemo } from 'react'
import { useStudyLock } from '../context/studyLockContextValue'
import { modeLabels, readinessLabel, calculateReadiness } from '../lib/studyEngine'
import { AuthPanel } from './AuthPanel'
import { AISettingsPanel } from './AISettingsPanel'
import type { ExamGoal } from '../types'

const goalLabels: Record<ExamGoal, string> = {
  bestehen: 'Nur bestehen',
  gut: '2,x schaffen',
  'sehr-gut': '1,x angreifen',
}

function ReadinessGauge({ value }: { value: number }) {
  const radius = 54
  const circumference = 2 * Math.PI * radius
  const offset = circumference - (value / 100) * circumference
  const color = value < 40 ? '#ff6b6b' : value < 70 ? '#fbbf24' : '#00d1b2'

  return (
    <div className="readiness-gauge">
      <svg viewBox="0 0 128 128" width="128" height="128">
        <circle
          cx="64" cy="64" r={radius}
          fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth="10"
        />
        <circle
          cx="64" cy="64" r={radius}
          fill="none" stroke={color} strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          transform="rotate(-90 64 64)"
          style={{ transition: 'stroke-dashoffset 1s ease, stroke 0.5s ease' }}
        />
      </svg>
      <div className="gauge-text">
        <strong>{value}%</strong>
        <span>{readinessLabel(value)}</span>
      </div>
    </div>
  )
}

function MiniChart({ results }: { results: { readinessAfter: number; date: string }[] }) {
  const data = useMemo(() => {
    return results.slice(0, 7).reverse()
  }, [results])

  if (data.length < 2) return null

  const max = 100
  const width = 300
  const height = 60
  const padding = 4

  const points = data.map((d, i) => {
    const x = padding + (i / (data.length - 1)) * (width - padding * 2)
    const y = height - padding - (d.readinessAfter / max) * (height - padding * 2)
    return `${x},${y}`
  })

  const fillPoints = `${padding},${height - padding} ${points.join(' ')} ${width - padding},${height - padding}`

  return (
    <div className="mini-chart">
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height}>
        <defs>
          <linearGradient id="chartGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#00d1b2" stopOpacity="0.3" />
            <stop offset="100%" stopColor="#00d1b2" stopOpacity="0" />
          </linearGradient>
        </defs>
        <polygon points={fillPoints} fill="url(#chartGrad)" />
        <polyline
          points={points.join(' ')}
          fill="none"
          stroke="#00d1b2"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {data.map((d, i) => {
          const x = padding + (i / (data.length - 1)) * (width - padding * 2)
          const y = height - padding - (d.readinessAfter / max) * (height - padding * 2)
          return <circle key={i} cx={x} cy={y} r="3" fill="#00d1b2" />
        })}
      </svg>
      <small className="muted">Readiness-Verlauf (letzte {data.length} Sessions)</small>
    </div>
  )
}

export function CommandCenter() {
  const {
    dailyPlan,
    readiness,
    dueCount,
    documents,
    repositoryStatus,
    activeExamProfile,
    weakestTopics,
    topicStats,
    activeDocumentId,
    setActiveDocumentId,
    setActiveExamProfileId,
    results,
  } = useStudyLock()

  // Calculate streak from results
  const streak = useMemo(() => {
    if (!results.length) return 0
    const dates = new Set(results.map((r) => {
      // Parse German date format "DD.MM.YYYY, HH:MM" to get just the date
      const parts = r.date.split(',')[0].split('.')
      if (parts.length === 3) return `${parts[2]}-${parts[1]}-${parts[0]}`
      return r.date.slice(0, 10)
    }))
    let count = 0
    const date = new Date()
    for (let i = 0; i < 365; i++) {
      const key = date.toISOString().slice(0, 10)
      if (dates.has(key)) {
        count++
      } else if (i > 0) {
        break
      }
      date.setDate(date.getDate() - 1)
    }
    return count
  }, [results])

  return (
    <aside className="panel sticky-panel">
      <h2>Command Center</h2>

      <ReadinessGauge value={readiness} />

      <div className="metric-row">
        <div>
          <strong>{dailyPlan.daysLeft ?? '—'}</strong>
          <span>Tage bis Klausur</span>
        </div>
        <div>
          <strong>{dueCount}</strong>
          <span>fällige Fragen</span>
        </div>
        <div>
          <strong>{documents.length}</strong>
          <span>Skripte</span>
        </div>
        <div>
          <strong>{streak > 0 ? `${streak}🔥` : '0'}</strong>
          <span>{streak === 1 ? 'Tag Streak' : 'Tage Streak'}</span>
        </div>
      </div>

      <MiniChart results={results} />

      <div className={`decision-box compact ${dailyPlan.priority}`}>
        <strong>Heute:</strong> {dailyPlan.message}
        <small>
          {dailyPlan.minutes} Min · {dailyPlan.targetItems} Items · {modeLabels[dailyPlan.mode]}
        </small>
      </div>

      <div className={`storage-card ${repositoryStatus.mode}`}>
        <span>Datenbasis</span>
        <strong>{repositoryStatus.label}</strong>
        <small>{repositoryStatus.detail}</small>
      </div>

      <AuthPanel />

      <AISettingsPanel />

      {activeExamProfile && (
        <div className="profile-card">
          <span>Klausurprofil</span>
          <strong>{activeExamProfile.subject}</strong>
          <small>
            {new Date(activeExamProfile.examDate).toLocaleDateString('de-DE')} · {goalLabels[activeExamProfile.goal]} · Gefühl{' '}
            {activeExamProfile.confidence}/5
          </small>
        </div>
      )}

      {topicStats.length > 0 && (
        <div className="topic-progress-section">
          <h3>Themen-Fortschritt</h3>
          {topicStats.map((topic) => (
            <div className="topic-progress" key={topic.topic}>
              <div className="topic-progress-header">
                <span>{topic.topic}</span>
                <span>{topic.readiness}%</span>
              </div>
              <div className="topic-bar">
                <span
                  className={`topic-bar-fill${topic.readiness < 40 ? ' critical' : topic.readiness < 70 ? ' warning' : ''}`}
                  style={{ width: `${topic.readiness}%`, transition: 'width 0.6s ease' }}
                />
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="weakness-box">
        <h3>Top Schwächen</h3>
        {weakestTopics.length === 0 && (
          <p className="muted">Noch keine Themen. Importiere Material und starte eine Session.</p>
        )}
        {weakestTopics.map((topic) => (
          <div className="weakness" key={topic.topic}>
            <span>{topic.topic}</span>
            <strong>{topic.readiness}%</strong>
            <small>
              {topic.again > 0
                ? 'Nochmal heute'
                : topic.hard > 0
                ? 'Schwer: gezielt wiederholen'
                : 'Noch offen'}
            </small>
          </div>
        ))}
      </div>

      <div className="doc-list">
        {documents.length === 0 && <p className="muted">Noch kein Dokument. Importiere dein erstes Skript.</p>}
        {documents.map((doc) => (
          <button
            key={doc.id}
            className={doc.id === activeDocumentId ? 'doc-card active' : 'doc-card'}
            onClick={() => {
              setActiveDocumentId(doc.id)
              if (doc.examProfileId) setActiveExamProfileId(doc.examProfileId)
            }}
          >
            <strong>{doc.title}</strong>
            <span>
              {doc.subject} · {doc.items.length} Items · {calculateReadiness(doc.items)}% bereit
              {doc.items.some((i) => i.aiGenerated) && ' · 🤖'}
            </span>
          </button>
        ))}
      </div>
    </aside>
  )
}

export default CommandCenter
