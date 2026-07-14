import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it } from 'vitest'
import type { PersistedAttempt, PersistedDocument } from '../../domain/entities'
import {
  closeStudyLockDatabase,
  openStudyLockDatabase,
} from './database'
import {
  STUDYLOCK_DB_NAME,
  STUDYLOCK_DB_VERSION,
  STUDYLOCK_STORE_NAMES,
} from './schema'
import { resetStudyLockDatabaseForTests } from './testSupport'

const firstId = '018f47b4-0b7a-7c25-8d3f-123456789abc'
const secondId = '018f47b4-0b7a-7c25-8d3f-abcdef012345'
const timestamp = '2026-07-14T10:00:00.000Z'

const metadata = {
  createdAt: timestamp,
  updatedAt: timestamp,
  version: 1,
  deviceId: 'device-test',
  syncStatus: 'local' as const,
}

afterEach(async () => {
  closeStudyLockDatabase()
  await resetStudyLockDatabaseForTests()
})

describe('StudyLock IndexedDB', () => {
  it('creates the versioned database with exactly the V2 stores and useful indexes', async () => {
    const database = await openStudyLockDatabase()

    expect(database.name).toBe(STUDYLOCK_DB_NAME)
    expect(database.version).toBe(STUDYLOCK_DB_VERSION)
    expect(Array.from(database.objectStoreNames)).toEqual([...STUDYLOCK_STORE_NAMES].sort())

    const transaction = database.transaction(
      ['studyItems', 'attempts', 'outbox'],
      'readonly',
    )

    expect(Array.from(transaction.objectStore('studyItems').indexNames)).toEqual(
      expect.arrayContaining(['by-document', 'by-due-date', 'by-document-and-due-date']),
    )
    expect(Array.from(transaction.objectStore('attempts').indexNames)).toContain('by-session')
    expect(Array.from(transaction.objectStore('outbox').indexNames)).toEqual(
      expect.arrayContaining(['by-status', 'by-created-at', 'by-status-and-created-at']),
    )
    await transaction.done
  })

  it('round-trips UUID-shaped persisted entities through typed stores', async () => {
    const database = await openStudyLockDatabase()
    const document: PersistedDocument = {
      id: firstId,
      ...metadata,
      title: 'Operations Research',
      subject: 'OR',
      sourceType: 'paste',
      text: 'Simplex method',
    }
    const attempt: PersistedAttempt = {
      id: secondId,
      ...metadata,
      sessionId: firstId,
      studyItemId: secondId,
      userAnswer: 'Use a pivot operation.',
      rating: 'good',
    }

    await database.put('documents', document)
    await database.put('attempts', attempt)

    await expect(database.get('documents', firstId)).resolves.toEqual(document)
    await expect(database.get('attempts', secondId)).resolves.toEqual(attempt)
  })
})
