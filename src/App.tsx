import { useEffect, useMemo, useState } from 'react'
import './App.css'

type Mode = 'plan' | 'recall' | 'deepwork' | 'review' | 'exam'
type Step = 'checkin' | 'material' | 'session' | 'done'

type StudyItem = {
  id: number
  question: string
  answer: string
  source: string
  difficulty: 'leicht' | 'mittel' | 'hart'
}

type SessionResult = {
  date: string
  subject: string
  mode: Mode
  score: number
  minutes: number
}

const modeLabels: Record<Mode, string> = {
  plan: 'Plan retten',
  recall: 'Active Recall',
  deepwork: 'Deep Work',
  review: 'Review',
  exam: 'Exam Mode',
}

const starterItems: StudyItem[] = [
  {
    id: 1,
    question: 'Erkläre das Thema in drei Sätzen, ohne ins Skript zu schauen.',
    answer: 'Ziel ist aktive Reproduktion: erst abrufen, dann korrigieren. Nicht passiv lesen.',
    source: 'Framework-Regel',
    difficulty: 'mittel',
  },
  {
    id: 2,
    question: 'Was ist die wichtigste Formel/Regel aus diesem Abschnitt?',
    answer: 'Extrahiere die zentrale Regel und formuliere sie als Wenn-dann-Satz.',
    source: 'KI-Extraktion Platzhalter',
    difficulty: 'leicht',
  },
  {
    id: 3,
    question: 'Welche typische Klausurfalle könnte hier abgefragt werden?',
    answer: 'Suche nach Begriffen, die leicht verwechselt werden, und baue eine Kontrastfrage.',
    source: 'Klausurstrategie',
    difficulty: 'hart',
  },
]

function createItemsFromMaterial(material: string, subject: string): StudyItem[] {
  const clean = material.replace(/\s+/g, ' ').trim()
  if (!clean) return starterItems

  const sentences = clean
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 30)
    .slice(0, 6)

  const chunks = sentences.length ? sentences : [clean.slice(0, 220)]

  return chunks.map((chunk, index) => {
    const terms = chunk
      .split(' ')
      .filter((word) => word.length > 7)
      .slice(0, 3)
      .join(', ')

    return {
      id: index + 1,
      question:
        index % 3 === 0
          ? `Erkläre für ${subject}: ${chunk.slice(0, 95)}…`
          : index % 3 === 1
            ? `Welche 2 Prüfungsfragen könnten aus diesem Abschnitt entstehen? (${terms || 'Kernbegriffe'})`
            : `Formuliere eine Karteikarte zu: ${terms || chunk.slice(0, 60)}`,
      answer: chunk,
      source: `Material Abschnitt ${index + 1}`,
      difficulty: index % 3 === 2 ? 'hart' : index % 3 === 1 ? 'mittel' : 'leicht',
    }
  })
}

