import './App.css'
import { StudyLockProvider } from './context/StudyLockContext'
import { useStudyLock } from './context/studyLockContextValue'
import { ToastProvider } from './components/Toast'
import { CommandCenter } from './components/CommandCenter'
import { MaterialImport } from './components/MaterialImport'
import { ExamSetup } from './components/ExamSetup'
import { StudySession } from './components/StudySession'
import { SessionDone } from './components/SessionDone'
import { StartupHydrationBarrier } from './components/StartupHydrationBarrier'
import { modeLabels } from './lib/studyEngine'
import type { Mode, Step } from './types'

const stepLabels: Record<Step, string> = {
  checkin: 'Dashboard',
  material: 'Import',
  'exam-setup': 'Klausurplan',
  session: 'Session',
  done: 'Auswertung',
}

function Breadcrumbs({ step, setStep }: { step: Step; setStep: (s: Step) => void }) {
  const steps: Step[] = ['checkin', 'material', 'exam-setup', 'session', 'done']
  const currentIdx = steps.indexOf(step)

  return (
    <nav className="breadcrumbs">
      {steps.map((s, i) => (
        <button
          key={s}
          className={`breadcrumb${s === step ? ' active' : ''}${i < currentIdx ? ' completed' : ''}`}
          onClick={() => {
            // Only allow navigating back, not forward (except checkin is always reachable)
            if (s === 'checkin' || i <= currentIdx) setStep(s)
          }}
          disabled={s === 'session' && step !== 'session'}
        >
          <span className="breadcrumb-num">{i + 1}</span>
          <span className="breadcrumb-label">{stepLabels[s]}</span>
        </button>
      ))}
    </nav>
  )
}

function OnboardingHero({ setStep }: { setStep: (s: Step) => void }) {
  return (
    <section className="hero-card onboarding">
      <div className="eyebrow">Willkommen bei StudyLock</div>
      <h1>Dein Skript wird ein täglicher Klausurplan.</h1>
      <p>
        In 3 Schritten von der PDF zur Prüfungsvorbereitung:
        Material importieren → AI generiert Prüfungsfragen → Täglicher Lernplan mit Spaced Repetition.
      </p>
      <div className="onboarding-steps">
        <div className="onboarding-step">
          <span className="onboarding-icon">📄</span>
          <strong>1. Material importieren</strong>
          <span>PDF, TXT oder Notizen hochladen</span>
        </div>
        <div className="onboarding-step">
          <span className="onboarding-icon">🤖</span>
          <strong>2. AI generiert Fragen</strong>
          <span>Intelligente Prüfungsfragen aus deinem Stoff</span>
        </div>
        <div className="onboarding-step">
          <span className="onboarding-icon">📅</span>
          <strong>3. Täglicher Lernplan</strong>
          <span>Spaced Repetition bis zur Klausur</span>
        </div>
      </div>
      <div className="hero-actions">
        <button onClick={() => setStep('material')}>Jetzt Material importieren →</button>
      </div>
    </section>
  )
}

