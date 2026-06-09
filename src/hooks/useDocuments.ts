import { useState, useEffect } from 'react'
import type { StudyDocument, SourceType, Step } from '../types'
import { safeParse, saveJson, storageKeys } from '../lib/storage'
import { normalizeText, buildItems, sampleText, download, calculateReadiness, id } from '../lib/studyEngine'
import { extractFileText } from '../lib/pdf'
import { persistRepositoryWrite } from '../lib/persist'
import { generateStudyItemsWithAi } from '../lib/ai'
import { isAIAvailable } from '../lib/aiStudyEngine'

const generationInputHash = async (text: string) => {
  if (globalThis.crypto?.subtle) {
    const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
    return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('')
  }

  return `len-${text.length}`
}

export function useDocuments(
  setStep: (step: Step) => void,
  activeExamProfileId: string | null
) {
  const [documents, setDocuments] = useState<StudyDocument[]>(() => safeParse(storageKeys.documents, []))
  const [activeDocumentId, setActiveDocumentId] = useState<string | null>(() => safeParse<string | null>(storageKeys.activeDocument, null))
  const [documentTitle, setDocumentTitle] = useState('Mein Skript')
  const [material, setMaterial] = useState(sampleText)
  const [sourceType, setSourceType] = useState<SourceType>('paste')
  const [fileStatus, setFileStatus] = useState('')
  const [isGenerating, setIsGenerating] = useState(false)
  const [generationStatus, setGenerationStatus] = useState('')

  useEffect(() => saveJson(storageKeys.documents, documents), [documents])
  useEffect(() => saveJson(storageKeys.activeDocument, activeDocumentId), [activeDocumentId])

  const activeDocument = documents.find((doc) => doc.id === activeDocumentId) ?? null

  const upsertDocument = async (text = material) => {
    const clean = normalizeText(text)
    if (!clean) return
    const docId = id('doc')

    setIsGenerating(true)
    setGenerationStatus('Starte Fragen-Generierung...')

    try {
      const hash = await generationInputHash(clean)
      const result = await generateStudyItemsWithAi(docId, subject, clean, setGenerationStatus)

      const newDocument: StudyDocument = {
        id: docId,
        title: documentTitle || 'Unbenanntes Skript',
        subject,
        sourceType,
        text: clean,
        examProfileId: activeExamProfileId ?? undefined,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        items: result.items,
      }
      setDocuments((prev) => [newDocument, ...prev])
      setActiveDocumentId(docId)
      persistRepositoryWrite(async (repository) => {
        await repository.saveDocument(newDocument)
        
        const isSuccess = result.source === 'openrouter'
        await repository.recordAiGeneration({
          documentId: docId,
          status: isSuccess ? 'succeeded' : 'failed',
          provider: isSuccess ? 'openrouter' : 'local',
          model: result.model || (isSuccess ? 'openrouter/owl-alpha' : 'heuristic-v1'),
          promptVersion: result.promptVersion || 'v1',
          inputHash: hash,
          itemsCount: result.items.length,
          errorMessage: result.error,
        })
      })

      if (result.source === 'openrouter') {
        setGenerationStatus(`✓ ${result.items.length} AI-generierte Prüfungsfragen erstellt!`)
      } else {
        if (result.error === 'OpenRouter rate-limited') {
          setGenerationStatus('OpenRouter rate-limited – Fallback genutzt.')
        } else {
          setGenerationStatus('KI gerade nicht verfügbar – lokaler Fallback genutzt.')
        }
      }
      setStep('exam-setup')
    } catch (error) {
      console.warn('AI generation critical failure, using templates:', error)
      setGenerationStatus('KI gerade nicht verfügbar – lokaler Fallback genutzt.')
      const items = buildItems(docId, subject, clean)
      const newDocument: StudyDocument = {
        id: docId,
        title: documentTitle || 'Unbenanntes Skript',
        subject,
        sourceType,
        text: clean,
        examProfileId: activeExamProfileId ?? undefined,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        items,
      }
      setDocuments((prev) => [newDocument, ...prev])
      setActiveDocumentId(docId)
      persistRepositoryWrite(async (repository) => {
        await repository.saveDocument(newDocument)
        await repository.recordAiGeneration({
          documentId: docId,
          status: 'failed',
          provider: 'local',
          model: 'heuristic-v1',
          promptVersion: 'study-items-v1',
          inputHash: await generationInputHash(clean),
          itemsCount: items.length,
          errorMessage: error instanceof Error ? error.message : 'AI generation failed; heuristic fallback used',
        })
      })
      setStep('exam-setup')
    } finally {
      setIsGenerating(false)
    }
  }

  const handleFile = async (file: File | undefined) => {
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

  const handleFileDrop = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const file = e.dataTransfer.files[0]
    if (file) handleFile(file)
  }

  const deleteDocument = (documentId: string) => {
    setDocuments((prev) => prev.filter((doc) => doc.id !== documentId))
    persistRepositoryWrite((repository) => repository.deleteDocument(documentId))
    if (activeDocumentId === documentId) setActiveDocumentId(null)
  }

  const exportMarkdown = (doc = activeDocument) => {
    if (!doc) return
    const content = `# ${doc.title}\n\nFach: ${doc.subject}\nReadiness: ${calculateReadiness(doc.items)}%\n\n## Lernfragen\n\n${doc.items.map((item, index) => `### ${index + 1}. ${item.question}\n\nAntwort/Quelle: ${item.answer}\n\n- Thema: ${item.topic}\n- Typ: ${item.type}\n- Schwierigkeit: ${item.difficulty}\n- Letzte Bewertung: ${item.lastRating ?? 'offen'}\n- Fällig: ${new Date(item.dueAt).toLocaleDateString('de-DE')}\n`).join('\n')}`
    download(`${doc.title}-studylock.md`, content, 'text/markdown')
  }

  const exportAnki = (doc = activeDocument) => {
    if (!doc) return
    const rows = doc.items.map((item) => `"${item.question.replaceAll('"', '""')}";"${item.answer.replaceAll('"', '""')}";"${doc.subject};${item.topic}"`)
    download(`${doc.title}-anki.csv`, rows.join('\n'), 'text/csv')
  }

  // Derived subject state for input forms
  const [subject, setSubject] = useState('Rechnungswesen')

  const useAI = isAIAvailable()

  return {
    documents,
    setDocuments,
    activeDocumentId,
    setActiveDocumentId,
    activeDocument,
    documentTitle,
    setDocumentTitle,
    subject,
    setSubject,
    material,
    setMaterial,
    sourceType,
    setSourceType,
    fileStatus,
    setFileStatus,
    isGenerating,
    generationStatus,
    upsertDocument,
    handleFile,
    handleFileDrop,
    deleteDocument,
    exportMarkdown,
    exportAnki,
    useAI,
  }
}
