import 'fake-indexeddb/auto'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type {
  OutboxRecord,
  PersistedAttempt,
  PersistedDocument,
  PersistedExamProfile,
  PersistedSession,
  PersistedStudyItem,
  UUID,
} from '../../domain/entities'
import { closeStudyLockDatabase, openStudyLockDatabase, type StudyLockDatabase } from './database'
import { IndexedDbStudyRepository } from './indexedDbStudyRepository'
import { resetStudyLockDatabaseForTests } from './testSupport'

const ids = {
  documentA: '018f47b4-0b7a-7c25-8d3f-000000000001' as UUID,
  documentB: '018f47b4-0b7a-7c25-8d3f-000000000002' as UUID,
  profileA: '018f47b4-0b7a-7c25-8d3f-000000000003' as UUID,
  profileB: '018f47b4-0b7a-7c25-8d3f-000000000004' as UUID,
  itemA: '018f47b4-0b7a-7c25-8d3f-000000000005' as UUID,
  itemB: '018f47b4-0b7a-7c25-8d3f-000000000006' as UUID,
  itemC: '018f47b4-0b7a-7c25-8d3f-000000000007' as UUID,
  session: '018f47b4-0b7a-7c25-8d3f-000000000008' as UUID,
  attempt: '018f47b4-0b7a-7c25-8d3f-000000000009' as UUID,
  outbox: '018f47b4-0b7a-7c25-8d3f-00000000000a' as UUID,
}

const early = '2026-07-14T09:00:00.000Z'
const middle = '2026-07-14T10:00:00.000Z'
const late = '2026-07-14T11:00:00.000Z'
const metadata = (id: UUID, updatedAt = middle) => ({
  id,
  createdAt: early,
  updatedAt,
  version: 1,
  deviceId: 'test-device',
  syncStatus: 'pending' as const,
})
const document = (id: UUID, updatedAt: string): PersistedDocument => ({
  ...metadata(id, updatedAt),
  title: `Document ${id}`,
  subject: 'Biology',
  sourceType: 'paste',
  text: `raw ${id}`,
})
const profile = (id: UUID, updatedAt: string): PersistedExamProfile => ({
  ...metadata(id, updatedAt),
  subject: 'Biology',
  examDate: '2026-08-01',
  dailyMinutes: 30,
  goal: 'gut',
  confidence: 3,
})
const item = (id: UUID, documentId: UUID, dueAt: string): PersistedStudyItem => ({
  ...metadata(id),
  documentId,
  topic: 'Cells',
  question: `private question ${id}`,
  answer: `private answer ${id}`,
  source: 'private source text',
  difficulty: 'mittel',
  type: 'karte',
  dueAt,
  intervalDays: 2,
  repetitions: 1,
  easeFactor: 2.5,
})
const session = (id = ids.session, createdAt = middle): PersistedSession => ({
  ...metadata(id),
  createdAt,
  date: createdAt,
  documentId: ids.documentA,
  subject: 'Biology',
  documentTitle: 'Cells',
  mode: 'recall',
  score: 80,
  minutes: 20,
  answered: 1,
  blockers: 0,
  readinessAfter: 75,
})
const attempt = (studyItemId = ids.itemA): PersistedAttempt => ({
  ...metadata(ids.attempt),
  sessionId: ids.session,
  studyItemId,
  userAnswer: 'private user answer',
  rating: 'good',
})
const outbox = (id = ids.outbox, createdAt = middle): OutboxRecord => ({
  id,
  createdAt,
  updatedAt: createdAt,
  version: 1,
  deviceId: 'test-device',
  entityType: 'session',
  entityId: ids.session,
  operation: 'put',
  payload: {
    eventType: 'session.finished',
    sessionId: ids.session,
    attemptIds: [ids.attempt],
    studyItems: [{ id: ids.itemA, dueAt: late, intervalDays: 2, repetitions: 1, easeFactor: 2.5 }],
  },
  status: 'pending',
  attempts: 0,
})

