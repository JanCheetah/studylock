import { openDB, type IDBPDatabase } from 'idb'
import {
  STUDYLOCK_DB_NAME,
  STUDYLOCK_DB_VERSION,
  type StudyLockDatabaseSchema,
} from './schema'

export type StudyLockDatabase = IDBPDatabase<StudyLockDatabaseSchema>

let activeDatabase: StudyLockDatabase | undefined
let openingDatabase: Promise<StudyLockDatabase> | undefined
let connectionGeneration = 0

export function openStudyLockDatabase(): Promise<StudyLockDatabase> {
  if (activeDatabase) return Promise.resolve(activeDatabase)
  if (openingDatabase) return openingDatabase

  const openingGeneration = connectionGeneration
  let openedDatabase: StudyLockDatabase | undefined
  openingDatabase = openDB<StudyLockDatabaseSchema>(
    STUDYLOCK_DB_NAME,
    STUDYLOCK_DB_VERSION,
    {
      upgrade(database, oldVersion) {
        if (oldVersion < 1) {
          database.createObjectStore('meta', { keyPath: 'key' })

          const documents = database.createObjectStore('documents', { keyPath: 'id' })
          documents.createIndex('by-updated-at', 'updatedAt')
          documents.createIndex('by-sync-status', 'syncStatus')

          const examProfiles = database.createObjectStore('examProfiles', { keyPath: 'id' })
          examProfiles.createIndex('by-updated-at', 'updatedAt')
          examProfiles.createIndex('by-sync-status', 'syncStatus')

          const studyItems = database.createObjectStore('studyItems', { keyPath: 'id' })
          studyItems.createIndex('by-document', 'documentId')
          studyItems.createIndex('by-due-date', 'dueAt')
          studyItems.createIndex('by-document-and-due-date', ['documentId', 'dueAt'])
          studyItems.createIndex('by-sync-status', 'syncStatus')

          const sessions = database.createObjectStore('sessions', { keyPath: 'id' })
          sessions.createIndex('by-created-at', 'createdAt')
          sessions.createIndex('by-sync-status', 'syncStatus')

          const attempts = database.createObjectStore('attempts', { keyPath: 'id' })
          attempts.createIndex('by-session', 'sessionId')
          attempts.createIndex('by-study-item', 'studyItemId')
          attempts.createIndex('by-sync-status', 'syncStatus')

          const outbox = database.createObjectStore('outbox', { keyPath: 'id' })
          outbox.createIndex('by-status', 'status')
          outbox.createIndex('by-created-at', 'createdAt')
          outbox.createIndex('by-status-and-created-at', ['status', 'createdAt'])
        }
      },
      terminated() {
        if (
          connectionGeneration !== openingGeneration ||
          activeDatabase !== openedDatabase
        ) {
          return
        }
        activeDatabase = undefined
        openingDatabase = undefined
        connectionGeneration += 1
      },
    },
  )
    .then((database) => {
      if (connectionGeneration !== openingGeneration) {
        database.close()
        return database
      }

      openedDatabase = database
      activeDatabase = database
      openingDatabase = undefined
      database.addEventListener('versionchange', () => {
        database.close()
        if (activeDatabase === database) activeDatabase = undefined
      })
      return database
    })
    .catch((error: unknown) => {
      if (connectionGeneration === openingGeneration) openingDatabase = undefined
      throw error
    })

  return openingDatabase
}

/** Closes the shared connection, for app shutdown and deterministic test cleanup. */
export function closeStudyLockDatabase(): void {
  connectionGeneration += 1
  activeDatabase?.close()
  activeDatabase = undefined
  openingDatabase = undefined
}
