import type { AiGenerationLog, AppStateSnapshot, ExamProfile, RepositoryStatus, SessionResult, StudyAttempt, StudyDocument, StudyItem } from '../../types'

export type StudyRepository = {
  status(): Promise<RepositoryStatus>
  loadSnapshot(): Promise<AppStateSnapshot>
  saveDocument(document: StudyDocument): Promise<void>
  deleteDocument(documentId: string): Promise<void>
  saveExamProfile(profile: ExamProfile): Promise<void>
  saveStudyItems(documentId: string, items: StudyItem[]): Promise<void>
  saveSession(result: SessionResult): Promise<void>
  saveStudyAttempts(attempts: StudyAttempt[]): Promise<void>
  recordAiGeneration(log: AiGenerationLog): Promise<void>
  saveSnapshot(snapshot: AppStateSnapshot): Promise<void>
}
