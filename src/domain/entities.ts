import type {
  ExamProfile,
  SessionResult,
  StudyAttempt,
  StudyDocument,
  StudyItem,
} from '../types'

/** A stable UUID used as the identity of persisted and syncable records. */
export type UUID = `${string}-${string}-${string}-${string}-${string}`
export type ISODateTime = string
export type DeviceId = string

export type SyncStatus = 'local' | 'pending' | 'synced' | 'failed'

export type PersistenceMetadata = {
  id: UUID
  createdAt: ISODateTime
  updatedAt: ISODateTime
  version: number
  deviceId: DeviceId
  syncStatus: SyncStatus
}

/** Documents and items are stored separately in V2, rather than nested. */
export type PersistedDocument = PersistenceMetadata &
  Omit<StudyDocument, 'id' | 'createdAt' | 'updatedAt' | 'items' | 'examProfileId'> & {
    examProfileId?: UUID
  }

export type PersistedExamProfile = PersistenceMetadata &
  Omit<ExamProfile, 'id' | 'createdAt' | 'updatedAt'>

export type PersistedStudyItem = PersistenceMetadata & Omit<StudyItem, 'id' | 'documentId'> & {
  documentId: UUID
}

export type PersistedSession = PersistenceMetadata & Omit<SessionResult, 'id'> & {
  /**
   * Versioned digest of the privacy-safe completion semantics. Optional only
   * because sessions imported by the legacy migration predate this field.
   */
  completionFingerprint?: string
}

export type PersistedAttempt = PersistenceMetadata &
  Omit<StudyAttempt, 'id' | 'createdAt' | 'sessionId' | 'studyItemId'> & {
    sessionId: UUID
    studyItemId: UUID
  }

export type MetaKey = 'deviceId' | 'schemaVersion' | 'lastSyncAt' | 'legacyMigrationV1'

export type MetaRecord = {
  key: MetaKey
  value: unknown
  updatedAt: ISODateTime
}

export type SyncableEntityType =
  | 'document'
  | 'examProfile'
  | 'studyItem'
  | 'session'
  | 'attempt'

export type OutboxStatus = 'pending' | 'processing' | 'failed'
export type OutboxOperation = 'put' | 'delete'

/** The deliberately minimal, privacy-safe description of a completed session. */
export type SessionFinishedOutboxPayload = {
  eventType: 'session.finished'
  sessionId: UUID
  attemptIds: readonly UUID[]
  studyItems: readonly {
    id: UUID
    dueAt: ISODateTime
    intervalDays: number
    repetitions: number
    lastRating?: StudyItem['lastRating']
    easeFactor?: number
  }[]
}

export type OutboxPayload = SessionFinishedOutboxPayload

/**
 * Queue lifecycle is represented by status. Unlike syncable entities, outbox
 * records do not also carry syncStatus, avoiding two competing state fields.
 */
export type OutboxRecord = Omit<PersistenceMetadata, 'syncStatus'> & {
  entityType: SyncableEntityType
  entityId: UUID
  operation: OutboxOperation
  payload: OutboxPayload
  status: OutboxStatus
  attempts: number
  lastError?: string
}