function WritableApp() {
  const {
    step,
    setStep,
    activeDocument,
    dailyPlan,
    startSession,
    startPanicSession,
    hydrateExamForm,
    exportAnki,
    exportMarkdown,
    deleteDocument,
    dueCount,
    documents,
    readiness,
  } = useStudyLock()

  const isFirstVisit = documents.length === 0 && step === 'checkin'

  return (
    <main className="app-shell">
      <Breadcrumbs step={step} setStep={setStep} />

      {isFirstVisit ? (
        <OnboardingHero setStep={setStep} />
      ) : (
        <section className="hero-card">
          <div className="eyebrow">
            {readiness >= 85 ? '🎯 Klausurbereit' : readiness >= 70 ? '📈 Auf gutem Weg' : readiness >= 40 ? '⚡ Weiter dranbleiben' : '🔥 Jetzt erst recht'}
          </div>
          <h1>
            {dailyPlan.priority === 'panic'
              ? 'Panic Mode – Klausur in Sicht!'
              : dailyPlan.priority === 'setup'
              ? 'Dein Skript wird ein täglicher Klausurplan.'
              : `${dailyPlan.command}`}
          </h1>
          <p>
            {activeDocument
              ? `${activeDocument.title} · ${activeDocument.items.length} Fragen · Readiness ${readiness}%`
              : 'Importiere dein erstes Skript und lass die AI Prüfungsfragen generieren.'}
          </p>
          <div className="hero-actions">
            <button onClick={() => setStep('material')}>Dokument importieren</button>
            <button className="secondary" onClick={hydrateExamForm}>
              Klausurplan einrichten
            </button>
            <button
              className="secondary"
              onClick={() => startSession(dailyPlan.mode, dailyPlan.targetItems)}
              disabled={!activeDocument}
            >
              {dailyPlan.command}
            </button>
          </div>
        </section>
      )}

      <section className="grid">
        <CommandCenter />

        <section className="panel work-panel">
          {step === 'checkin' && !isFirstVisit && (
            <div className="flow">
              <span className="step-label">1 / Tagesbefehl</span>
              <h2>{dailyPlan.command}</h2>
              <div className={`plan-card ${dailyPlan.priority}`}>
                <div>
                  <span>Heute</span>
                  <strong>{dailyPlan.minutes} Minuten</strong>
                  <small>
                    {dailyPlan.targetItems} Fragen · {modeLabels[dailyPlan.mode]}
                  </small>
                </div>
                <p>{dailyPlan.message}</p>
              </div>
              {dailyPlan.priority === 'panic' && (
                <div className="panic-card">
                  <strong>Panic Mode:</strong> Keine Zusammenfassungen, keine Farbcodes, keine neuen Notizen. Nur
                  schwerste Fragen beantworten.
                </div>
              )}
              <div className="active-doc">
                <strong>{activeDocument?.title ?? 'Kein Dokument aktiv'}</strong>
                <span>
                  {activeDocument
                    ? `${activeDocument.subject} · ${activeDocument.items.length} Lernitems · ${dueCount} fällig`
                    : 'Importiere erst Material.'}
                </span>
              </div>
              <div className="mode-grid four">
                {(['recall', 'deepwork', 'review', 'exam'] as Mode[]).map((key) => (
                  <button
                    key={key}
                    className={dailyPlan.mode === key ? 'mode active' : 'mode'}
                    onClick={() => startSession(key, dailyPlan.targetItems)}
                    disabled={!activeDocument}
                  >
                    <strong>{modeLabels[key]}</strong>
                    <span>
                      {key === 'recall'
                        ? 'Abfragen statt lesen'
                        : key === 'exam'
                        ? 'Mini-Klausur'
                        : key === 'deepwork'
                        ? 'Eine schwere Aufgabe'
                        : 'Fällige Schwächen'}
                    </span>
                  </button>
                ))}
              </div>
              <div className="hero-actions">
                <button
                  onClick={() =>
                    dailyPlan.priority === 'panic'
                      ? startPanicSession()
                      : startSession(dailyPlan.mode, dailyPlan.targetItems)
                  }
                  disabled={!activeDocument}
                >
                  {dailyPlan.command}
                </button>
                <button className="secondary" onClick={hydrateExamForm}>
                  Klausurplan bearbeiten
                </button>
                <button className="secondary" onClick={() => setStep('material')}>
                  Neues Dokument
                </button>
              </div>
            </div>
          )}

          {step === 'material' && <MaterialImport />}

          {step === 'exam-setup' && <ExamSetup />}

          {step === 'session' && <StudySession />}

          {step === 'done' && <SessionDone />}

          {activeDocument && step !== 'session' && (
            <div className="library-actions">
              <button className="secondary" onClick={() => exportAnki()}>
                Anki CSV
              </button>
              <button className="secondary" onClick={() => exportMarkdown()}>
                Markdown
              </button>
              <button className="secondary danger" onClick={() => deleteDocument(activeDocument.id)}>
                Dokument löschen
              </button>
            </div>
          )}
        </section>
      </section>
    </main>
  )
}

function MainApp() {
  const { hydrated, isHydrating, hydrationError, retryHydration } = useStudyLock()
  return (
    <StartupHydrationBarrier
      hydrated={hydrated}
      isHydrating={isHydrating}
      hydrationError={hydrationError}
      retryHydration={retryHydration}
    >
      <WritableApp />
    </StartupHydrationBarrier>
  )
}

export function App() {
  return (
    <ToastProvider>
      <StudyLockProvider>
        <MainApp />
      </StudyLockProvider>
    </ToastProvider>
  )
}

export default App
