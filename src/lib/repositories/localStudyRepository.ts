import type { AiGenerationLog, AppStateSnapshot, DocumentChunk, ExamProfile, RepositoryStatus, SessionResult, StudyAttempt, StudyDocument, StudyItem } from '../../types'
import { safeParse, saveJson, storageKeys } from '../storage'
import type { StudyRepository } from './studyRepository'

export class LocalStudyRepository implements StudyRepository {
  async status(): Promise<RepositoryStatus> {
    return {
      mode: 'local',
      configured: true,
      authenticated: true,
      label: 'Lokaler Modus',
      detail: 'Daten liegen im Browser-localStorage. Perfekt für Demo/Friend-Test, noch keine Cloud-Sync.',
    }
  }

  async loadSnapshot(): Promise<AppStateSnapshot> {
    return {
      documents: safeParse<StudyDocument[]>(storageKeys.documents, []),
      examProfiles: safeParse<ExamProfile[]>(storageKeys.examProfiles, []),
      results: safeParse<SessionResult[]>(storageKeys.results, []),
      attempts: safeParse<StudyAttempt[]>(storageKeys.attempts, []),
    }
  }

  async saveDocument(document: StudyDocument): Promise<void> {
    const documents = safeParse<StudyDocument[]>(storageKeys.documents, [])
    saveJson(storageKeys.documents, [document, ...documents.filter((item) => item.id !== document.id)])
  }

  async deleteDocument(documentId: string): Promise<void> {
    const documents = safeParse<StudyDocument[]>(storageKeys.documents, [])
    saveJson(storageKeys.documents, documents.filter((item) => item.id !== documentId))
  }

  async saveExamProfile(profile: ExamProfile): Promise<void> {
    const profiles = safeParse<ExamProfile[]>(storageKeys.examProfiles, [])
    saveJson(storageKeys.examProfiles, [profile, ...profiles.filter((item) => item.id !== profile.id)])
  }

  async saveStudyItems(documentId: string, items: StudyItem[]): Promise<void> {
    const documents = safeParse<StudyDocument[]>(storageKeys.documents, [])
    saveJson(storageKeys.documents, documents.map((doc) => doc.id === documentId ? { ...doc, items, updatedAt: new Date().toISOString() } : doc))
  }

  async saveSession(result: SessionResult): Promise<void> {
    const results = safeParse<SessionResult[]>(storageKeys.results, [])
    saveJson(storageKeys.results, [result, ...results.filter((item) => item.id !== result.id)].slice(0, 50))
  }

  async saveStudyAttempts(attempts: StudyAttempt[]): Promise<void> {
    if (!attempts.length) return
    const existing = safeParse<StudyAttempt[]>(storageKeys.attempts, [])
    const attemptIds = new Set(attempts.map((attempt) => attempt.id))
    saveJson(storageKeys.attempts, [...attempts, ...existing.filter((attempt) => !attemptIds.has(attempt.id))].slice(0, 500))
  }

  async recordAiGeneration(_log: AiGenerationLog): Promise<void> {
    // Local mode has no durable audit table; generated items still carry generationSource.
  }

  async saveDocumentChunks(_documentId: string, _chunks: DocumentChunk[]): Promise<void> {
    // Local mode does not persist raw document chunks to separate localStorage partitions.
  }

  async saveSnapshot(snapshot: AppStateSnapshot): Promise<void> {
    saveJson(storageKeys.documents, snapshot.documents)
    saveJson(storageKeys.examProfiles, snapshot.examProfiles)
    saveJson(storageKeys.results, snapshot.results)
    if (snapshot.attempts) {
      saveJson(storageKeys.attempts, snapshot.attempts)
    }
  }
}
