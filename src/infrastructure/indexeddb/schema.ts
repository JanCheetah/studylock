import type { DBSchema } from 'idb'
import type {
  MetaRecord,
  OutboxRecord,
  OutboxStatus,
  PersistedAttempt,
  PersistedDocument,
  PersistedExamProfile,
  PersistedSession,
  PersistedStudyItem,
  SyncStatus,
  UUID,
} from '../../domain/entities'

export const STUDYLOCK_DB_NAME = 'studylock-v2'
export const STUDYLOCK_DB_VERSION = 1
export const STUDYLOCK_STORE_NAMES = [
  'meta',
  'documents',
  'examProfiles',
  'studyItems',
  'sessions',
  'attempts',
  'outbox',
] as const

export interface StudyLockDatabaseSchema extends DBSchema {
  meta: {
    key: MetaRecord['key']
    value: MetaRecord
  }
  documents: {
    key: UUID
    value: PersistedDocument
    indexes: {
      'by-updated-at': string
      'by-sync-status': SyncStatus
    }
  }
  examProfiles: {
    key: UUID
    value: PersistedExamProfile
    indexes: {
      'by-updated-at': string
      'by-sync-status': SyncStatus
    }
  }
  studyItems: {
    key: UUID
    value: PersistedStudyItem
    indexes: {
      'by-document': UUID
      'by-due-date': string
      'by-document-and-due-date': [UUID, string]
      'by-sync-status': SyncStatus
    }
  }
  sessions: {
    key: UUID
    value: PersistedSession
    indexes: {
      'by-created-at': string
      'by-sync-status': SyncStatus
    }
  }
  attempts: {
    key: UUID
    value: PersistedAttempt
    indexes: {
      'by-session': UUID
      'by-study-item': UUID
      'by-sync-status': SyncStatus
    }
  }
  outbox: {
    key: UUID
    value: OutboxRecord
    indexes: {
      'by-status': OutboxStatus
      'by-created-at': string
      'by-status-and-created-at': [OutboxStatus, string]
    }
  }
}
