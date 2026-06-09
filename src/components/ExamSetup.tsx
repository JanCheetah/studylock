import { useStudyLock } from '../context/StudyLockContext'
import type { ExamGoal, Confidence } from '../types'

export function ExamSetup() {
  const {
    subject,
    setSubject,
    examDate,
    setExamDate,
    examGoal,
    setExamGoal,
    minutes,
    setMinutes,
    confidence,
    setConfidence,
    saveExamProfile,
    setStep,
  } = useStudyLock()

  return (
    <div className="flow">
      <span className="step-label">3 / Klausurprofil</span>
      <h2>Wofür muss StudyLock dich verantwortlich halten?</h2>
      <div className="form-grid">
        <label>
          Fach / Modul
          <input value={subject} onChange={(event) => setSubject(event.target.value)} />
        </label>
        <label>
          Klausurdatum
          <input type="date" value={examDate} onChange={(event) => setExamDate(event.target.value)} />
        </label>
        <label>
          Ziel
          <select value={examGoal} onChange={(event) => setExamGoal(event.target.value as ExamGoal)}>
            <option value="bestehen">Nur bestehen</option>
            <option value="gut">2,x schaffen</option>
            <option value="sehr-gut">1,x angreifen</option>
          </select>
        </label>
        <label>
          Minuten pro Tag
          <select value={minutes} onChange={(event) => setMinutes(Number(event.target.value))}>
            <option value={10}>10 Minuten Notfall</option>
            <option value={25}>25 Minuten realistisch</option>
            <option value={50}>50 Minuten Fokus</option>
            <option value={90}>90 Minuten Klausurblock</option>
          </select>
        </label>
      </div>
      <label>
        Gefühl aktuell: {confidence}/5
        <input
          type="range"
          min="1"
          max="5"
          value={confidence}
          onChange={(event) => setConfidence(Number(event.target.value) as Confidence)}
        />
      </label>
      <div className="decision-box">
        <strong>Warum das zählt:</strong> Ohne Deadline ist StudyLock nur ein PDF-Tool. Mit Deadline wird daraus ein
        tägliche Prüfungsbefehl.
      </div>
      <div className="hero-actions">
        <button onClick={saveExamProfile}>Klausurprofil speichern</button>
        <button className="secondary" onClick={() => setStep('checkin')}>
          Später
        </button>
      </div>
    </div>
  )
}

export default ExamSetup
