import { useCallback, useEffect, useState } from 'react'
import './App.css'
import type { Confidence, ExamGoal, ExamProfile, Mode, Rating, RepositoryStatus, SessionResult, SourceType, Step, StudyDocument, StudyItem } from './types'
import { getAuthState, sendMagicLink, signOut, subscribeToAuthChanges, type AuthState } from './lib/auth'
import { extractFileText } from './lib/pdf'
import { safeParse, saveJson, storageKeys } from './lib/storage'
import {
  buildDailyPlan,
  buildItems,
  buildTopicStats,
  calculateReadiness,
  download,
  id,
  modeLabels,
  nextDueDate,
  normalizeText,
  readinessLabel,
  sampleText,
  selectSessionItems,
} from './lib/studyEngine'
import { getRepositoryStatus, getStudyRepository, syncLocalSnapshotToCloud } from './lib/repositories'

const goalLabels: Record<ExamGoal, string> = {
  bestehen: 'Nur bestehen',
  gut: '2,x schaffen',
  'sehr-gut': '1,x angreifen',
}

const blockerActions: Record<string, string> = {
  'Zu schwer': 'Beantworte nur den ersten Teilsatz. Eine halbe Antwort zählt mehr als Flucht.',
  'Keine Motivation': '2-Minuten-Regel: Schreibe einen Mini-Satz, dann darfst du neu entscheiden.',
  'Verstehe es nicht': 'Markiere die unklaren Begriffe und formuliere eine konkrete Rückfrage.',
  Ablenkung: 'Timer läuft weiter. Tab nicht wechseln. Schreibe den nächsten Satz.',
}

const todayPlus = (days: number) => {
  const date = new Date()
  date.setDate(date.getDate() + days)
  return date.toISOString().slice(0, 10)
}

const currentTimestamp = () => Date.now()

const defaultRepositoryStatus: RepositoryStatus = {
  mode: 'local',
  configured: true,
  authenticated: true,
  label: 'Lokaler Modus',
  detail: 'Daten liegen im Browser-localStorage. Supabase ist vorbereitet, aber noch nicht aktiv.',
}

const defaultAuthState: AuthState = {
  configured: false,
  authenticated: false,
  email: null,
  label: 'Cloud Login aus',
  detail: 'Ohne Supabase Env bleibt StudyLock lokal und friend-testbar.',
}

function persistRepositoryWrite(action: (repository: Awaited<ReturnType<typeof getStudyRepository>>) => Promise<void>) {
  void getStudyRepository()
    .then(action)
    .catch((error: unknown) => console.warn('StudyLock persistence warning:', error))
}

