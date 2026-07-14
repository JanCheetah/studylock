import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { storageKeys } from '../../lib/storage'
import { closeStudyLockDatabase, openStudyLockDatabase } from './database'
import {
  LEGACY_MIGRATION_META_KEY,
  migrateLegacyLocalStorage,
  type LegacyStorageReader,
} from './legacyMigration'
import { resetStudyLockDatabaseForTests } from './testSupport'

const now = '2026-07-14T12:00:00.000Z'
const validProfileId = '018f47b4-0b7a-7c25-8d3f-123456789abc'
const generatedIds = [
  '11111111-1111-4111-8111-111111111111',
  '22222222-2222-4222-8222-222222222222',
  '33333333-3333-4333-8333-333333333333',
  '44444444-4444-4444-8444-444444444444',
  '55555555-5555-4555-8555-555555555555',
] as const

class MemoryStorage implements LegacyStorageReader {
  private readonly values: Record<string, string>

  constructor(values: Record<string, string> = {}) {
    this.values = values
  }

  getItem(key: string): string | null {
    return this.values[key] ?? null
  }

  snapshot(): Record<string, string> {
    return { ...this.values }
  }
}

function populatedStorage(): MemoryStorage {
  return new MemoryStorage({
    [storageKeys.documents]: JSON.stringify([
      {
        id: 'legacy-document',
        title: 'Operations Research',
        subject: 'OR',
        sourceType: 'paste',
        text: 'Simplex method',
        examProfileId: validProfileId,
        createdAt: '2026-07-10T10:00:00.000Z',
        updatedAt: '2026-07-11T10:00:00.000Z',
        items: [
          {
            id: 'legacy-document-0-recall',
            documentId: 'legacy-document',
            topic: 'Simplex',
            question: 'What is a pivot?',
            answer: 'A basis exchange.',
            source: 'Simplex method',
            difficulty: 'mittel',
            type: 'karte',
            dueAt: '2026-07-15T10:00:00.000Z',
            intervalDays: 1,
            repetitions: 0,
            easeFactor: 2.5,
          },
        ],
      },
    ]),
    [storageKeys.examProfiles]: JSON.stringify([
      {
        id: validProfileId,
        subject: 'OR',
        examDate: '2026-08-01',
        dailyMinutes: 25,
        goal: 'gut',
        confidence: 3,
        createdAt: '2026-07-09T10:00:00.000Z',
        updatedAt: '2026-07-12T10:00:00.000Z',
      },
    ]),
    [storageKeys.results]: JSON.stringify([
      {
        id: 'session-legacy',
        date: '2026-07-13',
        subject: 'OR',
        documentTitle: 'Operations Research',
        mode: 'recall',
        score: 80,
        minutes: 20,
        answered: 5,
        blockers: 1,
        readinessAfter: 70,
      },
    ]),
    [storageKeys.attempts]: JSON.stringify([
      {
        id: 'attempt-legacy',
        sessionId: 'session-legacy',
        studyItemId: 'legacy-document-0-recall',
        userAnswer: 'Exchange the basis.',
        rating: 'good',
        createdAt: '2026-07-13T10:20:00.000Z',
      },
    ]),
  })
}

function deterministicUuid() {
  let index = 0
  return () => generatedIds[index++] ?? '66666666-6666-4666-8666-666666666666'
}

afterEach(async () => {
  closeStudyLockDatabase()
  await resetStudyLockDatabaseForTests()
})

