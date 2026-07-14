import { describe, expect, it, vi } from 'vitest'
import type {
  OutboxRecord,
  PersistedAttempt,
  PersistedSession,
  PersistedStudyItem,
  UUID,
} from '../domain/entities'
import type { LocalStudyStore } from '../domain/ports'
import { finishStudySession } from './finishStudySession'

const sessionId = '018f47b4-0b7a-7c25-8d3f-100000000001' as UUID
const attemptId = '018f47b4-0b7a-7c25-8d3f-100000000002' as UUID
const itemId = '018f47b4-0b7a-7c25-8d3f-100000000003' as UUID
const documentId = '018f47b4-0b7a-7c25-8d3f-100000000004' as UUID
const now = '2026-07-14T10:00:00.000Z'
const metadata = { createdAt: now, updatedAt: now, version: 4, deviceId: 'device-1', syncStatus: 'pending' as const }
const session: PersistedSession = {
  id: sessionId,
  ...metadata,
  date: now,
  documentId,
  subject: 'Security',
  documentTitle: 'PRIVATE DOCUMENT TITLE',
  mode: 'recall',
  score: 100,
  minutes: 10,
  answered: 1,
  blockers: 0,
  readinessAfter: 90,
}
const attempt: PersistedAttempt = {
  id: attemptId,
  ...metadata,
  sessionId,
  studyItemId: itemId,
  userAnswer: 'PRIVATE USER ANSWER',
  rating: 'good',
}
const updatedItem: PersistedStudyItem = {
  id: itemId,
  ...metadata,
  documentId,
  topic: 'PRIVATE TOPIC',
  question: 'PRIVATE QUESTION',
  answer: 'PRIVATE MODEL ANSWER',
  source: 'PRIVATE RAW DOCUMENT TEXT',
  difficulty: 'mittel',
  type: 'karte',
  dueAt: '2026-07-16T10:00:00.000Z',
  intervalDays: 2,
  repetitions: 3,
  lastRating: 'good',
  easeFactor: 2.6,
}

function storeWithCompleteSession(
  implementation: LocalStudyStore['completeSession'],
): LocalStudyStore {
  return {
    loadSnapshot: vi.fn(),
    getMeta: vi.fn(), putMeta: vi.fn(),
    getDocument: vi.fn(), listDocuments: vi.fn(), putDocument: vi.fn(),
    replaceDocumentAggregate: vi.fn(), deleteDocument: vi.fn(),
    getExamProfile: vi.fn(), listExamProfiles: vi.fn(), putExamProfile: vi.fn(),
    getStudyItem: vi.fn(), listStudyItemsByDocument: vi.fn(), listDueStudyItems: vi.fn(), putStudyItems: vi.fn(),
    getSession: vi.fn(), listSessions: vi.fn(), listAttemptsBySession: vi.fn(),
    listPendingOutboxEntries: vi.fn(), putOutboxEntry: vi.fn(),
    completeSession: implementation,
  }
}

describe('finishStudySession', () => {
  it('builds one stable session.finished outbox event and delegates one atomic command', async () => {
    const completeSession = vi.fn<LocalStudyStore['completeSession']>(async (input) => input)
    const store = storeWithCompleteSession(completeSession)

    await finishStudySession(store, { session, attempts: [attempt], updatedStudyItems: [updatedItem] })
    await finishStudySession(store, { session, attempts: [attempt], updatedStudyItems: [updatedItem] })

    expect(completeSession).toHaveBeenCalledTimes(2)
    const first = completeSession.mock.calls[0][0]
    const second = completeSession.mock.calls[1][0]
    expect(first.outboxEntries).toHaveLength(1)
    expect(first.outboxEntries[0]).toEqual(second.outboxEntries[0])
    expect(first.outboxEntries[0]).toMatchObject({
      id: sessionId,
      entityType: 'session',
      entityId: sessionId,
      operation: 'put',
      status: 'pending',
      attempts: 0,
      payload: {
        eventType: 'session.finished',
        sessionId,
        attemptIds: [attemptId],
        studyItems: [{
          id: itemId,
          dueAt: updatedItem.dueAt,
          intervalDays: 2,
          repetitions: 3,
          lastRating: 'good',
          easeFactor: 2.6,
        }],
      },
    } satisfies Partial<OutboxRecord>)
  })

  it('never serializes user answers, document content, questions, model answers, or titles', async () => {
    const completeSession = vi.fn<LocalStudyStore['completeSession']>(async (input) => input)
    await finishStudySession(storeWithCompleteSession(completeSession), {
      session, attempts: [attempt], updatedStudyItems: [updatedItem],
    })

    const serialized = JSON.stringify(completeSession.mock.calls[0][0].outboxEntries[0])
    for (const secret of [
      attempt.userAnswer,
      updatedItem.question,
      updatedItem.answer,
      updatedItem.source,
      updatedItem.topic,
      session.documentTitle,
    ]) expect(serialized).not.toContain(secret)
  })

  it('rejects invalid references before calling the store', async () => {
    const completeSession = vi.fn<LocalStudyStore['completeSession']>(async (input) => input)
    const store = storeWithCompleteSession(completeSession)

    await expect(finishStudySession(store, {
      session,
      attempts: [{ ...attempt, sessionId: updatedItem.documentId }],
      updatedStudyItems: [updatedItem],
    })).rejects.toThrow(/session/i)
    await expect(finishStudySession(store, {
      session,
      attempts: [{ ...attempt, studyItemId: updatedItem.documentId }],
      updatedStudyItems: [updatedItem],
    })).rejects.toThrow(/study item/i)

    expect(completeSession).not.toHaveBeenCalled()
  })
})
