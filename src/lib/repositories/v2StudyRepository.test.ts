import { describe, expect, it, vi } from 'vitest'
import type { CompleteSessionInput, LocalStudyStore, ReplaceDocumentAggregateInput, V2StudySnapshot } from '../../domain/ports'
import type { MetaRecord, PersistedDocument, PersistedExamProfile, PersistedStudyItem, UUID } from '../../domain/entities'
import type { AppStateSnapshot, SessionResult, StudyAttempt, StudyDocument, StudyItem } from '../../types'
import { V2StudyRepository } from './v2StudyRepository'

const ids = {
  document: '10000000-0000-4000-8000-000000000001' as UUID,
  profile: '10000000-0000-4000-8000-000000000002' as UUID,
  item: '10000000-0000-4000-8000-000000000003' as UUID,
  session: '10000000-0000-4000-8000-000000000004' as UUID,
  attempt: '10000000-0000-4000-8000-000000000005' as UUID,
}
const timestamp = '2026-07-14T12:00:00.000Z'
const deviceId = 'device-test'
const metadata = (id: UUID) => ({ id, createdAt: timestamp, updatedAt: timestamp, version: 1, deviceId, syncStatus: 'local' as const })

function item(): StudyItem {
  return { id: ids.item, documentId: ids.document, topic: 'Topic', question: 'Q?', answer: 'A', source: 'S', difficulty: 'mittel', type: 'karte', dueAt: timestamp, intervalDays: 0, repetitions: 0, easeFactor: 2.5 }
}
function document(): StudyDocument {
  return { id: ids.document, title: 'Doc', subject: 'Math', text: 'Material', examProfileId: ids.profile, createdAt: timestamp, updatedAt: timestamp, items: [item()] }
}
function emptySnapshot(): V2StudySnapshot {
  return { documents: [], studyItems: [], examProfiles: [], sessions: [], attempts: [] }
}

function fakeStore(snapshot: V2StudySnapshot = emptySnapshot()) {
  const meta = new Map<string, MetaRecord>()
  const documents = new Map<UUID, PersistedDocument>()
  const profiles = new Map<UUID, PersistedExamProfile>()
  const items = new Map<UUID, PersistedStudyItem>()
  snapshot.documents.forEach((record) => documents.set(record.id, record))
  snapshot.examProfiles.forEach((record) => profiles.set(record.id, record))
  snapshot.studyItems.forEach((record) => items.set(record.id, record))
  return {
    loadSnapshot: vi.fn(async () => ({ ...snapshot, documents: [...documents.values()], examProfiles: [...profiles.values()], studyItems: [...items.values()] })),
    getMeta: vi.fn(async (key) => meta.get(key)),
    putMeta: vi.fn(async (record) => { meta.set(record.key, record) }),
    getDocument: vi.fn(async (id) => documents.get(id)),
    listDocuments: vi.fn(async () => [...documents.values()]),
    putDocument: vi.fn(async (record) => { documents.set(record.id, record) }),
    replaceDocumentAggregate: vi.fn(async ({ document, studyItems }: ReplaceDocumentAggregateInput) => {
      documents.set(document.id, document)
      const retained = new Set(studyItems.map(({ id }) => id))
      for (const existing of items.values()) {
        if (existing.documentId === document.id && !retained.has(existing.id)) items.delete(existing.id)
      }
      studyItems.forEach((record) => items.set(record.id, record))
    }),
    deleteDocument: vi.fn(async (id) => {
      documents.delete(id)
      for (const item of items.values()) if (item.documentId === id) items.delete(item.id)
    }),
    getExamProfile: vi.fn(async (id) => profiles.get(id)),
    listExamProfiles: vi.fn(async () => [...profiles.values()]),
    putExamProfile: vi.fn(async (record) => { profiles.set(record.id, record) }),
    getStudyItem: vi.fn(async (id) => items.get(id)),
    listStudyItemsByDocument: vi.fn(async (documentId) => [...items.values()].filter((record) => record.documentId === documentId)),
    listDueStudyItems: vi.fn(async () => []),
    putStudyItems: vi.fn(async (records: readonly PersistedStudyItem[]) => { records.forEach((record) => items.set(record.id, record)) }),
    getSession: vi.fn(), listSessions: vi.fn(), listAttemptsBySession: vi.fn(), listPendingOutboxEntries: vi.fn(), putOutboxEntry: vi.fn(),
    completeSession: vi.fn(async (input: CompleteSessionInput) => ({ ...input })),
  } satisfies LocalStudyStore
}

