import { useState } from 'react'
import { useStudyLock } from '../context/studyLockContextValue'
import { sampleText } from '../lib/studyEngine'

export function MaterialImport() {
  const {
    documentTitle,
    setDocumentTitle,
    subject,
    setSubject,
    handleFile,
    handleFileDrop,
    fileStatus,
    material,
    setMaterial,
    upsertDocument,
    setSourceType,
    isGenerating,
    generationStatus,
    useAI,
  } = useStudyLock()

  const [isDragging, setIsDragging] = useState(false)

  const loadDemo = () => {
    setDocumentTitle('Rechnungswesen Demo')
    setSubject('Rechnungswesen')
    setSourceType('paste')
    setMaterial(sampleText)
  }

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(true)
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
  }

  const onDrop = (e: React.DragEvent) => {
    setIsDragging(false)
    handleFileDrop(e)
  }

  return (
    <div className="flow">
      <span className="step-label">2 / Import</span>
      <h2>PDF, TXT oder Skript einfügen</h2>
      {useAI && (
        <div className="ai-badge">
          <span className="ai-status-dot active" />
          AI-Generierung aktiv – Fragen werden intelligent aus deinem Material erstellt
        </div>
      )}
      <div className="form-grid">
        <label>
          Titel
          <input value={documentTitle} onChange={(event) => setDocumentTitle(event.target.value)} />
        </label>
        <label>
          Fach / Modul
          <input value={subject} onChange={(event) => setSubject(event.target.value)} />
        </label>
      </div>
      <label
        className={`file-drop${isDragging ? ' file-drop-active' : ''}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={onDrop}
      >
        <div className="file-drop-content">
          <span className="file-drop-icon">{isDragging ? '📥' : '📄'}</span>
          <span>{isDragging ? 'Datei hier ablegen...' : 'PDF/TXT/MD hierher ziehen oder klicken'}</span>
        </div>
        <input
          type="file"
          accept=".pdf,.txt,.md,text/plain,application/pdf"
          onChange={(event) => handleFile(event.target.files?.[0])}
          style={{ display: 'none' }}
        />
      </label>
      {fileStatus && <p className="nudge">{fileStatus}</p>}
      <textarea
        value={material}
        onChange={(event) => setMaterial(event.target.value)}
        placeholder="Skript, Folien-Text oder eigene Notizen hier einfügen..."
      />

      {isGenerating && (
        <div className="generation-progress">
          <div className="generation-spinner" />
          <span>{generationStatus}</span>
        </div>
      )}

      <div className="hero-actions">
        <button onClick={() => upsertDocument()} disabled={isGenerating || !material.trim()}>
          {isGenerating ? 'Generiere...' : useAI ? '🤖 AI-Fragen generieren & speichern' : 'Dokument speichern & Klausurplan bauen'}
        </button>
        <button className="secondary" onClick={loadDemo} disabled={isGenerating}>
          Demo laden
        </button>
      </div>
    </div>
  )
}

export default MaterialImport
