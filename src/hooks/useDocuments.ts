import { useState, useEffect } from 'react'
import type { StudyDocument, SourceType, Step } from '../types'
import { safeParse, saveJson, storageKeys } from '../lib/storage'
import { normalizeText, buildItems, sampleText, download, calculateReadiness } from '../lib/studyEngine'
import { extractFileText } from '../lib/pdf'
import { persistRepositoryWrite } from '../lib/persist'
import { generateItemsFromText, isAIAvailable } from '../lib/aiStudyEngine'

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

  const id = (prefix: string) => `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`

  const upsertDocument = async (text = material) => {
    const clean = normalizeText(text)
    if (!clean) return
    const docId = id('doc')

    setIsGenerating(true)
    setGenerationStatus('Starte Fragen-Generierung...')

    try {
      const { items, aiGenerated } = await generateItemsFromText(
        docId,
        subject,
        clean,
        20,
        setGenerationStatus
      )

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
          status: aiGenerated ? 'succeeded' : 'failed',
          provider: aiGenerated ? 'openrouter' : 'local',
          model: aiGenerated ? 'openrouter/optimus-alpha' : 'heuristic-v1',
          promptVersion: 'study-items-v1',
          inputHash: await generationInputHash(clean),
          itemsCount: items.length,
          errorMessage: aiGenerated ? undefined : 'AI unavailable or failed; heuristic fallback used',
        })
      })
      setGenerationStatus(
        aiGenerated
          ? `✓ ${items.length} AI-generierte Prüfungsfragen erstellt!`
          : `✓ ${items.length} Template-Fragen erstellt.`
      )
      setStep('exam-setup')
    } catch (error) {
      // Fallback to template generation on any error
      console.warn('AI generation failed, using templates:', error)
      setGenerationStatus('Fallback: Template-Fragen werden erstellt...')
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