describe('legacy localStorage migration', () => {
  it('imports every legacy collection, separates nested items, repairs UUIDs and references, and preserves legacy data', async () => {
    const storage = populatedStorage()
    const before = storage.snapshot()
    const database = await openStudyLockDatabase()

    const result = await migrateLegacyLocalStorage({
      storage,
      database,
      now: () => now,
      randomUUID: deterministicUuid(),
    })

    expect(result).toEqual({
      status: 'migrated',
      counts: { documents: 1, examProfiles: 1, studyItems: 1, sessions: 1, attempts: 1 },
      warnings: expect.arrayContaining([
        expect.stringContaining('legacy-document'),
        expect.stringContaining('legacy-document-0-recall'),
      ]),
    })

    const documents = await database.getAll('documents')
    const items = await database.getAll('studyItems')
    const profiles = await database.getAll('examProfiles')
    const sessions = await database.getAll('sessions')
    const attempts = await database.getAll('attempts')

    expect(documents).toHaveLength(1)
    expect(documents[0]).not.toHaveProperty('items')
    expect(documents[0]).toMatchObject({
      id: generatedIds[1],
      examProfileId: validProfileId,
      createdAt: '2026-07-10T10:00:00.000Z',
      updatedAt: '2026-07-11T10:00:00.000Z',
      version: 1,
      deviceId: `device-${generatedIds[0]}`,
      syncStatus: 'local',
    })
    expect(items[0]).toMatchObject({ id: generatedIds[2], documentId: generatedIds[1] })
    expect(profiles[0].id).toBe(validProfileId)
    expect(sessions[0]).toMatchObject({
      id: generatedIds[3],
      date: '2026-07-13',
      createdAt: '2026-07-13T00:00:00.000Z',
      updatedAt: '2026-07-13T00:00:00.000Z',
    })
    expect(attempts[0]).toMatchObject({
      id: generatedIds[4],
      sessionId: generatedIds[3],
      studyItemId: generatedIds[2],
      createdAt: '2026-07-13T10:20:00.000Z',
      updatedAt: '2026-07-13T10:20:00.000Z',
      version: 1,
      syncStatus: 'local',
    })
    expect(await database.get('meta', 'deviceId')).toMatchObject({
      key: 'deviceId',
      value: `device-${generatedIds[0]}`,
    })
    expect(await database.get('meta', LEGACY_MIGRATION_META_KEY)).toMatchObject({
      key: LEGACY_MIGRATION_META_KEY,
      value: { completed: true, version: 1, counts: result.counts },
    })
    expect(storage.snapshot()).toEqual(before)
  })

  it('accepts the German short date/time produced for legacy sessions and normalizes only persistence metadata', async () => {
    const values = populatedStorage().snapshot()
    const sessions = JSON.parse(values[storageKeys.results])
    sessions[0].date = '14.07.26, 16:30'
    values[storageKeys.results] = JSON.stringify(sessions)
    const database = await openStudyLockDatabase()

    const result = await migrateLegacyLocalStorage({
      storage: new MemoryStorage(values),
      database,
      now: () => now,
      randomUUID: deterministicUuid(),
    })

    expect(result.status).toBe('migrated')
    expect((await database.getAll('sessions'))[0]).toMatchObject({
      date: '14.07.26, 16:30',
      createdAt: '2026-07-14T16:30:00.000Z',
      updatedAt: '2026-07-14T16:30:00.000Z',
    })
  })

  it('accepts a rating-only legacy attempt with an empty answer', async () => {
    const values = populatedStorage().snapshot()
    const attempts = JSON.parse(values[storageKeys.attempts])
    attempts[0].userAnswer = ''
    values[storageKeys.attempts] = JSON.stringify(attempts)
    const database = await openStudyLockDatabase()

    const result = await migrateLegacyLocalStorage({
      storage: new MemoryStorage(values),
      database,
      now: () => now,
      randomUUID: deterministicUuid(),
    })

    expect(result.status).toBe('migrated')
    expect((await database.getAll('attempts'))[0]).toMatchObject({ userAnswer: '', rating: 'good' })
  })

  it.each([
    ['an impossible German session date', storageKeys.results, (records: Record<string, unknown>[]) => {
      records[0].date = '31.02.26, 16:30'
    }],
    ['an attempt with neither an answer nor a rating', storageKeys.attempts, (records: Record<string, unknown>[]) => {
      records[0].userAnswer = ''
      delete records[0].rating
    }],
  ])('blocks %s', async (_label, key, mutate) => {
    const values = populatedStorage().snapshot()
    const records = JSON.parse(values[key])
    mutate(records)
    values[key] = JSON.stringify(records)

    const result = await migrateLegacyLocalStorage({ storage: new MemoryStorage(values) })

    expect(result.status).toBe('blocked')
    expect(result.warnings[0]).toContain(key)
  })

  it('treats missing keys as a successful empty migration', async () => {
    const result = await migrateLegacyLocalStorage({
      storage: new MemoryStorage(),
      now: () => now,
      randomUUID: deterministicUuid(),
    })

    expect(result).toEqual({
      status: 'migrated',
      counts: { documents: 0, examProfiles: 0, studyItems: 0, sessions: 0, attempts: 0 },
      warnings: [],
    })
    const database = await openStudyLockDatabase()
    expect(await database.get('meta', LEGACY_MIGRATION_META_KEY)).toBeDefined()
  })

  it('is idempotent after success and does not rewrite imported records', async () => {
    const database = await openStudyLockDatabase()
    const storage = populatedStorage()
    const first = await migrateLegacyLocalStorage({
      storage,
      database,
      now: () => now,
      randomUUID: deterministicUuid(),
    })
    const document = (await database.getAll('documents'))[0]
    await database.put('documents', { ...document, title: 'Changed after migration' })

    const second = await migrateLegacyLocalStorage({
      storage,
      database,
      now: () => '2026-07-15T12:00:00.000Z',
      randomUUID: vi.fn(() => {
        throw new Error('must not generate IDs')
      }),
    })

    expect(first.status).toBe('migrated')
    expect(second).toEqual({ status: 'already-migrated', counts: first.counts, warnings: [] })
    expect((await database.getAll('documents'))[0].title).toBe('Changed after migration')
  })

  it.each([
    ['malformed', () => '{broken'],
    ['throwing', () => { throw new Error('storage unavailable') }],
  ])('uses the completion marker before reading %s legacy storage', async (_label, getItem) => {
    const database = await openStudyLockDatabase()
    const first = await migrateLegacyLocalStorage({
      storage: populatedStorage(),
      database,
      now: () => now,
      randomUUID: deterministicUuid(),
    })
    const storage: LegacyStorageReader = { getItem: vi.fn(getItem) }

    const second = await migrateLegacyLocalStorage({ storage, database })

    expect(second).toEqual({ status: 'already-migrated', counts: first.counts, warnings: [] })
    expect(storage.getItem).not.toHaveBeenCalled()
  })

  it('blocks a first migration when reading a legacy key throws and performs no writes', async () => {
    const database = await openStudyLockDatabase()
    const storage: LegacyStorageReader = {
      getItem: vi.fn((key: string) => {
        if (key === storageKeys.examProfiles) throw new Error('storage denied')
        return key === storageKeys.documents ? '[]' : null
      }),
    }

    const result = await migrateLegacyLocalStorage({ storage, database })

    expect(result).toEqual({
      status: 'blocked',
      counts: { documents: 0, examProfiles: 0, studyItems: 0, sessions: 0, attempts: 0 },
      warnings: [expect.stringContaining(storageKeys.examProfiles)],
    })
    expect(await database.count('documents')).toBe(0)
    expect(await database.count('examProfiles')).toBe(0)
    expect(await database.count('studyItems')).toBe(0)
    expect(await database.count('sessions')).toBe(0)
    expect(await database.count('attempts')).toBe(0)
    expect(await database.getAll('meta')).toEqual([])
  })

  it.each([
    ['invalid JSON', '{broken'],
    ['invalid top-level shape', JSON.stringify({ documents: [] })],
  ])('blocks %s and does not write any records or completion marker', async (_label, documents) => {
    const database = await openStudyLockDatabase()
    const storage = new MemoryStorage({
      [storageKeys.documents]: documents,
      [storageKeys.examProfiles]: JSON.stringify([{ id: validProfileId }]),
    })

    const result = await migrateLegacyLocalStorage({ storage, database })

    expect(result.status).toBe('blocked')
    expect(result.warnings).toEqual([expect.stringContaining(storageKeys.documents)])
    expect(await database.count('documents')).toBe(0)
    expect(await database.count('examProfiles')).toBe(0)
    expect(await database.get('meta', LEGACY_MIGRATION_META_KEY)).toBeUndefined()
  })

  it('rolls back all writes and omits the marker when an IndexedDB write fails', async () => {
    const database = await openStudyLockDatabase()
    const originalTransaction = database.transaction.bind(database)
    const failingDatabase = new Proxy(database, {
      get(target, property, receiver) {
        if (property !== 'transaction') return Reflect.get(target, property, receiver)
        return (...args: Parameters<typeof database.transaction>) => {
          const transaction = originalTransaction(...args)
          const originalObjectStore = transaction.objectStore.bind(transaction)
          return new Proxy(transaction, {
            get(transactionTarget, transactionProperty, transactionReceiver) {
              if (transactionProperty !== 'objectStore') {
                const value = Reflect.get(transactionTarget, transactionProperty, transactionReceiver)
                return typeof value === 'function' ? value.bind(transactionTarget) : value
              }
              return (name: Parameters<typeof transaction.objectStore>[0]) => {
                const store = originalObjectStore(name)
                if (name !== 'attempts') return store
                return new Proxy(store, {
                  get(storeTarget, storeProperty, storeReceiver) {
                    if (storeProperty === 'put') return () => Promise.reject(new Error('write failed'))
                    const value = Reflect.get(storeTarget, storeProperty, storeReceiver)
                    return typeof value === 'function' ? value.bind(storeTarget) : value
                  },
                })
              }
            },
          })
        }
      },
    })

    await expect(migrateLegacyLocalStorage({
      storage: populatedStorage(),
      database: failingDatabase,
      now: () => now,
      randomUUID: deterministicUuid(),
    })).rejects.toThrow('write failed')

    expect(await database.count('documents')).toBe(0)
    expect(await database.count('examProfiles')).toBe(0)
    expect(await database.count('studyItems')).toBe(0)
    expect(await database.count('sessions')).toBe(0)
    expect(await database.count('attempts')).toBe(0)
    expect(await database.getAll('meta')).toEqual([])
  })

  it.each([
    ['null document', storageKeys.documents, [null]],
    ['malformed nested item', storageKeys.documents, [{
      ...JSON.parse(populatedStorage().snapshot()[storageKeys.documents])[0],
      items: [{
        ...JSON.parse(populatedStorage().snapshot()[storageKeys.documents])[0].items[0],
        difficulty: 'impossible',
      }],
    }]],
  ])('blocks a %s with a key/index-specific warning before writing', async (_label, key, value) => {
    const values = populatedStorage().snapshot()
    values[key] = JSON.stringify(value)
    const database = await openStudyLockDatabase()
    const result = await migrateLegacyLocalStorage({ storage: new MemoryStorage(values), database })

    expect(result.status).toBe('blocked')
    expect(result.warnings[0]).toContain(key)
    expect(result.warnings[0]).toMatch(/\[0\]/)
    expect(await database.getAll('meta')).toEqual([])
    expect(await database.count('documents')).toBe(0)
  })

  it('blocks duplicate source IDs within an entity type', async () => {
    const values = populatedStorage().snapshot()
    const documents = JSON.parse(values[storageKeys.documents])
    values[storageKeys.documents] = JSON.stringify([documents[0], { ...documents[0], title: 'Duplicate' }])
    const result = await migrateLegacyLocalStorage({ storage: new MemoryStorage(values) })
    expect(result.status).toBe('blocked')
    expect(result.warnings).toEqual(expect.arrayContaining([expect.stringMatching(/documents.*\[1\].*duplicate/i)]))
  })

  it('blocks a target-key collision without overwriting the existing record', async () => {
    const database = await openStudyLockDatabase()
    const existing = {
      id: validProfileId as `${string}-${string}-${string}-${string}-${string}`,
      subject: 'Existing', examDate: '2026-08-02', dailyMinutes: 30, goal: 'gut' as const,
      confidence: 3 as const, createdAt: now, updatedAt: now, version: 1,
      deviceId: 'existing-device', syncStatus: 'local' as const,
    }
    await database.put('examProfiles', existing)
    const result = await migrateLegacyLocalStorage({ storage: populatedStorage(), database, randomUUID: deterministicUuid() })
    expect(result.status).toBe('blocked')
    expect(result.warnings).toEqual([expect.stringMatching(/examProfiles.*collision/i)])
    expect(await database.get('examProfiles', validProfileId)).toEqual(existing)
    expect(await database.count('documents')).toBe(0)
  })

  it.each([
    ['document profile', (values: Record<string, string>) => {
      const records = JSON.parse(values[storageKeys.documents]); records[0].examProfileId = 'missing-profile'
      values[storageKeys.documents] = JSON.stringify(records)
    }],
    ['nested item ownership', (values: Record<string, string>) => {
      const records = JSON.parse(values[storageKeys.documents]); records[0].items[0].documentId = 'other-document'
      values[storageKeys.documents] = JSON.stringify(records)
    }],
    ['attempt parents', (values: Record<string, string>) => {
      const records = JSON.parse(values[storageKeys.attempts]); records[0].sessionId = 'missing-session'
      values[storageKeys.attempts] = JSON.stringify(records)
    }],
  ])('blocks a dangling or mismatched %s reference', async (_label, mutate) => {
    const values = populatedStorage().snapshot(); mutate(values)
    const result = await migrateLegacyLocalStorage({ storage: new MemoryStorage(values), randomUUID: deterministicUuid() })
    expect(result.status).toBe('blocked')
    expect(result.warnings[0]).toMatch(/reference|belong|resolve/i)
  })

  it('blocks when implicit browser storage cannot be acquired', async () => {
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
    Object.defineProperty(globalThis, 'localStorage', {
      configurable: true,
      get: () => { throw new DOMException('denied', 'SecurityError') },
    })
    try {
      const result = await migrateLegacyLocalStorage()
      expect(result.status).toBe('blocked')
      expect(result.warnings).toEqual([expect.stringMatching(/storage.*unavailable/i)])
    } finally {
      if (descriptor) Object.defineProperty(globalThis, 'localStorage', descriptor)
      else delete (globalThis as { localStorage?: Storage }).localStorage
    }
  })

  it('blocks invalid injected UUID output without writes', async () => {
    const database = await openStudyLockDatabase()
    const result = await migrateLegacyLocalStorage({ storage: populatedStorage(), database, randomUUID: () => 'not-a-uuid' })
    expect(result.status).toBe('blocked')
    expect(result.warnings).toEqual([expect.stringMatching(/UUID.*generate/i)])
    expect(await database.getAll('meta')).toEqual([])
  })

  it('uses an RFC 4122 v4 getRandomValues fallback when randomUUID is unavailable', async () => {
    let seed = 0
    const descriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto')
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: { getRandomValues: (bytes: Uint8Array) => { bytes.fill(++seed); return bytes } },
    })
    try {
      const result = await migrateLegacyLocalStorage({ storage: populatedStorage(), now: () => now })
      expect(result.status).toBe('migrated')
      const database = await openStudyLockDatabase()
      for (const id of [
        (await database.getAll('documents'))[0].id,
        (await database.getAll('studyItems'))[0].id,
        (await database.getAll('sessions'))[0].id,
        (await database.getAll('attempts'))[0].id,
      ]) expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    } finally {
      if (descriptor) Object.defineProperty(globalThis, 'crypto', descriptor)
      else delete (globalThis as { crypto?: Crypto }).crypto
    }
  })

  it('blocks a corrupt completion marker instead of suppressing migration', async () => {
    const database = await openStudyLockDatabase()
    await database.put('meta', {
      key: LEGACY_MIGRATION_META_KEY,
      value: { completed: true, version: 99, counts: { documents: -1 } },
      updatedAt: now,
    })
    const result = await migrateLegacyLocalStorage({ storage: populatedStorage(), database })
    expect(result.status).toBe('blocked')
    expect(result.warnings).toEqual([expect.stringMatching(/marker.*invalid/i)])
    expect(await database.count('documents')).toBe(0)
  })
})