describe('IndexedDbStudyRepository', () => {
  let repository: IndexedDbStudyRepository

  beforeEach(async () => {
    await resetStudyLockDatabaseForTests()
    repository = new IndexedDbStudyRepository(await openStudyLockDatabase())
  })

  afterEach(async () => {
    closeStudyLockDatabase()
    await resetStudyLockDatabaseForTests()
  })

  it('implements CRUD, keeps documents/items normalized, and orders lists deterministically', async () => {
    await repository.putMeta({ key: 'deviceId', value: 'test-device', updatedAt: middle })
    await repository.putDocument(document(ids.documentA, early))
    await repository.putDocument(document(ids.documentB, late))
    await repository.putExamProfile(profile(ids.profileA, early))
    await repository.putExamProfile(profile(ids.profileB, late))
    await repository.putStudyItems([
      item(ids.itemB, ids.documentA, late),
      item(ids.itemA, ids.documentA, early),
      item(ids.itemC, ids.documentB, middle),
    ])

    expect(await repository.getMeta('deviceId')).toEqual({
      key: 'deviceId', value: 'test-device', updatedAt: middle,
    })
    expect((await repository.listDocuments()).map(({ id }) => id)).toEqual([
      ids.documentB, ids.documentA,
    ])
    expect((await repository.listExamProfiles()).map(({ id }) => id)).toEqual([
      ids.profileB, ids.profileA,
    ])
    expect((await repository.listStudyItemsByDocument(ids.documentA)).map(({ id }) => id)).toEqual([
      ids.itemA, ids.itemB,
    ])
    expect(await repository.getStudyItem(ids.itemC)).toEqual(item(ids.itemC, ids.documentB, middle))
    expect(await repository.getDocument(ids.documentA)).not.toHaveProperty('items')

    await repository.putDocument({ ...document(ids.documentA, late), title: 'Updated once' })
    await repository.putDocument({ ...document(ids.documentA, late), title: 'Updated twice' })
    expect((await repository.getDocument(ids.documentA))?.title).toBe('Updated twice')
    expect((await repository.listDocuments()).filter(({ id }) => id === ids.documentA)).toHaveLength(1)

    await repository.deleteDocument(ids.documentA)
    await expect(repository.getDocument(ids.documentA)).resolves.toBeUndefined()
    expect(await repository.getStudyItem(ids.itemA)).toBeUndefined()
    expect(await repository.getStudyItem(ids.itemB)).toBeUndefined()
    expect(await repository.getStudyItem(ids.itemC)).toBeDefined()
  })

  it('atomically replaces a complete document aggregate and removes omitted children', async () => {
    await repository.putDocument(document(ids.documentA, early))
    await repository.putStudyItems([
      item(ids.itemA, ids.documentA, early),
      item(ids.itemB, ids.documentA, middle),
      item(ids.itemC, ids.documentB, late),
    ])

    await repository.replaceDocumentAggregate({
      document: { ...document(ids.documentA, late), title: 'Replacement' },
      studyItems: [{ ...item(ids.itemA, ids.documentA, late), question: 'updated' }],
    })

    expect((await repository.getDocument(ids.documentA))?.title).toBe('Replacement')
    expect((await repository.getStudyItem(ids.itemA))?.question).toBe('updated')
    expect(await repository.getStudyItem(ids.itemB)).toBeUndefined()
    expect(await repository.getStudyItem(ids.itemC)).toBeDefined()
  })

  it('rejects invalid aggregate references and duplicate IDs before writing', async () => {
    const original = document(ids.documentA, early)
    await repository.putDocument(original)

    await expect(repository.replaceDocumentAggregate({
      document: document(ids.documentA, late),
      studyItems: [item(ids.itemA, ids.documentB, late)],
    })).rejects.toThrow(/document|reference/i)
    await expect(repository.replaceDocumentAggregate({
      document: document(ids.documentA, late),
      studyItems: [item(ids.itemA, ids.documentA, late), item(ids.itemA, ids.documentA, late)],
    })).rejects.toThrow(/unique/i)

    expect(await repository.getDocument(ids.documentA)).toEqual(original)
    expect(await repository.getStudyItem(ids.itemA)).toBeUndefined()
  })

  it('rolls back parent, child upserts, and omissions if aggregate replacement fails', async () => {
    const originalDocument = document(ids.documentA, early)
    const originalItem = item(ids.itemA, ids.documentA, early)
    const omittedItem = item(ids.itemB, ids.documentA, middle)
    await repository.putDocument(originalDocument)
    await repository.putStudyItems([originalItem, omittedItem])
    const uncloneable = {
      ...item(ids.itemC, ids.documentA, late),
      question: () => 'cannot clone',
    } as unknown as PersistedStudyItem

    await expect(repository.replaceDocumentAggregate({
      document: { ...document(ids.documentA, late), title: 'must roll back' },
      studyItems: [{ ...originalItem, question: 'must roll back' }, uncloneable],
    })).rejects.toThrow()

    expect(await repository.getDocument(ids.documentA)).toEqual(originalDocument)
    expect(await repository.getStudyItem(ids.itemA)).toEqual(originalItem)
    expect(await repository.getStudyItem(ids.itemB)).toEqual(omittedItem)
    expect(await repository.getStudyItem(ids.itemC)).toBeUndefined()
  })

  it('uses the due-date index and returns only due items in deterministic due order', async () => {
    await repository.putStudyItems([
      item(ids.itemB, ids.documentA, late),
      item(ids.itemC, ids.documentB, middle),
      item(ids.itemA, ids.documentA, early),
    ])
    const database = await openStudyLockDatabase()
    expect(Array.from(database.transaction('studyItems').store.indexNames)).toContain('by-due-date')

    expect((await repository.listDueStudyItems(middle)).map(({ id }) => id)).toEqual([
      ids.itemA, ids.itemC,
    ])
  })

  it('aborts the entire study-item batch if any put fails', async () => {
    const uncloneable = {
      ...item(ids.itemB, ids.documentA, late),
      question: () => 'cannot clone',
    } as unknown as PersistedStudyItem

    await expect(repository.putStudyItems([
      item(ids.itemA, ids.documentA, early),
      uncloneable,
    ])).rejects.toThrow()

    expect(await repository.getStudyItem(ids.itemA)).toBeUndefined()
    expect(await repository.getStudyItem(ids.itemB)).toBeUndefined()
  })

  it('lists sessions newest-first, attempts by session, and pending outbox oldest-first', async () => {
    const database = await openStudyLockDatabase()
    const olderSessionId = ids.documentA
    await database.put('sessions', session(olderSessionId, early))
    await database.put('sessions', session(ids.session, late))
    await database.put('attempts', attempt())
    await repository.putOutboxEntry(outbox(ids.outbox, late))
    await repository.putOutboxEntry(outbox(ids.documentB, early))
    await repository.putOutboxEntry({ ...outbox(ids.documentA, middle), status: 'failed' })

    expect((await repository.listSessions()).map(({ id }) => id)).toEqual([
      ids.session, olderSessionId,
    ])
    expect(await repository.getSession(ids.session)).toEqual(session(ids.session, late))
    expect(await repository.listAttemptsBySession(ids.session)).toEqual([attempt()])
    expect((await repository.listPendingOutboxEntries()).map(({ id }) => id)).toEqual([
      ids.documentB, ids.outbox,
    ])
  })

  it('rejects query failures instead of fabricating empty results', async () => {
    const database = await openStudyLockDatabase()
    database.close()
    await expect(repository.listDocuments()).rejects.toThrow()
  })

  it('atomically completes a session and retrying produces one logical event', async () => {
    await repository.putDocument(document(ids.documentA, early))
    await repository.putStudyItems([item(ids.itemA, ids.documentA, early)])
    const updatedItem = { ...item(ids.itemA, ids.documentA, late), repetitions: 2 }
    const completionEntry = {
      ...outbox(ids.session, middle),
      payload: {
        ...outbox(ids.session, middle).payload,
        studyItems: [{ ...outbox(ids.session, middle).payload.studyItems[0], repetitions: 2 }],
      },
    }
    const input = {
      session: session(),
      attempts: [attempt()],
      updatedStudyItems: [updatedItem],
      outboxEntries: [completionEntry],
    }

    await repository.completeSession(input)
    await repository.completeSession(input)

    expect(await repository.getSession(ids.session)).toEqual({
      ...session(),
      completionFingerprint: expect.stringMatching(/^v1:[0-9a-f]{64}$/),
    })
    expect(await repository.listAttemptsBySession(ids.session)).toEqual([attempt()])
    expect(await repository.getStudyItem(ids.itemA)).toEqual(updatedItem)
    expect(await repository.listPendingOutboxEntries()).toEqual([completionEntry])
  })

  it('rejects a direct completion for a missing document without writing any completion store', async () => {
    const originalItem = item(ids.itemA, ids.documentA, early)
    await repository.putStudyItems([originalItem])

    await expect(repository.completeSession({
      session: session(), attempts: [attempt()],
      updatedStudyItems: [item(ids.itemA, ids.documentA, late)],
      outboxEntries: [outbox(ids.session)],
    })).rejects.toThrow(/document|exist|not found/i)

    expect(await repository.getSession(ids.session)).toBeUndefined()
    expect(await repository.listAttemptsBySession(ids.session)).toEqual([])
    expect(await repository.getStudyItem(ids.itemA)).toEqual(originalItem)
    expect(await repository.listPendingOutboxEntries()).toEqual([])
  })

  it('rejects updated or persisted items belonging to a different document', async () => {
    await repository.putDocument(document(ids.documentA, early))
    const persistedElsewhere = item(ids.itemA, ids.documentB, early)
    await repository.putStudyItems([persistedElsewhere])
    const completion = {
      session: session(), attempts: [attempt()],
      updatedStudyItems: [item(ids.itemA, ids.documentA, late)],
      outboxEntries: [outbox(ids.session)],
    }

    await expect(repository.completeSession(completion)).rejects.toThrow(/document|belong/i)
    await expect(repository.completeSession({
      ...completion,
      updatedStudyItems: [item(ids.itemA, ids.documentB, late)],
    })).rejects.toThrow(/document|belong/i)

    expect(await repository.getSession(ids.session)).toBeUndefined()
    expect(await repository.getStudyItem(ids.itemA)).toEqual(persistedElsewhere)
    expect(await repository.listPendingOutboxEntries()).toEqual([])
  })

  it('serializes a concurrent document deletion before completion and creates no orphan completion', async () => {
    await repository.putDocument(document(ids.documentA, early))
    await repository.putStudyItems([item(ids.itemA, ids.documentA, early)])
    const deletion = repository.deleteDocument(ids.documentA)
    const completion = repository.completeSession({
      session: session(), attempts: [attempt()],
      updatedStudyItems: [item(ids.itemA, ids.documentA, late)],
      outboxEntries: [outbox(ids.session)],
    })

    await deletion
    await expect(completion).rejects.toThrow(/document|exist|not found/i)

    expect(await repository.getDocument(ids.documentA)).toBeUndefined()
    expect(await repository.getSession(ids.session)).toBeUndefined()
    expect(await repository.listAttemptsBySession(ids.session)).toEqual([])
    expect(await repository.listPendingOutboxEntries()).toEqual([])
  })

  it('accepts an equivalent retry after document deletion without recreating or regressing data', async () => {
    await repository.putDocument(document(ids.documentA, early))
    await repository.putStudyItems([item(ids.itemA, ids.documentA, early)])
    const input = {
      session: session(), attempts: [attempt()],
      updatedStudyItems: [item(ids.itemA, ids.documentA, late)],
      outboxEntries: [outbox(ids.session)],
    }
    await repository.completeSession(input)
    await repository.deleteDocument(ids.documentA)
    const database = await openStudyLockDatabase()
    const before = {
      session: await database.get('sessions', ids.session),
      attempts: await database.getAll('attempts'),
      outbox: await database.get('outbox', ids.session),
    }

    const result = await repository.completeSession(input)

    expect(result.updatedStudyItems).toEqual([])
    expect(await repository.getDocument(ids.documentA)).toBeUndefined()
    expect(await repository.getStudyItem(ids.itemA)).toBeUndefined()
    expect({
      session: await database.get('sessions', ids.session),
      attempts: await database.getAll('attempts'),
      outbox: await database.get('outbox', ids.session),
    }).toEqual(before)
  })

  it.each(['failed', 'processing'] as const)(
    'treats the session ID as an idempotency key without resetting a %s outbox entry',
    async (status) => {
      await repository.putDocument(document(ids.documentA, early))
      await repository.putStudyItems([item(ids.itemA, ids.documentA, early)])
      const updatedItem = { ...item(ids.itemA, ids.documentA, late), repetitions: 2 }
      const completionEntry = {
        ...outbox(ids.session, middle),
        payload: {
          ...outbox(ids.session, middle).payload,
          studyItems: [{ ...outbox(ids.session, middle).payload.studyItems[0], repetitions: 2 }],
        },
      }
      const input = {
        session: session(), attempts: [attempt()], updatedStudyItems: [updatedItem],
        outboxEntries: [completionEntry],
      }
      await repository.completeSession(input)
      const changedEntry = {
        ...completionEntry,
        status,
        attempts: 3,
        updatedAt: late,
        ...(status === 'failed' ? { lastError: 'network down' } : {}),
      }
      const database = await openStudyLockDatabase()
      await database.put('outbox', changedEntry)

      const result = await repository.completeSession(input)

      expect(await database.get('outbox', ids.session)).toEqual(changedEntry)
      expect(result.outboxEntries).toEqual([changedEntry])
    },
  )

  it('does not recreate a delivered and removed outbox entry on an equivalent retry', async () => {
    await repository.putDocument(document(ids.documentA, early))
    await repository.putStudyItems([item(ids.itemA, ids.documentA, early)])
    const input = {
      session: session(), attempts: [attempt()], updatedStudyItems: [item(ids.itemA, ids.documentA, late)],
      outboxEntries: [outbox(ids.session)],
    }
    await repository.completeSession(input)
    const database = await openStudyLockDatabase()
    await database.delete('outbox', ids.session)

    const result = await repository.completeSession(input)

    expect(await database.get('outbox', ids.session)).toBeUndefined()
    expect(result.outboxEntries).toEqual([])
  })

  it('rejects a changed session document reference after its outbox entry was removed', async () => {
    await repository.putDocument(document(ids.documentA, early))
    await repository.putStudyItems([item(ids.itemA, ids.documentA, early)])
    const input = {
      session: session(), attempts: [attempt()], updatedStudyItems: [item(ids.itemA, ids.documentA, late)],
      outboxEntries: [outbox(ids.session)],
    }
    await repository.completeSession(input)
    const database = await openStudyLockDatabase()
    await database.delete('outbox', ids.session)

    await expect(repository.completeSession({
      ...input,
      session: { ...input.session, documentId: ids.documentB },
    })).rejects.toThrow(/conflict|idempotency|fingerprint/i)

    expect((await repository.getSession(ids.session))?.documentId).toBe(ids.documentA)
    expect(await database.get('outbox', ids.session)).toBeUndefined()
  })

  it.each([
    { phase: 'before outbox removal', removeOutbox: false },
    { phase: 'after outbox removal', removeOutbox: true },
  ])(
    'rejects changed scheduling semantics on retry $phase',
    async ({ removeOutbox }) => {
      await repository.putDocument(document(ids.documentA, early))
      await repository.putStudyItems([item(ids.itemA, ids.documentA, early)])
      const input = {
        session: session(), attempts: [attempt()], updatedStudyItems: [item(ids.itemA, ids.documentA, late)],
        outboxEntries: [outbox(ids.session)],
      }
      await repository.completeSession(input)
      const database = await openStudyLockDatabase()
      if (removeOutbox) await database.delete('outbox', ids.session)
      const changedItem = { ...input.updatedStudyItems[0], dueAt: '2026-09-01T11:00:00.000Z' }
      const changedEntry = {
        ...input.outboxEntries[0],
        payload: {
          ...input.outboxEntries[0].payload,
          studyItems: [{ ...input.outboxEntries[0].payload.studyItems[0], dueAt: changedItem.dueAt }],
        },
      }

      await expect(repository.completeSession({
        ...input,
        updatedStudyItems: [changedItem],
        outboxEntries: [changedEntry],
      })).rejects.toThrow(/conflict|idempotency|fingerprint/i)

      expect(await database.get('studyItems', ids.itemA)).toEqual(input.updatedStudyItems[0])
      expect(await database.get('outbox', ids.session)).toEqual(
        removeOutbox ? undefined : input.outboxEntries[0],
      )
    },
  )

  it('stores a privacy-safe completion fingerprint and fails closed for legacy sessions without one', async () => {
    await repository.putDocument(document(ids.documentA, early))
    await repository.putStudyItems([item(ids.itemA, ids.documentA, early)])
    const input = {
      session: session(), attempts: [attempt()], updatedStudyItems: [item(ids.itemA, ids.documentA, late)],
      outboxEntries: [outbox(ids.session)],
    }
    await repository.completeSession(input)
    const persisted = await repository.getSession(ids.session)

    expect(persisted?.completionFingerprint).toMatch(/^v1:/)
    expect(persisted?.completionFingerprint).not.toContain('private')

    const database = await openStudyLockDatabase()
    await database.put('sessions', session(ids.documentA))
    await expect(repository.completeSession({
      ...input,
      session: session(ids.documentA),
      attempts: [{ ...input.attempts[0], id: ids.documentB, sessionId: ids.documentA }],
      outboxEntries: [{
        ...input.outboxEntries[0],
        id: ids.documentA,
        entityId: ids.documentA,
        payload: {
          ...input.outboxEntries[0].payload,
          sessionId: ids.documentA,
          attemptIds: [ids.documentB],
        },
      }],
    })).rejects.toThrow(/conflict|idempotency|fingerprint/i)
  })

  it('rejects an attempt UUID already owned by another session and preserves the original', async () => {
    const database = await openStudyLockDatabase()
    const original = { ...attempt(), sessionId: ids.documentA, userAnswer: 'original answer' }
    await database.put('attempts', original)
    await repository.putDocument(document(ids.documentA, early))
    await repository.putStudyItems([item(ids.itemA, ids.documentA, early)])

    await expect(repository.completeSession({
      session: session(),
      attempts: [attempt()],
      updatedStudyItems: [item(ids.itemA, ids.documentA, late)],
      outboxEntries: [outbox(ids.session)],
    })).rejects.toThrow(/attempt|collision|conflict/i)

    expect(await database.get('attempts', ids.attempt)).toEqual(original)
    expect(await repository.getSession(ids.session)).toBeUndefined()
    expect(await repository.getStudyItem(ids.itemA)).toEqual(item(ids.itemA, ids.documentA, early))
    expect(await repository.listPendingOutboxEntries()).toEqual([])
  })

  it('does not regress a newer study-item schedule on an equivalent retry', async () => {
    await repository.putDocument(document(ids.documentA, early))
    await repository.putStudyItems([item(ids.itemA, ids.documentA, early)])
    const completedItem = item(ids.itemA, ids.documentA, late)
    const input = {
      session: session(), attempts: [attempt()], updatedStudyItems: [completedItem],
      outboxEntries: [outbox(ids.session)],
    }
    await repository.completeSession(input)
    const newerItem = {
      ...completedItem,
      updatedAt: '2026-07-15T11:00:00.000Z',
      dueAt: '2026-08-01T11:00:00.000Z',
      repetitions: 8,
      intervalDays: 21,
    }
    await repository.putStudyItems([newerItem])

    const result = await repository.completeSession(input)

    expect(await repository.getStudyItem(ids.itemA)).toEqual(newerItem)
    expect(result.updatedStudyItems).toEqual([newerItem])
  })

  it('rejects conflicting reuse of a session ID without writing any store', async () => {
    await repository.putDocument(document(ids.documentA, early))
    await repository.putStudyItems([item(ids.itemA, ids.documentA, early)])
    const input = {
      session: session(), attempts: [attempt()], updatedStudyItems: [item(ids.itemA, ids.documentA, late)],
      outboxEntries: [outbox(ids.session)],
    }
    await repository.completeSession(input)
    const database = await openStudyLockDatabase()
    const before = {
      session: await database.get('sessions', ids.session),
      attempts: await database.getAll('attempts'),
      item: await database.get('studyItems', ids.itemA),
      outbox: await database.get('outbox', ids.session),
    }

    const conflictingCommands = [
      { ...input, session: { ...input.session, score: 5 } },
      { ...input, attempts: [{ ...input.attempts[0], userAnswer: 'conflicting answer' }] },
      { ...input, attempts: [{ ...input.attempts[0], rating: 'hard' as const }] },
      { ...input, attempts: [{ ...input.attempts[0], selfScore: 0.25, timeSpentSeconds: 99 }] },
    ]
    for (const conflictingCommand of conflictingCommands) {
      await expect(repository.completeSession(conflictingCommand)).rejects.toThrow(/conflict|idempotency/i)
    }

    expect({
      session: await database.get('sessions', ids.session),
      attempts: await database.getAll('attempts'),
      item: await database.get('studyItems', ids.itemA),
      outbox: await database.get('outbox', ids.session),
    }).toEqual(before)
  })

  it('aborts every store when a write fails after the transaction starts', async () => {
    await repository.putDocument(document(ids.documentA, early))
    await repository.putStudyItems([item(ids.itemA, ids.documentA, early)])
    const uncloneableAttempt = { ...attempt(), userAnswer: () => 'cannot clone' } as unknown as PersistedAttempt

    await expect(repository.completeSession({
      session: session(),
      attempts: [uncloneableAttempt],
      updatedStudyItems: [{ ...item(ids.itemA, ids.documentA, late), repetitions: 9 }],
      outboxEntries: [{
        ...outbox(ids.session),
        payload: {
          ...outbox(ids.session).payload,
          studyItems: [{ ...outbox(ids.session).payload.studyItems[0], repetitions: 9 }],
        },
      }],
    })).rejects.toThrow()

    expect(await repository.getSession(ids.session)).toBeUndefined()
    expect(await repository.listAttemptsBySession(ids.session)).toEqual([])
    expect((await repository.getStudyItem(ids.itemA))?.repetitions).toBe(1)
    expect(await repository.listPendingOutboxEntries()).toEqual([])
  })

  it('rejects invalid references before writing anything', async () => {
    await repository.putDocument(document(ids.documentA, early))
    await repository.putStudyItems([item(ids.itemA, ids.documentA, early)])

    await expect(repository.completeSession({
      session: session(),
      attempts: [{ ...attempt(), sessionId: ids.documentA }],
      updatedStudyItems: [item(ids.itemA, ids.documentA, late)],
      outboxEntries: [outbox(ids.session)],
    })).rejects.toThrow(/session/i)
    await expect(repository.completeSession({
      session: session(),
      attempts: [attempt(ids.itemB)],
      updatedStudyItems: [item(ids.itemA, ids.documentA, late)],
      outboxEntries: [outbox(ids.session)],
    })).rejects.toThrow(/study item/i)
    await expect(repository.completeSession({
      session: session(),
      attempts: [attempt()],
      updatedStudyItems: [item(ids.itemA, ids.documentA, late), item(ids.itemA, ids.documentA, late)],
      outboxEntries: [outbox(ids.session)],
    })).rejects.toThrow(/unique/i)

    expect(await repository.getSession(ids.session)).toBeUndefined()
    expect(await repository.listAttemptsBySession(ids.session)).toEqual([])
    expect(await repository.listPendingOutboxEntries()).toEqual([])
  })

  it('requires the attempted and updated study-item ID sets to match exactly', async () => {
    await repository.putStudyItems([
      item(ids.itemA, ids.documentA, early),
      item(ids.itemB, ids.documentA, early),
    ])

    await expect(repository.completeSession({
      session: session(),
      attempts: [attempt()],
      updatedStudyItems: [],
      outboxEntries: [{
        ...outbox(ids.session),
        payload: { ...outbox(ids.session).payload, studyItems: [] },
      }],
    })).rejects.toThrow(/study item/i)

    await expect(repository.completeSession({
      session: session(),
      attempts: [],
      updatedStudyItems: [item(ids.itemA, ids.documentA, late)],
      outboxEntries: [{
        ...outbox(ids.session),
        payload: { ...outbox(ids.session).payload, attemptIds: [] },
      }],
    })).rejects.toThrow(/attempt/i)

    expect(await repository.getSession(ids.session)).toBeUndefined()
    expect(await repository.listAttemptsBySession(ids.session)).toEqual([])
  })

  it('updates only study items that existed before the completion transaction', async () => {
    await repository.putDocument(document(ids.documentA, early))
    const newItem = item(ids.itemB, ids.documentA, late)
    const newAttempt = { ...attempt(ids.itemB), id: ids.documentB }
    const entry = {
      ...outbox(ids.session),
      payload: {
        ...outbox(ids.session).payload,
        attemptIds: [newAttempt.id],
        studyItems: [{
          id: newItem.id,
          dueAt: newItem.dueAt,
          intervalDays: newItem.intervalDays,
          repetitions: newItem.repetitions,
          easeFactor: newItem.easeFactor,
        }],
      },
    }

    await expect(repository.completeSession({
      session: session(),
      attempts: [newAttempt],
      updatedStudyItems: [newItem],
      outboxEntries: [entry],
    })).rejects.toThrow(/exist/i)

    expect(await repository.getStudyItem(ids.itemB)).toBeUndefined()
    expect(await repository.getSession(ids.session)).toBeUndefined()
  })

  it('requires one stable session-keyed outbox entry with fresh queue metadata', async () => {
    await repository.putDocument(document(ids.documentA, early))
    await repository.putStudyItems([item(ids.itemA, ids.documentA, early)])
    const invalidEntries: OutboxRecord[] = [
      outbox(ids.outbox),
      { ...outbox(ids.session), entityId: ids.documentA, payload: { ...outbox(ids.session).payload, sessionId: ids.documentA } },
      { ...outbox(ids.session), status: 'processing' },
      { ...outbox(ids.session), attempts: 1 },
      { ...outbox(ids.session), lastError: 'old failure' },
      { ...outbox(ids.session), createdAt: early },
      { ...outbox(ids.session), updatedAt: late },
      { ...outbox(ids.session), version: 2 },
      { ...outbox(ids.session), deviceId: 'another-device' },
    ]

    for (const entry of invalidEntries) {
      await expect(repository.completeSession({
        session: session(),
        attempts: [attempt()],
        updatedStudyItems: [item(ids.itemA, ids.documentA, late)],
        outboxEntries: [entry],
      })).rejects.toThrow(/outbox/i)
    }

    expect(await repository.getSession(ids.session)).toBeUndefined()
    expect(await repository.listPendingOutboxEntries()).toEqual([])
  })

  it('requires every outbox scheduling field to match its updated study item', async () => {
    await repository.putDocument(document(ids.documentA, early))
    await repository.putStudyItems([item(ids.itemA, ids.documentA, early)])
    const updatedItem = { ...item(ids.itemA, ids.documentA, late), lastRating: 'good' as const }
    const scheduling = {
      id: updatedItem.id,
      dueAt: updatedItem.dueAt,
      intervalDays: updatedItem.intervalDays,
      repetitions: updatedItem.repetitions,
      lastRating: updatedItem.lastRating,
      easeFactor: updatedItem.easeFactor,
    }
    const mismatches = [
      { ...scheduling, dueAt: early },
      { ...scheduling, intervalDays: 99 },
      { ...scheduling, repetitions: 99 },
      { ...scheduling, lastRating: 'again' as const },
      { ...scheduling, easeFactor: 9.9 },
    ]

    for (const mismatchedScheduling of mismatches) {
      await expect(repository.completeSession({
        session: session(),
        attempts: [attempt()],
        updatedStudyItems: [updatedItem],
        outboxEntries: [{
          ...outbox(ids.session),
          payload: { ...outbox(ids.session).payload, studyItems: [mismatchedScheduling] },
        }],
      })).rejects.toThrow(/outbox/i)
    }

    expect(await repository.getSession(ids.session)).toBeUndefined()
  })

  it('rejects privacy-unsafe extra top-level outbox fields at both repository boundaries', async () => {
    const structurallyTyped = {
      ...outbox(ids.session),
      userAnswer: 'must never cross the outbox boundary',
      rawDocumentText: 'private source document',
    }
    const unsafeEntry: OutboxRecord = structurallyTyped

    await expect(repository.putOutboxEntry(unsafeEntry)).rejects.toThrow(/outbox|field|privacy/i)

    await repository.putDocument(document(ids.documentA, early))
    await repository.putStudyItems([item(ids.itemA, ids.documentA, early)])
    await expect(repository.completeSession({
      session: session(),
      attempts: [attempt()],
      updatedStudyItems: [item(ids.itemA, ids.documentA, late)],
      outboxEntries: [unsafeEntry],
    })).rejects.toThrow(/outbox|field|privacy/i)
    expect(await repository.getSession(ids.session)).toBeUndefined()
  })

  it('loads a deterministic normalized snapshot through exactly one multi-store transaction', async () => {
    await repository.putDocument(document(ids.documentA, early))
    await repository.putDocument(document(ids.documentB, late))
    await repository.putExamProfile(profile(ids.profileA, early))
    await repository.putExamProfile(profile(ids.profileB, late))
    await repository.putStudyItems([
      item(ids.itemB, ids.documentA, late),
      item(ids.itemA, ids.documentA, early),
    ])
    const database = await openStudyLockDatabase()
    await database.put('sessions', session(ids.documentA, early))
    await database.put('sessions', session(ids.session, late))
    await database.put('attempts', attempt())
    const transactionSpy = vi.spyOn(database, 'transaction')
    vi.spyOn(repository, 'listDocuments').mockRejectedValue(new Error('must not call listDocuments'))
    vi.spyOn(repository, 'listSessions').mockRejectedValue(new Error('must not call listSessions'))

    const snapshot = await repository.loadSnapshot()

    expect(transactionSpy).toHaveBeenCalledTimes(1)
    expect(transactionSpy).toHaveBeenCalledWith(
      ['documents', 'studyItems', 'examProfiles', 'sessions', 'attempts'],
      'readonly',
    )
    expect(snapshot.documents.map(({ id }) => id)).toEqual([ids.documentB, ids.documentA])
    expect(snapshot.studyItems.map(({ id }) => id)).toEqual([ids.itemA, ids.itemB])
    expect(snapshot.examProfiles.map(({ id }) => id)).toEqual([ids.profileB, ids.profileA])
    expect(snapshot.sessions.map(({ id }) => id)).toEqual([ids.session, ids.documentA])
    expect(snapshot.attempts).toEqual([attempt()])
    expect(snapshot.documents[1]).not.toHaveProperty('items')
  })

  it('rejects the entire snapshot when any read in its transaction fails', async () => {
    const failedRead = new Error('injected attempts read failure')
    const fakeDatabase = {
      transaction: vi.fn(() => ({
        objectStore: (name: string) => ({
          getAll: () => name === 'attempts' ? Promise.reject(failedRead) : Promise.resolve([]),
        }),
        done: Promise.resolve(),
      })),
    } as unknown as StudyLockDatabase
    const failingRepository = new IndexedDbStudyRepository(fakeDatabase)

    await expect(failingRepository.loadSnapshot()).rejects.toBe(failedRead)
  })

  it('normalizes absent and null outbox lastRating values when checking scheduling data', async () => {
    await repository.putDocument(document(ids.documentA, early))
    await repository.putStudyItems([item(ids.itemA, ids.documentA, early)])
    const entryWithNullRating = {
      ...outbox(ids.session),
      payload: {
        ...outbox(ids.session).payload,
        studyItems: [{ ...outbox(ids.session).payload.studyItems[0], lastRating: null }],
      },
    } as unknown as OutboxRecord

    await expect(repository.completeSession({
      session: session(),
      attempts: [attempt()],
      updatedStudyItems: [item(ids.itemA, ids.documentA, late)],
      outboxEntries: [entryWithNullRating],
    })).resolves.toBeDefined()
  })

  it('keeps a pending outbox event durably across database close and reopen', async () => {
    await repository.putOutboxEntry(outbox(ids.session, middle))
    const unavailableRemote = vi.fn().mockRejectedValue(new Error('network unavailable'))
    await expect(unavailableRemote()).rejects.toThrow('network unavailable')
    closeStudyLockDatabase()

    const reopened = new IndexedDbStudyRepository(await openStudyLockDatabase())
    expect(await reopened.listPendingOutboxEntries()).toEqual([outbox(ids.session, middle)])
  })
})