function App() {
  const [step, setStep] = useState<Step>('checkin')
  const [subject, setSubject] = useState('Rechnungswesen')
  const [minutes, setMinutes] = useState(25)
  const [mode, setMode] = useState<Mode>('recall')
  const [material, setMaterial] = useState('')
  const [items, setItems] = useState<StudyItem[]>(starterItems)
  const [currentIndex, setCurrentIndex] = useState(0)
  const [answers, setAnswers] = useState<Record<number, string>>({})
  const [blockedReason, setBlockedReason] = useState('')
  const [results, setResults] = useState<SessionResult[]>(() => {
    const saved = localStorage.getItem('studylock-results')
    return saved ? JSON.parse(saved) : []
  })

  useEffect(() => {
    localStorage.setItem('studylock-results', JSON.stringify(results))
  }, [results])

  const activeItem = items[currentIndex]
  const progress = Math.round(((currentIndex + 1) / items.length) * 100)
  const answeredCount = Object.values(answers).filter((value) => value.trim().length > 10).length
  const score = Math.round((answeredCount / Math.max(items.length, 1)) * 100)

  const nextAction = useMemo(() => {
    if (mode === 'recall') return 'Frage beantworten, dann erst Musterlösung ansehen.'
    if (mode === 'deepwork') return 'Timer starten, eine Aufgabe lösen, keine Navigation.'
    if (mode === 'review') return 'Nur fällige Schwächen wiederholen, keine neuen Notizen.'
    if (mode === 'exam') return 'Unter Zeitdruck antworten, keine Hilfen.'
    return 'Planung stoppen und in eine 10-Minuten-Session wechseln.'
  }, [mode])

  function startSession() {
    const generated = createItemsFromMaterial(material, subject)
    setItems(generated)
    setCurrentIndex(0)
    setAnswers({})
    setBlockedReason('')
    setStep('session')
  }

  function finishSession() {
    const result: SessionResult = {
      date: new Date().toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' }),
      subject,
      mode,
      score,
      minutes,
    }
    setResults((prev) => [result, ...prev].slice(0, 5))
    setStep('done')
  }

  return (
    <main className="app-shell">
      <section className="hero-card">
        <div className="eyebrow">StudyLock MVP · Anti-Prokrastinations-Lernsystem</div>
        <h1>Öffnen. Entscheiden. Lernen. Kein Dashboard-Flüchten.</h1>
        <p>
          Ein geführter Lernmodus für Studenten: Material rein, eine nächste Aktion raus. Fokus auf Active Recall,
          Timer, Blocker-Hilfe und Session-Auswertung.
        </p>
        <div className="hero-actions">
          <button onClick={() => setStep('checkin')}>Neue Session starten</button>
          <button className="secondary" onClick={() => setStep('material')}>Material einfügen</button>
        </div>
      </section>

      <section className="grid">
        <aside className="panel sticky-panel">
          <h2>Produktivitäts-Regeln</h2>
          <ul className="rules">
            <li>Eine Session = eine nächste Aktion.</li>
            <li>Erst abrufen, dann lesen.</li>
            <li>Planung endet nach 5 Minuten.</li>
            <li>Blockiert? Kleineren Schritt wählen, nicht abbrechen.</li>
            <li>Am Ende wird die nächste Session erzeugt.</li>
          </ul>
          <div className="metric-row">
            <div><strong>{results.length}</strong><span>Sessions</span></div>
            <div><strong>{results[0]?.score ?? 0}%</strong><span>letzter Score</span></div>
          </div>
        </aside>

        <section className="panel work-panel">
          {step === 'checkin' && (
            <div className="flow">
              <span className="step-label">1 / Check-in</span>
              <h2>Womit wirst du jetzt produktiv?</h2>
              <div className="form-grid">
                <label>
                  Fach / Modul
                  <input value={subject} onChange={(event) => setSubject(event.target.value)} />
                </label>
                <label>
                  Zeitcommitment
                  <select value={minutes} onChange={(event) => setMinutes(Number(event.target.value))}>
                    <option value={10}>10 Minuten Einstieg</option>
                    <option value={25}>25 Minuten Fokus</option>
                    <option value={50}>50 Minuten Deep Work</option>
                    <option value={90}>90 Minuten Klausurblock</option>
                  </select>
                </label>
              </div>
              <div className="mode-grid">
                {(Object.keys(modeLabels) as Mode[]).map((key) => (
                  <button key={key} className={mode === key ? 'mode active' : 'mode'} onClick={() => setMode(key)}>
                    <strong>{modeLabels[key]}</strong>
                    <span>{key === 'recall' ? 'Abfragen statt lesen' : key === 'exam' ? 'Klausur-Simulation' : key === 'plan' ? 'Planungsstopp' : key === 'deepwork' ? 'Eine Aufgabe tief' : 'Schwächen wiederholen'}</span>
                  </button>
                ))}
              </div>
              <div className="decision-box">
                <strong>Nächste Aktion:</strong> {nextAction}
              </div>
              <button onClick={() => setStep('material')}>Weiter: Material / Session bauen</button>
            </div>
          )}

          {step === 'material' && (
            <div className="flow">
              <span className="step-label">2 / Material</span>
              <h2>Skript, Folien oder Stichpunkte einfügen</h2>
              <p className="muted">
                MVP ohne Backend: Hier wird lokal aus deinem Text eine geführte Session generiert. Später ersetzen wir das
                durch echten PDF-Upload + KI-Extraktion.
              </p>
              <textarea
                value={material}
                onChange={(event) => setMaterial(event.target.value)}
                placeholder="Beispiel: Aktivkonten mehren sich im Soll, Passivkonten im Haben. Die Bilanz zeigt Vermögen und Kapital..."
              />
              <div className="hero-actions">
                <button onClick={startSession}>Session erzwingen</button>
                <button className="secondary" onClick={() => { setMaterial(''); startSession() }}>Ohne Material Demo starten</button>
              </div>
            </div>
          )}

          {step === 'session' && activeItem && (
            <div className="flow session-screen">
              <div className="session-top">
                <span className="step-label">{modeLabels[mode]} · {minutes} Min · {subject}</span>
                <span className="progress">{progress}%</span>
              </div>
              <div className="progressbar"><span style={{ width: `${progress}%` }} /></div>
              <h2>{activeItem.question}</h2>
              <textarea
                className="answer-box"
                value={answers[activeItem.id] ?? ''}
                onChange={(event) => setAnswers((prev) => ({ ...prev, [activeItem.id]: event.target.value }))}
                placeholder="Antworte aus dem Kopf. Nicht ins Material schauen. Danach Musterlösung vergleichen."
              />
              <details className="solution">
                <summary>Musterlösung / Quelle ansehen</summary>
                <p>{activeItem.answer}</p>
                <small>{activeItem.source} · Schwierigkeit: {activeItem.difficulty}</small>
              </details>
              <div className="blocker-box">
                <strong>Blockiert?</strong>
                <div className="chips">
                  {['Zu schwer', 'Keine Motivation', 'Verstehe es nicht', 'Ablenkung'].map((reason) => (
                    <button key={reason} className="chip" onClick={() => setBlockedReason(reason)}>{reason}</button>
                  ))}
                </div>
                {blockedReason && <p className="nudge">{blockedReason}: Dann mach es kleiner. Schreibe nur den ersten Satz oder ein Beispiel. Nicht abbrechen.</p>}
              </div>
              <div className="session-actions">
                <button className="secondary" disabled={currentIndex === 0} onClick={() => setCurrentIndex((prev) => Math.max(prev - 1, 0))}>Zurück</button>
                {currentIndex < items.length - 1 ? (
                  <button onClick={() => setCurrentIndex((prev) => prev + 1)}>Nächste Frage</button>
                ) : (
                  <button onClick={finishSession}>Session abschließen</button>
                )}
              </div>
            </div>
          )}

          {step === 'done' && (
            <div className="flow done-screen">
              <span className="step-label">4 / Review</span>
              <h2>Session abgeschlossen: {score}% produktiv beantwortet</h2>
              <p>
                Nächster sinnvoller Schritt: 15 Minuten Review für die schwächsten Fragen. Nicht neu planen — direkt wieder starten.
              </p>
              <div className="recap-grid">
                {results.map((result) => (
                  <div className="recap" key={`${result.date}-${result.subject}`}>
                    <strong>{result.subject}</strong>
                    <span>{modeLabels[result.mode]} · {result.minutes} Min · {result.score}%</span>
                    <small>{result.date}</small>
                  </div>
                ))}
              </div>
              <button onClick={() => { setMode('review'); setStep('session'); setCurrentIndex(0) }}>Direkt Review starten</button>
            </div>
          )}
        </section>
      </section>
    </main>
  )
}

export default App
