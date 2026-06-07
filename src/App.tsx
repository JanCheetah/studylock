import { useEffect, useMemo, useState } from 'react'
import * as pdfjsLib from 'pdfjs-dist'
import './App.css'

pdfjsLib.GlobalWorkerOptions.workerSrc = new URL('pdfjs-dist/build/pdf.worker.mjs', import.meta.url).toString()

type Mode = 'recall' | 'deepwork' | 'review' | 'exam'
type Step = 'checkin' | 'material' | 'session' | 'done'
type Difficulty = 'leicht' | 'mittel' | 'hart'
type Rating = 'again' | 'hard' | 'good'

type StudyItem = {
  id: string
  documentId: string
  question: string
  answer: string
  source: string
  difficulty: Difficulty
  type: 'karte' | 'quiz' | 'aufgabe'
  dueAt: string
  intervalDays: number
  repetitions: number
}

type StudyDocument = {
  id: string
  title: string
  subject: string
  text: string
  createdAt: string
  updatedAt: string
  items: StudyItem[]
}

type SessionResult = {
  id: string
  date: string
  subject: string
  documentTitle: string
  mode: Mode
  score: number
  minutes: number
  answered: number
}

const modeLabels: Record<Mode, string> = {
  recall: 'Active Recall',
  deepwork: 'Deep Work',
  review: 'Review',
  exam: 'Exam Mode',
}

const sampleText = `Aktivkonten mehren sich im Soll und mindern sich im Haben. Passivkonten mehren sich im Haben und mindern sich im Soll. Die Gewinn- und Verlustrechnung sammelt Aufwendungen und Erträge und zeigt den Periodenerfolg. Buchungssätze folgen dem Prinzip Soll an Haben. Eine Bilanz zeigt Vermögen auf der Aktivseite und Kapital auf der Passivseite.`

function safeParse<T>(key: string, fallback: T): T {
  try {
    const saved = localStorage.getItem(key)
    return saved ? (JSON.parse(saved) as T) : fallback
  } catch {
    return fallback
  }
}

function id(prefix: string) {
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function normalizeText(text: string) {
  return text.replace(/\s+/g, ' ').trim()
}

function splitIntoChunks(text: string) {
  const clean = normalizeText(text)
  if (!clean) return []

  const sentences = clean
    .split(/(?<=[.!?])\s+/)
    .map((sentence) => sentence.trim())
    .filter((sentence) => sentence.length > 24)

  const chunks: string[] = []
  let buffer = ''
  for (const sentence of sentences) {
    const next = `${buffer} ${sentence}`.trim()
    if (next.length > 260 && buffer) {
      chunks.push(buffer)
      buffer = sentence
    } else {
      buffer = next
    }
  }
  if (buffer) chunks.push(buffer)
  return chunks.slice(0, 12)
}

function extractTerms(chunk: string) {
  const stop = new Set(['diese', 'dieser', 'dieses', 'einem', 'einen', 'einer', 'nicht', 'werden', 'durch', 'sind', 'oder', 'aber', 'auch', 'dass', 'eine', 'eines', 'wird', 'haben', 'sich'])
  return Array.from(new Set(chunk
    .replace(/[^\p{L}\p{N}äöüÄÖÜß\s-]/gu, '')
    .split(/\s+/)
    .filter((word) => word.length > 6 && !stop.has(word.toLowerCase()))))
    .slice(0, 4)
}

function buildItems(documentId: string, subject: string, text: string): StudyItem[] {
  const chunks = splitIntoChunks(text)
  const now = new Date().toISOString()
  if (!chunks.length) return []

  return chunks.flatMap((chunk, index) => {
    const terms = extractTerms(chunk)
    const termLabel = terms.join(', ') || 'Kernkonzept'
    const base = `${documentId}-${index}`
    const difficulty: Difficulty = chunk.length > 210 ? 'hart' : index % 2 ? 'mittel' : 'leicht'

    return [
      {
        id: `${base}-recall`,
        documentId,
        question: `Erkläre für ${subject} in eigenen Worten: ${termLabel}`,
        answer: chunk,
        source: `Abschnitt ${index + 1}`,
        difficulty,
        type: 'karte' as const,
        dueAt: now,
        intervalDays: 0,
        repetitions: 0,
      },
      {
        id: `${base}-exam`,
        documentId,
        question: `Welche Klausurfrage könnte zu diesem Abschnitt kommen — und wie würdest du sie beantworten?`,
        answer: chunk,
        source: `Abschnitt ${index + 1}`,
        difficulty: (index % 3 === 0 ? 'hart' : 'mittel') as Difficulty,
        type: 'quiz' as const,
        dueAt: now,
        intervalDays: 0,
        repetitions: 0,
      },
    ]
  }).slice(0, 24)
}

function nextDueDate(item: StudyItem, rating: Rating) {
  const next = new Date()
  const interval = rating === 'again' ? 0 : rating === 'hard' ? Math.max(1, item.intervalDays || 1) : Math.max(1, (item.intervalDays || 1) * 2)
  if (rating === 'again') next.setHours(next.getHours() + 4)
  else next.setDate(next.getDate() + interval)
  return { dueAt: next.toISOString(), intervalDays: interval, repetitions: item.repetitions + (rating === 'again' ? 0 : 1) }
}

function download(filename: string, content: string, type = 'text/plain') {
  const blob = new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}

async function extractFileText(file: File) {
  if (file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf')) {
    const buffer = await file.arrayBuffer()
    const pdf = await pdfjsLib.getDocument({ data: buffer }).promise
    const pages: string[] = []
    for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
      const page = await pdf.getPage(pageNumber)
      const content = await page.getTextContent()
      const text = content.items.map((item: unknown) => (item as { str?: string }).str ?? '').join(' ')
      pages.push(`[Seite ${pageNumber}] ${text}`)
    }
    return pages.join('\n\n')
  }
  return file.text()
}

