import type { AppStateSnapshot, ExamProfile, RepositoryStatus, SessionResult, StudyDocument, StudyItem } from '../../types'
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

  async saveSnapshot(snapshot: AppStateSnapshot): Promise<void> {
    saveJson(storageKeys.documents, snapshot.documents)
    saveJson(storageKeys.examProfiles, snapshot.examProfiles)
    saveJson(storageKeys.results, snapshot.results)
  }
}
