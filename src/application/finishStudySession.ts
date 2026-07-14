import type {
  OutboxRecord,
  PersistedAttempt,
  PersistedSession,
  PersistedStudyItem,
  SessionFinishedOutboxPayload,
} from '../domain/entities'
import type { CompleteSessionOutput, LocalStudyStore } from '../domain/ports'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type FinishStudySessionCommand = {
  session: PersistedSession
  attempts: readonly PersistedAttempt[]
  updatedStudyItems: readonly PersistedStudyItem[]
}

function buildOutboxEntry(
  session: PersistedSession,
  attempts: readonly PersistedAttempt[],
  updatedStudyItems: readonly PersistedStudyItem[],
): OutboxRecord {
  const payload: SessionFinishedOutboxPayload = {
    eventType: 'session.finished',
    sessionId: session.id,
    attemptIds: attempts.map(({ id }) => id).sort(),
    studyItems: updatedStudyItems
      .map(({ id, dueAt, intervalDays, repetitions, lastRating, easeFactor }) => ({
        id,
        dueAt,
        intervalDays,
        repetitions,
        ...(lastRating === undefined ? {} : { lastRating }),
        easeFactor,
      }))
      .sort((left, right) => left.id.localeCompare(right.id)),
  }

  return {
    // A session can finish only once, so its UUID is also a stable event key.
    id: session.id,
    createdAt: session.updatedAt,
    updatedAt: session.updatedAt,
    version: session.version,
    deviceId: session.deviceId,
    entityType: 'session',
    entityId: session.id,
    operation: 'put',
    payload,
    status: 'pending',
    attempts: 0,
  }
}

/** Builds the durable event and delegates all persistence to one atomic store call. */
export async function finishStudySession(
  store: LocalStudyStore,
  command: FinishStudySessionCommand,
): Promise<CompleteSessionOutput> {
  const { session, attempts, updatedStudyItems } = command
  if (!UUID_PATTERN.test(session.id)) throw new Error('Session identifier must be a valid UUID')

  const updatedIds = new Set(updatedStudyItems.map(({ id }) => id))
  if (updatedIds.size !== updatedStudyItems.length) throw new Error('Updated study item IDs must be unique')
  for (const attempt of attempts) {
    if (attempt.sessionId !== session.id) throw new Error('Attempt session reference does not match session')
    if (!updatedIds.has(attempt.studyItemId)) throw new Error('Attempt must reference an included study item')
  }

  const outboxEntry = buildOutboxEntry(session, attempts, updatedStudyItems)
  return store.completeSession({
    session,
    attempts,
    updatedStudyItems,
    outboxEntries: [outboxEntry],
  })
}
