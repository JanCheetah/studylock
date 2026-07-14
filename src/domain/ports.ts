import type {
  ISODateTime,
  MetaKey,
  MetaRecord,
  OutboxRecord,
  PersistedAttempt,
  PersistedDocument,
  PersistedExamProfile,
  PersistedSession,
  PersistedStudyItem,
  UUID,
} from './entities'

export type CompleteSessionInput = {
  session: PersistedSession
  attempts: readonly PersistedAttempt[]
  updatedStudyItems: readonly PersistedStudyItem[]
  outboxEntries: readonly OutboxRecord[]
}

export type CompleteSessionOutput = {
  session: PersistedSession
  attempts: readonly PersistedAttempt[]
  updatedStudyItems: readonly PersistedStudyItem[]
  outboxEntries: readonly OutboxRecord[]
}

export type ReplaceDocumentAggregateInput = {
  document: PersistedDocument
  /** The complete desired child collection, not a partial patch. */
  studyItems: readonly PersistedStudyItem[]
}

/** A coherent, normalized view of the V2 domain stores at one commit boundary. */
export type V2StudySnapshot = {
  documents: readonly PersistedDocument[]
  studyItems: readonly PersistedStudyItem[]
  examProfiles: readonly PersistedExamProfile[]
  sessions: readonly PersistedSession[]
  attempts: readonly PersistedAttempt[]
}

/**
 * Framework-independent boundary for the V2 local database.
 * Implementations must commit completeSession as one atomic transaction.
 */
export interface LocalStudyStore {
  loadSnapshot(): Promise<V2StudySnapshot>

  getMeta(key: MetaKey): Promise<MetaRecord | undefined>
  putMeta(record: MetaRecord): Promise<void>

  getDocument(id: UUID): Promise<PersistedDocument | undefined>
  listDocuments(): Promise<readonly PersistedDocument[]>
  putDocument(document: PersistedDocument): Promise<void>
  replaceDocumentAggregate(input: ReplaceDocumentAggregateInput): Promise<void>
  /** Atomically deletes the document and all of its study-item children. */
  deleteDocument(id: UUID): Promise<void>

  getExamProfile(id: UUID): Promise<PersistedExamProfile | undefined>
  listExamProfiles(): Promise<readonly PersistedExamProfile[]>
  putExamProfile(profile: PersistedExamProfile): Promise<void>

  getStudyItem(id: UUID): Promise<PersistedStudyItem | undefined>
  listStudyItemsByDocument(documentId: UUID): Promise<readonly PersistedStudyItem[]>
  listDueStudyItems(dueAtOrBefore: ISODateTime): Promise<readonly PersistedStudyItem[]>
  putStudyItems(items: readonly PersistedStudyItem[]): Promise<void>

  getSession(id: UUID): Promise<PersistedSession | undefined>
  listSessions(): Promise<readonly PersistedSession[]>
  listAttemptsBySession(sessionId: UUID): Promise<readonly PersistedAttempt[]>

  listPendingOutboxEntries(): Promise<readonly OutboxRecord[]>
  putOutboxEntry(entry: OutboxRecord): Promise<void>

  completeSession(input: CompleteSessionInput): Promise<CompleteSessionOutput>
}