function App() {
  const [step, setStep] = useState<Step>('checkin')
  const [subject, setSubject] = useState('Rechnungswesen')
  const [minutes, setMinutes] = useState(25)
  const [mode, setMode] = useState<Mode>('recall')
  const [documentTitle, setDocumentTitle] = useState('Mein Skript')
  const [material, setMaterial] = useState(sampleText)
  const [sourceType, setSourceType] = useState<SourceType>('paste')
  const [documents, setDocuments] = useState<StudyDocument[]>(() => safeParse(storageKeys.documents, []))
  const [activeDocumentId, setActiveDocumentId] = useState<string | null>(() => safeParse<string | null>(storageKeys.activeDocument, null))
  const [examProfiles, setExamProfiles] = useState<ExamProfile[]>(() => safeParse(storageKeys.examProfiles, []))
  const [activeExamProfileId, setActiveExamProfileId] = useState<string | null>(() => safeParse<string | null>(storageKeys.activeExamProfile, null))
  const [examDate, setExamDate] = useState(todayPlus(21))
  const [examGoal, setExamGoal] = useState<ExamGoal>('bestehen')
  const [confidence, setConfidence] = useState<Confidence>(2)
  const [items, setItems] = useState<StudyItem[]>([])
  const [currentIndex, setCurrentIndex] = useState(0)
  const [answers, setAnswers] = useState<Record<string, string>>({})
  const [ratings, setRatings] = useState<Record<string, Rating>>({})
  const [blockedReason, setBlockedReason] = useState('')
  const [blockerCount, setBlockerCount] = useState(0)
  const [fileStatus, setFileStatus] = useState('')
  const [startedAt, setStartedAt] = useState<number | null>(null)
  const [now, setNow] = useState(() => currentTimestamp())
  const [results, setResults] = useState<SessionResult[]>(() => safeParse(storageKeys.results, []))
  const [repositoryStatus, setRepositoryStatus] = useState<RepositoryStatus>(defaultRepositoryStatus)
  const [authState, setAuthState] = useState<AuthState>(defaultAuthState)
  const [authEmail, setAuthEmail] = useState('')
  const [authMessage, setAuthMessage] = useState('')
  const [syncMessage, setSyncMessage] = useState('')
  const [syncing, setSyncing] = useState(false)

  const activeDocument = documents.find((doc) => doc.id === activeDocumentId) ?? null
  const activeExamProfile = examProfiles.find((profile) => profile.id === (activeDocument?.examProfileId ?? activeExamProfileId)) ?? null
  const activeItem = items[currentIndex]
  const answeredCount = Object.values(answers).filter((value) => value.trim().length > 8).length
  const ratedCount = Object.keys(ratings).length
  const sessionScore = Math.round(((answeredCount + ratedCount) / Math.max(items.length * 2, 1)) * 100)
  const elapsedSeconds = startedAt ? Math.floor((now - startedAt) / 1000) : 0
  const remainingSeconds = Math.max(minutes * 60 - elapsedSeconds, 0)
  const progress = Math.round(((currentIndex + 1) / Math.max(items.length, 1)) * 100)
  const dueCount = activeDocument?.items.filter((item) => new Date(item.dueAt).getTime() <= now).length ?? 0
  const readiness = activeDocument ? calculateReadiness(activeDocument.items) : 0
  const topicStats = activeDocument ? buildTopicStats(activeDocument.items) : []
  const weakestTopics = topicStats.slice(0, 3)
  const dailyPlan = buildDailyPlan(activeExamProfile, dueCount, activeDocument?.items.length ?? 0)

  useEffect(() => saveJson(storageKeys.documents, documents), [documents])
  useEffect(() => saveJson(storageKeys.examProfiles, examProfiles), [examProfiles])
  useEffect(() => saveJson(storageKeys.results, results), [results])
  useEffect(() => saveJson(storageKeys.activeDocument, activeDocumentId), [activeDocumentId])
  useEffect(() => saveJson(storageKeys.activeExamProfile, activeExamProfileId), [activeExamProfileId])

  const refreshCloudState = useCallback(async () => {
    try {
      const [status, auth] = await Promise.all([getRepositoryStatus(), getAuthState()])
      setRepositoryStatus(status)
      setAuthState(auth)
      if (status.mode === 'supabase' && status.authenticated) {
        const snapshot = await getStudyRepository().then((repository) => repository.loadSnapshot())
        setDocuments(snapshot.documents)
        setExamProfiles(snapshot.examProfiles)
        setResults(snapshot.results)
      }
    } catch (error) {
      setRepositoryStatus(defaultRepositoryStatus)
      setAuthState(defaultAuthState)
      setAuthMessage(error instanceof Error ? error.message : 'Cloud Status konnte nicht geladen werden')
    }
  }, [])

  useEffect(() => {
    void Promise.resolve().then(refreshCloudState)
    return subscribeToAuthChanges(() => {
      void refreshCloudState()
    })
  }, [refreshCloudState])

  useEffect(() => {
    const interval = window.setInterval(() => setNow(currentTimestamp()), 1000)
    return () => window.clearInterval(interval)
  }, [])

  function upsertDocument(text = material) {
    const clean = normalizeText(text)
    if (!clean) return
    const docId = id('doc')
    const newDocument: StudyDocument = {
      id: docId,
      title: documentTitle || 'Unbenanntes Skript',
      subject,
      sourceType,
      text: clean,
      examProfileId: activeExamProfileId ?? undefined,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      items: buildItems(docId, subject, clean),
    }
    setDocuments((prev) => [newDocument, ...prev])
    setActiveDocumentId(docId)
    persistRepositoryWrite((repository) => repository.saveDocument(newDocument))
    setStep('exam-setup')
  }

  async function handleFile(file: File | undefined) {
    if (!file) return
    setFileStatus(`Lese ${file.name} ...`)
    try {
      const text = await extractFileText(file)
      const extension = file.name.toLowerCase().split('.').pop()
      setSourceType(extension === 'pdf' ? 'pdf' : extension === 'md' ? 'md' : 'txt')
      setMaterial(text)
      setDocumentTitle(file.name.replace(/\.[^.]+$/, ''))
      setFileStatus(`Importiert: ${file.name} (${Math.round(text.length / 100) / 10}k Zeichen)`)
    } catch (error) {
      setFileStatus(`Import fehlgeschlagen: ${error instanceof Error ? error.message : 'Unbekannter Fehler'}`)
    }
  }

  function saveExamProfile() {
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
    setDocuments((prev) => prev.map((doc) => doc.id === activeDocumentId ? { ...doc, subject, examProfileId: profileId, updatedAt: new Date().toISOString() } : doc))
    persistRepositoryWrite(async (repository) => {
      await repository.saveExamProfile(profile)
      if (activeDocument) await repository.saveDocument({ ...activeDocument, subject, examProfileId: profileId, updatedAt: new Date().toISOString() })
    })
    setStep('checkin')
  }

  function hydrateExamForm() {
    setSubject(activeDocument?.subject ?? subject)
    if (activeExamProfile) {
      setExamDate(activeExamProfile.examDate)
      setExamGoal(activeExamProfile.goal)
      setConfidence(activeExamProfile.confidence)
      setMinutes(activeExamProfile.dailyMinutes)
    }
    setStep('exam-setup')
  }

  function startSession(selectedMode = dailyPlan.mode, overrideTarget = dailyPlan.targetItems) {
    const doc = activeDocument
    if (!doc) {
      setStep('material')
      return
    }
    const sessionItems = selectSessionItems(doc, selectedMode, overrideTarget)
    setMode(selectedMode)
    setMinutes(dailyPlan.priority === 'panic' ? Math.max(minutes, dailyPlan.minutes) : minutes)
    setItems(sessionItems)
    setCurrentIndex(0)
    setAnswers({})
    setRatings({})
    setBlockedReason('')
    setBlockerCount(0)
    setStartedAt(currentTimestamp())
    setStep('session')
  }

  function startPanicSession() {
    startSession('exam', 12)
  }

  function rateItem(itemId: string, rating: Rating) {
    setRatings((prev) => ({ ...prev, [itemId]: rating }))
    const updatedItems = activeDocument?.items.map((item) => item.id === itemId ? { ...item, ...nextDueDate(item, rating) } : item)
    setDocuments((prev) => prev.map((doc) => ({
      ...doc,
      items: doc.items.map((item) => item.id === itemId ? { ...item, ...nextDueDate(item, rating) } : item),
    })))
    if (activeDocument && updatedItems) persistRepositoryWrite((repository) => repository.saveStudyItems(activeDocument.id, updatedItems))
  }

  function registerBlocker(reason: string) {
    setBlockedReason(reason)
    setBlockerCount((count) => count + 1)
  }

  function insertMiniAnswer() {
    if (!activeItem) return
    setAnswers((prev) => ({
      ...prev,
      [activeItem.id]: `${prev[activeItem.id] ?? ''}${prev[activeItem.id] ? '\n' : ''}Mein erster Ansatz: ${activeItem.topic} bedeutet hier, dass ...`,
    }))
  }

  function finishSession() {
    if (!activeDocument) return
    const result: SessionResult = {
      id: id('session'),
      date: new Date().toLocaleString('de-DE', { dateStyle: 'short', timeStyle: 'short' }),
      subject: activeDocument.subject,
      documentTitle: activeDocument.title,
      mode,
      score: sessionScore,
      minutes,
      answered: answeredCount,
      blockers: blockerCount,
      readinessAfter: calculateReadiness(activeDocument.items),
    }
    setStartedAt(null)
    setResults((prev) => [result, ...prev].slice(0, 10))
    persistRepositoryWrite((repository) => repository.saveSession(result))
    setStep('done')
  }

  function exportMarkdown(doc = activeDocument) {
    if (!doc) return
    const content = `# ${doc.title}\n\nFach: ${doc.subject}\nReadiness: ${calculateReadiness(doc.items)}%\n\n## Lernfragen\n\n${doc.items.map((item, index) => `### ${index + 1}. ${item.question}\n\nAntwort/Quelle: ${item.answer}\n\n- Thema: ${item.topic}\n- Typ: ${item.type}\n- Schwierigkeit: ${item.difficulty}\n- Letzte Bewertung: ${item.lastRating ?? 'offen'}\n- Fällig: ${new Date(item.dueAt).toLocaleDateString('de-DE')}\n`).join('\n')}`
    download(`${doc.title}-studylock.md`, content, 'text/markdown')
  }

  function exportAnki(doc = activeDocument) {
    if (!doc) return
    const rows = doc.items.map((item) => `"${item.question.replaceAll('"', '""')}";"${item.answer.replaceAll('"', '""')}";"${doc.subject};${item.topic}"`)
    download(`${doc.title}-anki.csv`, rows.join('\n'), 'text/csv')
  }

  function deleteDocument(documentId: string) {
    setDocuments((prev) => prev.filter((doc) => doc.id !== documentId))
    persistRepositoryWrite((repository) => repository.deleteDocument(documentId))
    if (activeDocumentId === documentId) setActiveDocumentId(null)
  }

  async function handleMagicLinkSubmit() {
    setAuthMessage('Sende Magic Link ...')
    try {
      await sendMagicLink(authEmail)
      setAuthMessage('Magic Link gesendet. Mail öffnen, danach kommt StudyLock automatisch zurück.')
    } catch (error) {
      setAuthMessage(error instanceof Error ? error.message : 'Magic Link konnte nicht gesendet werden')
    }
  }

  async function handleSignOut() {
    setAuthMessage('Logge aus ...')
    try {
      await signOut()
      await refreshCloudState()
      setAuthMessage('Ausgeloggt. Neue Änderungen bleiben lokal, bis du wieder syncst.')
    } catch (error) {
      setAuthMessage(error instanceof Error ? error.message : 'Logout fehlgeschlagen')
    }
  }

  async function handleCloudSync() {
    setSyncing(true)
    setSyncMessage('Synchronisiere lokale Daten in Supabase ...')
    try {
      const counts = await syncLocalSnapshotToCloud()
      await refreshCloudState()
      setSyncMessage(`${counts.documents} Dokumente, ${counts.examProfiles} Klausurprofile und ${counts.results} Sessions in die Cloud gesynct.`)
    } catch (error) {
      setSyncMessage(error instanceof Error ? error.message : 'Cloud Sync fehlgeschlagen')
    } finally {
      setSyncing(false)
    }
  }

  const formatTime = (seconds: number) => `${Math.floor(seconds / 60).toString().padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`
  const canShowExamRating = mode !== 'exam' || (activeItem && (answers[activeItem.id] ?? '').trim().length >= 30)

  return (
    <main className="app-shell">
      <section className="hero-card">
        <div className="eyebrow">Nicht chatten. Bestehen.</div>
        <h1>Dein Skript wird ein täglicher Klausurplan.</h1>
        <p>ChatGPT macht Fragen. StudyLock sagt dir, was du heute schaffen musst: Deadline, Tagesplan, Prüfungsmodus, Readiness Score, Schwächen und Panic Mode.</p>
        <div className="hero-actions">
          <button onClick={() => setStep('material')}>Dokument importieren</button>
          <button className="secondary" onClick={hydrateExamForm}>Klausurplan einrichten</button>
          <button className="secondary" onClick={() => startSession(dailyPlan.mode)} disabled={!activeDocument}>{dailyPlan.command}</button>
        </div>
      </section>

      <section className="grid">
        <aside className="panel sticky-panel">
          <h2>Command Center</h2>
          <div className="metric-row">
            <div><strong>{dailyPlan.daysLeft ?? '—'}</strong><span>Tage bis Klausur</span></div>
            <div><strong>{readiness}%</strong><span>{readinessLabel(readiness)}</span></div>
            <div><strong>{dueCount}</strong><span>fällige Fragen</span></div>
            <div><strong>{documents.length}</strong><span>Skripte</span></div>
          </div>

          <div className={`decision-box compact ${dailyPlan.priority}`}>
            <strong>Heute:</strong> {dailyPlan.message}
            <small>{dailyPlan.minutes} Min · {dailyPlan.targetItems} Items · {modeLabels[dailyPlan.mode]}</small>
          </div>

          <div className={`storage-card ${repositoryStatus.mode}`}>
            <span>Datenbasis</span>
            <strong>{repositoryStatus.label}</strong>
            <small>{repositoryStatus.detail}</small>
          </div>

          {authState.configured && (
            <div className="auth-card">
              <span>Cloud Account</span>
              <strong>{authState.label}</strong>
              <small>{authState.detail}</small>
              {!authState.authenticated ? (
                <div className="auth-form">
                  <input type="email" value={authEmail} onChange={(event) => setAuthEmail(event.target.value)} placeholder="deine@mail.de" />
                  <button className="secondary mini" onClick={handleMagicLinkSubmit}>Magic Link senden</button>
                </div>
              ) : (
                <div className="auth-form">
                  <button className="secondary mini" onClick={handleCloudSync} disabled={syncing}>{syncing ? 'Sync läuft ...' : 'Lokale Daten in Cloud syncen'}</button>
                  <button className="secondary mini" onClick={handleSignOut}>Logout</button>
                </div>
              )}
              {(authMessage || syncMessage) && <small className="status-line">{syncMessage || authMessage}</small>}
            </div>
          )}

          {activeExamProfile && (
            <div className="profile-card">
              <span>Klausurprofil</span>
              <strong>{activeExamProfile.subject}</strong>
              <small>{new Date(activeExamProfile.examDate).toLocaleDateString('de-DE')} · {goalLabels[activeExamProfile.goal]} · Gefühl {activeExamProfile.confidence}/5</small>
            </div>
          )}

          <div className="weakness-box">
            <h3>Top Schwächen</h3>
            {weakestTopics.length === 0 && <p className="muted">Noch keine Themen. Importiere Material und starte eine Session.</p>}
            {weakestTopics.map((topic) => (
              <div className="weakness" key={topic.topic}>
                <span>{topic.topic}</span>
                <strong>{topic.readiness}%</strong>
                <small>{topic.again > 0 ? 'Nochmal heute' : topic.hard > 0 ? 'Schwer: gezielt wiederholen' : 'Noch offen'}</small>
              </div>
            ))}
          </div>

          <div className="doc-list">
            {documents.length === 0 && <p className="muted">Noch kein Dokument. Importiere dein erstes Skript.</p>}
            {documents.map((doc) => (
              <button key={doc.id} className={doc.id === activeDocumentId ? 'doc-card active' : 'doc-card'} onClick={() => { setActiveDocumentId(doc.id); if (doc.examProfileId) setActiveExamProfileId(doc.examProfileId) }}>
                <strong>{doc.title}</strong>
                <span>{doc.subject} · {doc.items.length} Items · {calculateReadiness(doc.items)}% bereit</span>
              </button>
            ))}
          </div>
        </aside>

        <section className="panel work-panel">
          {step === 'checkin' && (
            <div className="flow">
              <span className="step-label">1 / Tagesbefehl</span>
              <h2>{dailyPlan.command}</h2>
              <div className={`plan-card ${dailyPlan.priority}`}>
                <div>
                  <span>Heute</span>
                  <strong>{dailyPlan.minutes} Minuten</strong>
                  <small>{dailyPlan.targetItems} Fragen · {modeLabels[dailyPlan.mode]}</small>
                </div>
                <p>{dailyPlan.message}</p>
              </div>
              {dailyPlan.priority === 'panic' && <div className="panic-card"><strong>Panic Mode:</strong> Keine Zusammenfassungen, keine Farbcodes, keine neuen Notizen. Nur schwerste Fragen beantworten.</div>}
              <div className="active-doc">
                <strong>{activeDocument?.title ?? 'Kein Dokument aktiv'}</strong>
                <span>{activeDocument ? `${activeDocument.subject} · ${activeDocument.items.length} Lernitems · ${dueCount} fällig` : 'Importiere erst Material.'}</span>
              </div>
              <div className="mode-grid four">
                {(Object.keys(modeLabels) as Mode[]).map((key) => (
                  <button key={key} className={dailyPlan.mode === key ? 'mode active' : 'mode'} onClick={() => startSession(key)} disabled={!activeDocument}>
                    <strong>{modeLabels[key]}</strong>
                    <span>{key === 'recall' ? 'Abfragen statt lesen' : key === 'exam' ? 'Mini-Klausur' : key === 'deepwork' ? 'Eine schwere Aufgabe' : 'Fällige Schwächen'}</span>
                  </button>
                ))}
              </div>
              <div className="hero-actions">
                <button onClick={() => dailyPlan.priority === 'panic' ? startPanicSession() : startSession(dailyPlan.mode)} disabled={!activeDocument}>{dailyPlan.command}</button>
                <button className="secondary" onClick={hydrateExamForm}>Klausurplan bearbeiten</button>
                <button className="secondary" onClick={() => setStep('material')}>Neues Dokument</button>
              </div>
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
              <div className="hero-actions"><button onClick={() => upsertDocument()}>Dokument speichern & Klausurplan bauen</button><button className="secondary" onClick={() => { setDocumentTitle('Rechnungswesen Demo'); setSubject('Rechnungswesen'); setSourceType('paste'); setMaterial(sampleText) }}>Demo laden</button></div>
            </div>
          )}

          {step === 'exam-setup' && (
            <div className="flow">
              <span className="step-label">3 / Klausurprofil</span>
              <h2>Wofür muss StudyLock dich verantwortlich halten?</h2>
              <div className="form-grid">
                <label>Fach / Modul<input value={subject} onChange={(event) => setSubject(event.target.value)} /></label>
                <label>Klausurdatum<input type="date" value={examDate} onChange={(event) => setExamDate(event.target.value)} /></label>
                <label>Ziel<select value={examGoal} onChange={(event) => setExamGoal(event.target.value as ExamGoal)}><option value="bestehen">Nur bestehen</option><option value="gut">2,x schaffen</option><option value="sehr-gut">1,x angreifen</option></select></label>
                <label>Minuten pro Tag<select value={minutes} onChange={(event) => setMinutes(Number(event.target.value))}><option value={10}>10 Minuten Notfall</option><option value={25}>25 Minuten realistisch</option><option value={50}>50 Minuten Fokus</option><option value={90}>90 Minuten Klausurblock</option></select></label>
              </div>
              <label>Gefühl aktuell: {confidence}/5<input type="range" min="1" max="5" value={confidence} onChange={(event) => setConfidence(Number(event.target.value) as Confidence)} /></label>
              <div className="decision-box"><strong>Warum das zählt:</strong> Ohne Deadline ist StudyLock nur ein PDF-Tool. Mit Deadline wird daraus ein täglicher Prüfungsbefehl.</div>
              <div className="hero-actions"><button onClick={saveExamProfile}>Klausurprofil speichern</button><button className="secondary" onClick={() => setStep('checkin')}>Später</button></div>
            </div>
          )}

          {step === 'session' && activeItem && activeDocument && (
            <div className="flow session-screen">
              <div className="session-top"><span className="step-label">{modeLabels[mode]} · {activeDocument.title}</span><span className="timer">{formatTime(remainingSeconds)}</span></div>
              <div className="progressbar"><span style={{ width: `${progress}%` }} /></div>
              <div className="question-meta"><span>{activeItem.type}</span><span>{activeItem.difficulty}</span><span>{activeItem.topic}</span><span>{progress}%</span></div>
              <h2>{activeItem.question}</h2>
              <textarea className="answer-box" value={answers[activeItem.id] ?? ''} onChange={(event) => setAnswers((prev) => ({ ...prev, [activeItem.id]: event.target.value }))} placeholder="Antworte aus dem Kopf. Erst danach Musterlösung öffnen." />
              <details className="solution"><summary>Musterlösung / Quelle ansehen</summary><p>{activeItem.answer}</p></details>
              {!canShowExamRating && <p className="nudge">Prüfungsmodus: erst mindestens 30 Zeichen selbst antworten, dann bewerten.</p>}
              {canShowExamRating && (
                <div className="rating-row">
                  <button className={ratings[activeItem.id] === 'again' ? 'rating active bad' : 'rating bad'} onClick={() => rateItem(activeItem.id, 'again')}>{mode === 'exam' ? '0 Punkte' : 'Nochmal heute'}</button>
                  <button className={ratings[activeItem.id] === 'hard' ? 'rating active' : 'rating'} onClick={() => rateItem(activeItem.id, 'hard')}>{mode === 'exam' ? 'Teilweise' : 'Schwer'}</button>
                  <button className={ratings[activeItem.id] === 'good' ? 'rating active good' : 'rating good'} onClick={() => rateItem(activeItem.id, 'good')}>{mode === 'exam' ? 'Vollständig' : 'Sitzt'}</button>
                </div>
              )}
              <div className="blocker-box"><strong>Blockiert?</strong><div className="chips">{Object.keys(blockerActions).map((reason) => <button key={reason} className="chip" onClick={() => registerBlocker(reason)}>{reason}</button>)}</div>{blockedReason && <p className="nudge">{blockerActions[blockedReason]}</p>}<button className="secondary mini" onClick={insertMiniAnswer}>Miniantwort übernehmen</button></div>
              <div className="session-actions"><button className="secondary" disabled={currentIndex === 0} onClick={() => setCurrentIndex((prev) => Math.max(prev - 1, 0))}>Zurück</button>{currentIndex < items.length - 1 ? <button onClick={() => setCurrentIndex((prev) => prev + 1)}>Nächste Frage</button> : <button onClick={finishSession}>Session abschließen</button>}</div>
            </div>
          )}

          {step === 'done' && activeDocument && (
            <div className="flow done-screen">
              <span className="step-label">4 / Auswertung</span>
              <h2>Session fertig: {sessionScore}% · Readiness {readiness}%</h2>
              <p>{answeredCount} Antworten, {ratedCount} Bewertungen, {blockerCount} Blocker überwunden. {readinessLabel(readiness)}.</p>
              {weakestTopics[0] && <div className="decision-box"><strong>Nächster Hebel:</strong> {weakestTopics[0].topic} gezielt wiederholen.</div>}
              <div className="hero-actions"><button onClick={() => startSession('review')}>Direkt Review starten</button><button className="secondary" onClick={() => exportAnki()}>Anki CSV exportieren</button><button className="secondary" onClick={() => exportMarkdown()}>Markdown exportieren</button></div>
              <div className="recap-grid">{results.map((result) => <div className="recap" key={result.id}><strong>{result.documentTitle}</strong><span>{modeLabels[result.mode]} · {result.minutes} Min · {result.score}%</span><small>{result.date} · Readiness {result.readinessAfter}% · Blocker {result.blockers}</small></div>)}</div>
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