function App() {
  const [step, setStep] = useState<Step>('checkin')
  const [subject, setSubject] = useState('Rechnungswesen')
  const [minutes, setMinutes] = useState(25)
  const [mode, setMode] = useState<Mode>('recall')
  const [documentTitle, setDocumentTitle] = useState('Mein Skript')
  const [material, setMaterial] = useState(sampleText)
  const [documents, setDocuments] = useState<StudyDocument[]>(() => safeParse('studylock-documents', []))
  const [activeDocumentId, setActiveDocumentId] = useState<string | null>(() => safeParse<string | null>('studylock-active-document', null))
  const [items, setItems] = useState<StudyItem[]>([])
  const [currentIndex, setCurrentIndex] = useState(0)
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [ratings, setRatings] = useState<Record<string, Rating>>({})
  const [blockedReason, setBlockedReason] = useState('')
  const [fileStatus, setFileStatus] = useState('')
  const [startedAt, setStartedAt] = useState<number | null>(null)
  const [now, setNow] = useState(Date.now())
  const [results, setResults] = useState<SessionResult[]>(() => safeParse('studylock-results', []))

  const activeDocument = documents.find((doc) => doc.id === activeDocumentId) ?? null
  const activeItem = items[currentIndex]
  const answeredCount = Object.values(answers).filter((value) => value.trim().length > 8).length
  const ratedCount = Object.keys(ratings).length
  const score = Math.round(((answeredCount + ratedCount) / Math.max(items.length * 2, 1)) * 100)
  const elapsedSeconds = startedAt ? Math.floor((now - startedAt) / 1000) : 0
  const remainingSeconds = Math.max(minutes * 60 - elapsedSeconds, 0)
  const progress = Math.round(((currentIndex + 1) / Math.max(items.length, 1)) * 100)
  const dueCount = activeDocument?.items.filter((item) => new Date(item.dueAt).getTime() <= Date.now()).length ?? 0

  useEffect(() => {
    localStorage.setItem('studylock-documents', JSON.stringify(documents))
  }, [documents])

  useEffect(() => {
    localStorage.setItem('studylock-results', JSON.stringify(results))
  }, [results])

  useEffect(() => {
    localStorage.setItem('studylock-active-document', JSON.stringify(activeDocumentId))
  }, [activeDocumentId])

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(interval)
  }, [])

  useEffect(() => {
    if (remainingSeconds === 0 && startedAt && step === 'session') finishSession()
  }, [remainingSeconds, startedAt, step])

  const nextAction = useMemo(() => {
    if (!activeDocument) return 'Erstelle zuerst ein Dokument aus PDF/Text.'
    if (dueCount > 0) return `${dueCount} fällige Fragen wiederholen. Keine neuen Notizen.`
    if (mode === 'exam') return 'Klausurmodus: beantworten, dann erst Musterlösung.'
    return 'Active Recall starten: eine Frage, eine Antwort, eine Bewertung.'
  }, [activeDocument, dueCount, mode])

  function upsertDocument(text = material) {
    const clean = normalizeText(text)
    if (!clean) return
    const docId = id('doc')
    const newDocument: StudyDocument = {
      id: docId,
      title: documentTitle || 'Unbenanntes Skript',
      subject,
      text: clean,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      items: buildItems(docId, subject, clean),
    }
    setDocuments((prev) => [newDocument, ...prev])
    setActiveDocumentId(docId)
    setStep('checkin')
  }

  async function handleFile(file: File | undefined) {
    if (!file) return
    setFileStatus(`Lese ${file.name} ...`)
    try {
      const text = await extractFileText(file)
      setMaterial(text)
      setDocumentTitle(file.name.replace(/\.[^.]+$/, ''))
      setFileStatus(`Importiert: ${file.name} (${Math.round(text.length / 100) / 10}k Zeichen)`)
    } catch (error) {
      setFileStatus(`Import fehlgeschlagen: ${error instanceof Error ? error.message : 'Unbekannter Fehler'}`)
    }
  }

  function startSession(selectedMode = mode) {
    const doc = activeDocument
    if (!doc) {
      setStep('material')
      return
    }
    const dueItems = doc.items.filter((item) => new Date(item.dueAt).getTime() <= Date.now())
    const pool = selectedMode === 'review' ? dueItems : selectedMode === 'exam' ? doc.items.filter((item) => item.type === 'quiz') : doc.items
    const sessionItems = (pool.length ? pool : doc.items).slice(0, selectedMode === 'exam' ? 10 : 8)
    setMode(selectedMode)
    setItems(sessionItems)
    setCurrentIndex(0)
    setAnswers({})
    setRatings({})
    setBlockedReason('')
    setStartedAt(Date.now())
    setStep('session')
  }

  function rateItem(itemId: string, rating: Rating) {
    setRatings((prev) => ({ ...prev, [itemId]: rating }))
    setDocuments((prev) => prev.map((doc) => ({
      ...doc,
      items: doc.items.map((item) => item.id === itemId ? { ...item, ...nextDueDate(item, rating) } : item),
    })))
  }

  function finishSession() {
    if (!activeDocument) return
    const result: SessionResult = {
      id: id('session'),
      date: new Date().toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' }),
      subject: activeDocument.subject,
      documentTitle: activeDocument.title,
      mode,
      score,
      minutes,
      answered: answeredCount,
    }
    setStartedAt(null)
    setResults((prev) => [result, ...prev].slice(0, 8))
    setStep('done')
  }

  function exportMarkdown(doc = activeDocument) {
    if (!doc) return
    const content = `# ${doc.title}\n\nFach: ${doc.subject}\n\n## Lernfragen\n\n${doc.items.map((item, index) => `### ${index + 1}. ${item.question}\n\nAntwort/Quelle: ${item.answer}\n\n- Typ: ${item.type}\n- Schwierigkeit: ${item.difficulty}\n- Fällig: ${new Date(item.dueAt).toLocaleDateString('de-DE')}\n`).join('\n')}`
    download(`${doc.title}-studylock.md`, content, 'text/markdown')
  }

  function exportAnki(doc = activeDocument) {
    if (!doc) return
    const rows = doc.items.map((item) => `"${item.question.replaceAll('"', '""')}";"${item.answer.replaceAll('"', '""')}";"${doc.subject}"`)
    download(`${doc.title}-anki.csv`, rows.join('\n'), 'text/csv')
  }

  function deleteDocument(documentId: string) {
    setDocuments((prev) => prev.filter((doc) => doc.id !== documentId))
    if (activeDocumentId === documentId) setActiveDocumentId(null)
  }

  const formatTime = (seconds: number) => `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`

  return (
    <main className="app-shell">
      <section className="hero-card">
        <div className="eyebrow">StudyLock MVP · lokal benutzbar</div>
        <h1>Material rein. Lernmodus an. Keine Planungsflucht.</h1>
        <p>Importiere PDF/TXT oder füge dein Skript ein. StudyLock erzeugt Karteikarten, Klausurfragen, Timer-Sessions, Review-Fälligkeiten und Anki/Markdown-Export — alles lokal im Browser.</p>
        <div className="hero-actions">
          <button onClick={() => setStep('material')}>Dokument importieren</button>
          <button className="secondary" onClick={() => startSession('recall')}>Nächste beste Session</button>
        </div>
      </section>

      <section className="grid">
        <aside className="panel sticky-panel">
          <h2>Arbeitszentrale</h2>
          <div className="metric-row">
            <div><strong>{documents.length}</strong><span>Dokumente</span></div>
            <div><strong>{dueCount}</strong><span>fällig</span></div>
            <div><strong>{results.length}</strong><span>Sessions</span></div>
            <div><strong>{results[0]?.score ?? 0}%</strong><span>letzter Score</span></div>
          </div>
          <div className="decision-box compact"><strong>Nächste Aktion:</strong> {nextAction}</div>
          <div className="doc-list">
            {documents.length === 0 && <p className="muted">Noch kein Dokument. Importiere dein erstes Skript.</p>}
            {documents.map((doc) => (
              <button key={doc.id} className={doc.id === activeDocumentId ? 'doc-card active' : 'doc-card'} onClick={() => setActiveDocumentId(doc.id)}>
                <strong>{doc.title}</strong>
                <span>{doc.subject} · {doc.items.length} Fragen</span>
              </button>
            ))}
          </div>
        </aside>

        <section className="panel work-panel">
          {step === 'checkin' && (
            <div className="flow">
              <span className="step-label">1 / Start</span>
              <h2>Was wird jetzt gelernt?</h2>
              <div className="active-doc">
                <strong>{activeDocument?.title ?? 'Kein Dokument aktiv'}</strong>
                <span>{activeDocument ? `${activeDocument.subject} · ${activeDocument.items.length} Lernitems · ${dueCount} fällig` : 'Importiere erst Material.'}</span>
              </div>
              <div className="form-grid">
                <label>Zeitcommitment<select value={minutes} onChange={(event) => setMinutes(Number(event.target.value))}><option value={10}>10 Minuten Einstieg</option><option value={25}>25 Minuten Fokus</option><option value={50}>50 Minuten Deep Work</option><option value={90}>90 Minuten Klausurblock</option></select></label>
                <label>Session-Modus<select value={mode} onChange={(event) => setMode(event.target.value as Mode)}><option value="recall">Active Recall</option><option value="review">Review fälliger Karten</option><option value="exam">Exam Mode</option><option value="deepwork">Deep Work</option></select></label>
              </div>
              <div className="mode-grid four">
                {(Object.keys(modeLabels) as Mode[]).map((key) => (
                  <button key={key} className={mode === key ? 'mode active' : 'mode'} onClick={() => setMode(key)}><strong>{modeLabels[key]}</strong><span>{key === 'recall' ? 'Abfragen statt lesen' : key === 'exam' ? 'Klausur-Simulation' : key === 'deepwork' ? 'Eine Aufgabe tief' : 'Fällige Schwächen'}</span></button>
                ))}
              </div>
              <div className="hero-actions"><button onClick={() => startSession(mode)} disabled={!activeDocument}>Session starten</button><button className="secondary" onClick={() => setStep('material')}>Neues Dokument</button></div>
            </div>
          )}

          {step === 'material' && (
            <div className="flow">
              <span className="step-label">2 / Import</span>
              <h2>PDF, TXT oder Skript einfügen</h2>
              <div className="form-grid">
                <label>Titel<input value={documentTitle} onChange={(event) => setDocumentTitle(event.target.value)} /></label>
                <label>Fach / Modul<input value={subject} onChange={(event) => setSubject(event.target.value)} /></label>
              </div>
              <label className="file-drop">PDF/TXT/MD hochladen<input type="file" accept=".pdf,.txt,.md,text/plain,application/pdf" onChange={(event) => handleFile(event.target.files?.[0])} /></label>
              {fileStatus && <p className="nudge">{fileStatus}</p>}
              <textarea value={material} onChange={(event) => setMaterial(event.target.value)} placeholder="Skript, Folien-Text oder eigene Notizen hier einfügen..." />
              <div className="hero-actions"><button onClick={() => upsertDocument()}>Dokument speichern & Lernitems bauen</button><button className="secondary" onClick={() => { setDocumentTitle('Rechnungswesen Demo'); setSubject('Rechnungswesen'); setMaterial(sampleText) }}>Demo laden</button></div>
            </div>
          )}

          {step === 'session' && activeItem && activeDocument && (
            <div className="flow session-screen">
              <div className="session-top"><span className="step-label">{modeLabels[mode]} · {activeDocument.title}</span><span className="timer">{formatTime(remainingSeconds)}</span></div>
              <div className="progressbar"><span style={{ width: `${progress}%` }} /></div>
              <div className="question-meta"><span>{activeItem.type}</span><span>{activeItem.difficulty}</span><span>{activeItem.source}</span><span>{progress}%</span></div>
              <h2>{activeItem.question}</h2>
              <textarea className="answer-box" value={answers[activeItem.id] ?? ''} onChange={(event) => setAnswers((prev) => ({ ...prev, [activeItem.id]: event.target.value }))} placeholder="Antworte aus dem Kopf. Erst danach Musterlösung öffnen." />
              <details className="solution"><summary>Musterlösung / Quelle ansehen</summary><p>{activeItem.answer}</p></details>
              <div className="rating-row"><button className={ratings[activeItem.id] === 'again' ? 'rating active bad' : 'rating bad'} onClick={() => rateItem(activeItem.id, 'again')}>Nochmal heute</button><button className={ratings[activeItem.id] === 'hard' ? 'rating active' : 'rating'} onClick={() => rateItem(activeItem.id, 'hard')}>Schwer</button><button className={ratings[activeItem.id] === 'good' ? 'rating active good' : 'rating good'} onClick={() => rateItem(activeItem.id, 'good')}>Sitzt</button></div>
              <div className="blocker-box"><strong>Blockiert?</strong><div className="chips">{['Zu schwer', 'Keine Motivation', 'Verstehe es nicht', 'Ablenkung'].map((reason) => <button key={reason} className="chip" onClick={() => setBlockedReason(reason)}>{reason}</button>)}</div>{blockedReason && <p className="nudge">{blockedReason}: kleiner machen. Schreibe nur den ersten Satz. Nicht abbrechen.</p>}</div>
              <div className="session-actions"><button className="secondary" disabled={currentIndex === 0} onClick={() => setCurrentIndex((prev) => Math.max(prev - 1, 0))}>Zurück</button>{currentIndex < items.length - 1 ? <button onClick={() => setCurrentIndex((prev) => prev + 1)}>Nächste Frage</button> : <button onClick={finishSession}>Session abschließen</button>}</div>
            </div>
          )}

          {step === 'done' && activeDocument && (
            <div className="flow done-screen">
              <span className="step-label">4 / Review</span>
              <h2>Session fertig: {score}%</h2>
              <p>{answeredCount} Antworten, {ratedCount} Bewertungen. Nächste Empfehlung: Review der fälligen oder schweren Karten.</p>
              <div className="hero-actions"><button onClick={() => startSession('review')}>Direkt Review starten</button><button className="secondary" onClick={() => exportAnki()}>Anki CSV exportieren</button><button className="secondary" onClick={() => exportMarkdown()}>Markdown exportieren</button></div>
              <div className="recap-grid">{results.map((result) => <div className="recap" key={result.id}><strong>{result.documentTitle}</strong><span>{modeLabels[result.mode]} · {result.minutes} Min · {result.score}%</span><small>{result.date}</small></div>)}</div>
            </div>
          )}

          {activeDocument && step !== 'session' && (
            <div className="library-actions"><button className="secondary" onClick={() => exportAnki()}>Anki CSV</button><button className="secondary" onClick={() => exportMarkdown()}>Markdown</button><button className="secondary danger" onClick={() => deleteDocument(activeDocument.id)}>Dokument löschen</button></div>
          )}
        </section>
      </section>
    </main>
  )
}

export default App