describe('V2StudyRepository', () => {
  it('migrates before its first read and only once', async () => {
    const order: string[] = []
    const store = fakeStore()
    store.loadSnapshot.mockImplementation(async () => { order.push('read'); return { documents: [], studyItems: [], examProfiles: [], sessions: [], attempts: [] } })
    const migrate = vi.fn(async () => { order.push('migration'); return { status: 'migrated' as const, counts: { documents: 0, examProfiles: 0, studyItems: 0, sessions: 0, attempts: 0 }, warnings: [] } })
    const repository = new V2StudyRepository(store, { migrate })

    await repository.loadSnapshot()
    await repository.loadSnapshot()

    expect(order).toEqual(['migration', 'read', 'read'])
    expect(migrate).toHaveBeenCalledOnce()
  })

  it('retries readiness on the same instance after a transient migration failure', async () => {
    const store = fakeStore()
    const migrate = vi.fn()
      .mockRejectedValueOnce(new Error('temporary migration failure'))
      .mockResolvedValueOnce(undefined)
    const repository = new V2StudyRepository(store, {
      migrate,
      now: () => timestamp,
      randomUUID: () => ids.session,
    })

    await expect(repository.loadSnapshot()).rejects.toThrow('temporary migration failure')
    await expect(repository.loadSnapshot()).resolves.toEqual({
      documents: [], examProfiles: [], results: [], attempts: [],
    })

    expect(migrate).toHaveBeenCalledTimes(2)
    expect(store.loadSnapshot).toHaveBeenCalledOnce()
  })

  it('round-trips a legacy nested snapshot while keeping documents and items normalized', async () => {
    const store = fakeStore()
    const repository = new V2StudyRepository(store, { migrate: vi.fn(), now: () => timestamp, randomUUID: () => ids.session })
    const snapshot: AppStateSnapshot = {
      documents: [document()],
      examProfiles: [{ id: ids.profile, subject: 'Math', examDate: '2026-08-01', dailyMinutes: 25, goal: 'gut', confidence: 3, createdAt: timestamp, updatedAt: timestamp }],
      results: [], attempts: [],
    }

    await repository.saveSnapshot(snapshot)
    const loaded = await repository.loadSnapshot()

    expect(store.replaceDocumentAggregate).toHaveBeenCalledWith({
      document: expect.not.objectContaining({ items: expect.anything() }),
      studyItems: [expect.objectContaining({ id: ids.item, documentId: ids.document })],
    })
    expect(loaded).toEqual(snapshot)
    expect((await store.getMeta('deviceId'))?.value).toBe(`device-${ids.session}`)
  })

  it('uses one aggregate replacement and treats nested items as the complete child collection', async () => {
    const existingDocument = { ...document(), ...metadata(ids.document), examProfileId: undefined }
    const staleItem = { ...item(), ...metadata(ids.item), documentId: ids.document }
    const store = fakeStore({ ...emptySnapshot(), documents: [existingDocument], studyItems: [staleItem] })
    const repository = new V2StudyRepository(store, { migrate: vi.fn(), now: () => timestamp, randomUUID: () => ids.session })

    await repository.saveDocument({ ...document(), examProfileId: undefined, items: [] })

    expect(store.replaceDocumentAggregate).toHaveBeenCalledOnce()
    expect(store.replaceDocumentAggregate).toHaveBeenCalledWith(expect.objectContaining({ studyItems: [] }))
    expect(await store.getStudyItem(ids.item)).toBeUndefined()
    expect(store.putDocument).not.toHaveBeenCalled()
    expect(store.putStudyItems).not.toHaveBeenCalled()
  })

  it('rejects a stale exam-profile reference before replacing the aggregate', async () => {
    const store = fakeStore()
    const repository = new V2StudyRepository(store, { migrate: vi.fn(), now: () => timestamp, randomUUID: () => ids.session })

    await expect(repository.saveDocument(document())).rejects.toThrow(/exam profile|not found/i)

    expect(store.replaceDocumentAggregate).not.toHaveBeenCalled()
  })

  it('validates document deletion IDs and delegates cascade semantics to the store', async () => {
    const store = fakeStore({
      ...emptySnapshot(),
      documents: [{ ...document(), ...metadata(ids.document), examProfileId: undefined }],
      studyItems: [{ ...item(), ...metadata(ids.item), documentId: ids.document }],
    })
    const repository = new V2StudyRepository(store, { migrate: vi.fn(), now: () => timestamp, randomUUID: () => ids.session })

    await expect(repository.deleteDocument('bad')).rejects.toThrow(/document.*UUID v4/i)
    expect(store.deleteDocument).not.toHaveBeenCalled()

    await repository.deleteDocument(ids.document)
    expect(store.deleteDocument).toHaveBeenCalledWith(ids.document)
    expect(await store.getStudyItem(ids.item)).toBeUndefined()
  })

  it.each([
    ['document ID', () => ({ ...document(), id: 'not-a-uuid', examProfileId: undefined })],
    ['exam profile ID', () => ({ ...document(), examProfileId: '10000000-0000-7000-8000-000000000002' })],
    ['item ID', () => ({ ...document(), examProfileId: undefined, items: [{ ...item(), id: 'bad' }] })],
    ['item document foreign key', () => ({ ...document(), examProfileId: undefined, items: [{ ...item(), documentId: ids.profile }] })],
    ['document date', () => ({ ...document(), examProfileId: undefined, updatedAt: 'yesterday' })],
    ['item due date', () => ({ ...document(), examProfileId: undefined, items: [{ ...item(), dueAt: 'soon' }] })],
  ])('rejects malformed %s before document aggregate writes', async (_description, makeInvalid) => {
    const store = fakeStore()
    const repository = new V2StudyRepository(store, { migrate: vi.fn(), now: () => timestamp, randomUUID: () => ids.session })

    await expect(repository.saveDocument(makeInvalid())).rejects.toThrow()
    expect(store.replaceDocumentAggregate).not.toHaveBeenCalled()
  })

  it('rejects malformed profile IDs and required dates before profile writes', async () => {
    const store = fakeStore()
    const repository = new V2StudyRepository(store, { migrate: vi.fn(), now: () => timestamp, randomUUID: () => ids.session })
    const profile = { id: ids.profile, subject: 'Math', examDate: '2026-08-01', dailyMinutes: 25, goal: 'gut' as const, confidence: 3 as const, createdAt: timestamp, updatedAt: timestamp }

    await expect(repository.saveExamProfile({ ...profile, id: 'bad' })).rejects.toThrow(/UUID v4/i)
    await expect(repository.saveExamProfile({ ...profile, examDate: '2026-02-30' })).rejects.toThrow(/ISO date/i)
    await expect(repository.saveExamProfile({ ...profile, createdAt: 'invalid' })).rejects.toThrow(/ISO date/i)
    expect(store.putExamProfile).not.toHaveBeenCalled()
  })

  it('rejects malformed session/attempt IDs, dates, and foreign keys before completion', async () => {
    const persistedItem: PersistedStudyItem = { ...item(), ...metadata(ids.item), documentId: ids.document }
    const persistedDocument = { ...document(), ...metadata(ids.document), examProfileId: undefined }
    const store = fakeStore({ ...emptySnapshot(), documents: [persistedDocument], studyItems: [persistedItem] })
    const repository = new V2StudyRepository(store, { migrate: vi.fn(), now: () => timestamp, randomUUID: () => ids.session })
    const result: SessionResult = { id: ids.session, date: timestamp, documentId: ids.document, subject: 'Math', documentTitle: 'Doc', mode: 'recall', score: 80, minutes: 25, answered: 1, blockers: 0, readinessAfter: 70 }
    const attempt: StudyAttempt = { id: ids.attempt, sessionId: ids.session, studyItemId: ids.item, userAnswer: 'answer', rating: 'good', createdAt: timestamp }

    await expect(repository.completeSession({ ...result, id: 'bad' }, [attempt], [item()])).rejects.toThrow(/session.*UUID v4/i)
    await expect(repository.completeSession(result, [{ ...attempt, id: 'bad' }], [item()])).rejects.toThrow(/attempt.*UUID v4/i)
    await expect(repository.completeSession(result, [{ ...attempt, sessionId: ids.document }], [item()])).rejects.toThrow(/session reference/i)
    await expect(repository.completeSession(result, [{ ...attempt, studyItemId: 'bad' }], [item()])).rejects.toThrow(/study item.*UUID v4/i)
    await expect(repository.completeSession({ ...result, date: 'invalid' }, [attempt], [item()])).rejects.toThrow(/ISO date/i)
    await expect(repository.completeSession(result, [{ ...attempt, createdAt: 'invalid' }], [item()])).rejects.toThrow(/ISO date/i)
    expect(store.completeSession).not.toHaveBeenCalled()
  })

  it.each([
    ['missing', undefined],
    ['invalid', 'not-a-uuid'],
  ])('rejects a %s completion document reference before any completion write', async (_case, documentId) => {
    const persistedDocument = { ...document(), ...metadata(ids.document), examProfileId: undefined }
    const persistedItem: PersistedStudyItem = { ...item(), ...metadata(ids.item), documentId: ids.document }
    const store = fakeStore({ ...emptySnapshot(), documents: [persistedDocument], studyItems: [persistedItem] })
    const repository = new V2StudyRepository(store, { migrate: vi.fn(), now: () => timestamp, randomUUID: () => ids.session })
    const result: SessionResult = { id: ids.session, date: timestamp, documentId, subject: 'Math', documentTitle: 'Doc', mode: 'recall', score: 80, minutes: 25, answered: 1, blockers: 0, readinessAfter: 70 }
    const attempt: StudyAttempt = { id: ids.attempt, sessionId: ids.session, studyItemId: ids.item, userAnswer: 'answer', rating: 'good', createdAt: timestamp }

    await expect(repository.completeSession(result, [attempt], [item()])).rejects.toThrow(/document|UUID v4|not found/i)
    expect(store.completeSession).not.toHaveBeenCalled()
  })

  it('delegates nonexistent-document enforcement to the atomic store transaction', async () => {
    const persistedItem: PersistedStudyItem = { ...item(), ...metadata(ids.item), documentId: ids.document }
    const store = fakeStore({ ...emptySnapshot(), studyItems: [persistedItem] })
    store.completeSession.mockRejectedValue(new Error(`Referenced session document not found: ${ids.document}`))
    const repository = new V2StudyRepository(store, { migrate: vi.fn(), now: () => timestamp, randomUUID: () => ids.session })
    const result: SessionResult = { id: ids.session, date: timestamp, documentId: ids.document, subject: 'Math', documentTitle: 'Doc', mode: 'recall', score: 80, minutes: 25, answered: 1, blockers: 0, readinessAfter: 70 }
    const attempt: StudyAttempt = { id: ids.attempt, sessionId: ids.session, studyItemId: ids.item, userAnswer: 'answer', rating: 'good', createdAt: timestamp }

    await expect(repository.completeSession(result, [attempt], [item()])).rejects.toThrow(/document|not found/i)
    expect(store.getDocument).not.toHaveBeenCalled()
    expect(store.completeSession).toHaveBeenCalledOnce()
  })

  it('rejects completed items belonging to another document before any completion write', async () => {
    const persistedDocument = { ...document(), ...metadata(ids.document), examProfileId: undefined }
    const crossDocumentItem = { ...item(), documentId: ids.profile }
    const persistedItem: PersistedStudyItem = { ...crossDocumentItem, ...metadata(ids.item), documentId: ids.profile }
    const store = fakeStore({ ...emptySnapshot(), documents: [persistedDocument], studyItems: [persistedItem] })
    const repository = new V2StudyRepository(store, { migrate: vi.fn(), now: () => timestamp, randomUUID: () => ids.session })
    const result: SessionResult = { id: ids.session, date: timestamp, documentId: ids.document, subject: 'Math', documentTitle: 'Doc', mode: 'recall', score: 80, minutes: 25, answered: 1, blockers: 0, readinessAfter: 70 }
    const attempt: StudyAttempt = { id: ids.attempt, sessionId: ids.session, studyItemId: ids.item, userAnswer: 'answer', rating: 'good', createdAt: timestamp }

    await expect(repository.completeSession(result, [attempt], [crossDocumentItem])).rejects.toThrow(/document/i)
    expect(store.completeSession).not.toHaveBeenCalled()
  })

  it('rejects saveStudyItems when the parent document does not exist', async () => {
    const store = fakeStore()
    const repository = new V2StudyRepository(store, { migrate: vi.fn(), now: () => timestamp, randomUUID: () => ids.session })

    await expect(repository.saveStudyItems(ids.document, [item()])).rejects.toThrow(/document|parent|not found/i)
    expect(store.putStudyItems).not.toHaveBeenCalled()
  })

  it('rejects malformed generated device IDs and timestamps', async () => {
    const malformedIdStore = fakeStore()
    const malformedIdRepository = new V2StudyRepository(malformedIdStore, { migrate: vi.fn(), now: () => timestamp, randomUUID: () => 'device-ish' })
    await expect(malformedIdRepository.status()).rejects.toThrow(/generated device ID.*UUID v4/i)
    expect(malformedIdStore.putMeta).not.toHaveBeenCalled()

    const malformedDateStore = fakeStore()
    const malformedDateRepository = new V2StudyRepository(malformedDateStore, { migrate: vi.fn(), now: () => 'today', randomUUID: () => ids.session })
    await expect(malformedDateRepository.status()).rejects.toThrow(/generated timestamp.*ISO date/i)
    expect(malformedDateStore.putMeta).not.toHaveBeenCalled()
  })

  it('delegates completion to one atomic V2 operation with stable ISO metadata', async () => {
    const persistedItem: PersistedStudyItem = { ...item(), ...metadata(ids.item), documentId: ids.document }
    const persistedDocument = { ...document(), ...metadata(ids.document), examProfileId: undefined }
    const store = fakeStore({ ...emptySnapshot(), documents: [persistedDocument], studyItems: [persistedItem] })
    const repository = new V2StudyRepository(store, { migrate: vi.fn() })
    const result: SessionResult = { id: ids.session, date: timestamp, documentId: ids.document, subject: 'Math', documentTitle: 'Doc', mode: 'recall', score: 80, minutes: 25, answered: 1, blockers: 0, readinessAfter: 70 }
    const attempts: StudyAttempt[] = [{ id: ids.attempt, sessionId: ids.session, studyItemId: ids.item, userAnswer: 'answer', rating: 'good', createdAt: timestamp }]
    const updatedItems = [{ ...item(), dueAt: '2026-07-15T12:00:00.000Z', intervalDays: 1, repetitions: 1, lastRating: 'good' as const }]

    await repository.completeSession(result, attempts, updatedItems)

    expect(store.completeSession).toHaveBeenCalledOnce()
    expect(store.completeSession).toHaveBeenCalledWith(expect.objectContaining({
      session: expect.objectContaining({ id: ids.session, createdAt: timestamp, updatedAt: timestamp }),
      attempts: [expect.objectContaining({ id: ids.attempt, createdAt: timestamp, updatedAt: timestamp })],
      updatedStudyItems: [expect.objectContaining({ id: ids.item, dueAt: updatedItems[0].dueAt })],
      outboxEntries: [expect.objectContaining({ id: ids.session, createdAt: timestamp })],
    }))
  })
})
