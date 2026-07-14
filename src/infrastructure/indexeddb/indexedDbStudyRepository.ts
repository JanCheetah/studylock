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
} from '../../domain/entities'
import type {
  CompleteSessionInput,
  CompleteSessionOutput,
  LocalStudyStore,
  ReplaceDocumentAggregateInput,
  V2StudySnapshot,
} from '../../domain/ports'
import { openStudyLockDatabase, type StudyLockDatabase } from './database'
import { assertValidSessionFinishedOutboxEntry, isUuid } from './outbox'

type DatabaseProvider = StudyLockDatabase | (() => Promise<StudyLockDatabase>)

function ascendingBy<K extends string>(field: K) {
  return <T extends Record<K, string> & { id: UUID }>(left: T, right: T): number =>
    left[field].localeCompare(right[field]) || left.id.localeCompare(right.id)
}

function descendingBy<K extends string>(field: K) {
  return <T extends Record<K, string> & { id: UUID }>(left: T, right: T): number =>
    right[field].localeCompare(left[field]) || left.id.localeCompare(right.id)
}

function assertUniqueIds(records: readonly { id: UUID }[], description: string): void {
  if (new Set(records.map(({ id }) => id)).size !== records.length) {
    throw new Error(`${description} IDs must be unique`)
  }
}

function sameIdentifiers(left: readonly UUID[], right: readonly UUID[]): boolean {
  const sortedRight = [...right].sort()
  return left.length === right.length &&
    [...left].sort().every((id, index) => id === sortedRight[index])
}

function sameSessionCommand(left: PersistedSession, right: PersistedSession): boolean {
  return left.id === right.id && left.createdAt === right.createdAt && left.date === right.date &&
    left.documentId === right.documentId &&
    left.subject === right.subject && left.documentTitle === right.documentTitle &&
    left.mode === right.mode && left.score === right.score && left.minutes === right.minutes &&
    left.answered === right.answered && left.blockers === right.blockers &&
    left.readinessAfter === right.readinessAfter
}

function sameAttemptCommand(left: PersistedAttempt, right: PersistedAttempt): boolean {
  return left.id === right.id && left.createdAt === right.createdAt &&
    left.sessionId === right.sessionId && left.studyItemId === right.studyItemId &&
    left.userAnswer === right.userAnswer && left.rating === right.rating &&
    left.selfScore === right.selfScore && left.timeSpentSeconds === right.timeSpentSeconds
}

function sameAttemptCommands(
  left: readonly PersistedAttempt[],
  right: readonly PersistedAttempt[],
): boolean {
  if (left.length !== right.length) return false
  const rightById = new Map(right.map((attempt) => [attempt.id, attempt]))
  return left.every((attempt) => {
    const matching = rightById.get(attempt.id)
    return matching !== undefined && sameAttemptCommand(attempt, matching)
  })
}

function schedulingSemantics(item: PersistedStudyItem) {
  return {
    id: item.id,
    dueAt: item.dueAt,
    intervalDays: item.intervalDays,
    repetitions: item.repetitions,
    lastRating: item.lastRating ?? null,
    easeFactor: item.easeFactor ?? null,
  }
}

/**
 * Hash only immutable, privacy-safe completion data. In particular, study
 * content and attempt answers are never copied into the durable session.
 */
async function completionFingerprint(input: CompleteSessionInput): Promise<string> {
  const entry = input.outboxEntries[0]
  const canonical = JSON.stringify({
    documentId: input.session.documentId ?? null,
    updatedStudyItems: input.updatedStudyItems
      .map(schedulingSemantics)
      .sort((left, right) => left.id.localeCompare(right.id)),
    outboxPayload: {
      eventType: entry.payload.eventType,
      sessionId: entry.payload.sessionId,
      attemptIds: [...entry.payload.attemptIds].sort(),
      studyItems: entry.payload.studyItems
        .map((item) => ({
          id: item.id,
          dueAt: item.dueAt,
          intervalDays: item.intervalDays,
          repetitions: item.repetitions,
          lastRating: item.lastRating ?? null,
          easeFactor: item.easeFactor ?? null,
        }))
        .sort((left, right) => left.id.localeCompare(right.id)),
    },
  })
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(canonical))
  const hex = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
  return `v1:${hex}`
}

/** IndexedDB implementation of the framework-independent V2 local store. */
export class IndexedDbStudyRepository implements LocalStudyStore {
  readonly #databaseProvider: DatabaseProvider

  constructor(databaseProvider: DatabaseProvider = openStudyLockDatabase) {
    this.#databaseProvider = databaseProvider
  }

  #database(): Promise<StudyLockDatabase> {
    return typeof this.#databaseProvider === 'function'
      ? this.#databaseProvider()
      : Promise.resolve(this.#databaseProvider)
  }

  async loadSnapshot(): Promise<V2StudySnapshot> {
    const database = await this.#database()
    const transaction = database.transaction(
      ['documents', 'studyItems', 'examProfiles', 'sessions', 'attempts'],
      'readonly',
    )
    try {
      const [documents, studyItems, examProfiles, sessions, attempts] = await Promise.all([
        transaction.objectStore('documents').getAll(),
        transaction.objectStore('studyItems').getAll(),
        transaction.objectStore('examProfiles').getAll(),
        transaction.objectStore('sessions').getAll(),
        transaction.objectStore('attempts').getAll(),
      ])
      await transaction.done
      return {
        documents: documents.sort(descendingBy('updatedAt')),
        studyItems: studyItems.sort(ascendingBy('dueAt')),
        examProfiles: examProfiles.sort(descendingBy('updatedAt')),
        sessions: sessions.sort(descendingBy('createdAt')),
        attempts: attempts.sort(ascendingBy('createdAt')),
      }
    } catch (error) {
      try {
        await transaction.done
      } catch {
        // Preserve the originating read error when the transaction also aborts.
      }
      throw error
    }
  }

  async getMeta(key: MetaKey): Promise<MetaRecord | undefined> {
    return (await this.#database()).get('meta', key)
  }

  async putMeta(record: MetaRecord): Promise<void> {
    await (await this.#database()).put('meta', record)
  }

  async getDocument(id: UUID): Promise<PersistedDocument | undefined> {
    return (await this.#database()).get('documents', id)
  }

  async listDocuments(): Promise<readonly PersistedDocument[]> {
    const records = await (await this.#database()).getAll('documents')
    return records.sort(descendingBy('updatedAt'))
  }

  async putDocument(document: PersistedDocument): Promise<void> {
    await (await this.#database()).put('documents', document)
  }

  async replaceDocumentAggregate(input: ReplaceDocumentAggregateInput): Promise<void> {
    const { document, studyItems } = input
    if (!isUuid(document.id)) throw new Error('Document identifier must be a valid UUID')
    assertUniqueIds(studyItems, 'Study item')
    for (const item of studyItems) {
      if (!isUuid(item.id)) throw new Error('Study item identifier must be a valid UUID')
      if (item.documentId !== document.id) {
        throw new Error('Study item document reference must match aggregate document')
      }
    }

    const database = await this.#database()
    const transaction = database.transaction(['documents', 'studyItems'], 'readwrite')
    // A synchronous DataCloneError can abort the transaction before control reaches the catch block.
    void transaction.done.catch(() => undefined)
    const requests: Promise<unknown>[] = []
    const track = (request: Promise<unknown>): void => {
      // Observe each request immediately in case a later put throws synchronously.
      void request.catch(() => undefined)
      requests.push(request)
    }
    try {
      const documents = transaction.objectStore('documents')
      const studyItemStore = transaction.objectStore('studyItems')
      const existingRequest = studyItemStore.index('by-document').getAll(document.id)
      track(existingRequest)
      const existing = await existingRequest
      const suppliedIds = new Set(studyItems.map(({ id }) => id))

      track(documents.put(document))
      for (const item of studyItems) track(studyItemStore.put(item))
      for (const prior of existing) {
        if (!suppliedIds.has(prior.id)) track(studyItemStore.delete(prior.id))
      }
      await Promise.all(requests)
      await transaction.done
    } catch (error) {
      try { transaction.abort() } catch { /* A failed request may already have aborted it. */ }
      await Promise.allSettled(requests)
      try { await transaction.done } catch { /* Preserve the originating error. */ }
      throw error
    }
  }

  async deleteDocument(id: UUID): Promise<void> {
    const database = await this.#database()
    const transaction = database.transaction(['documents', 'studyItems'], 'readwrite')
    // A synchronous DataCloneError can abort the transaction before control reaches the catch block.
    void transaction.done.catch(() => undefined)
    const requests: Promise<unknown>[] = []
    try {
      const documents = transaction.objectStore('documents')
      const studyItems = transaction.objectStore('studyItems')
      const childrenRequest = studyItems.index('by-document').getAll(id)
      requests.push(childrenRequest)
      const children = await childrenRequest
      requests.push(documents.delete(id))
      for (const child of children) requests.push(studyItems.delete(child.id))
      await Promise.all(requests)
      await transaction.done
    } catch (error) {
      try { transaction.abort() } catch { /* A failed request may already have aborted it. */ }
      await Promise.allSettled(requests)
      try { await transaction.done } catch { /* Preserve the originating error. */ }
      throw error
    }
  }

  async getExamProfile(id: UUID): Promise<PersistedExamProfile | undefined> {
    return (await this.#database()).get('examProfiles', id)
  }

  async listExamProfiles(): Promise<readonly PersistedExamProfile[]> {
    const records = await (await this.#database()).getAll('examProfiles')
    return records.sort(descendingBy('updatedAt'))
  }

  async putExamProfile(profile: PersistedExamProfile): Promise<void> {
    await (await this.#database()).put('examProfiles', profile)
  }

  async getStudyItem(id: UUID): Promise<PersistedStudyItem | undefined> {
    return (await this.#database()).get('studyItems', id)
  }

  async listStudyItemsByDocument(documentId: UUID): Promise<readonly PersistedStudyItem[]> {
    const database = await this.#database()
    const records = await database.getAllFromIndex('studyItems', 'by-document', documentId)
    return records.sort(ascendingBy('dueAt'))
  }

  async listDueStudyItems(dueAtOrBefore: ISODateTime): Promise<readonly PersistedStudyItem[]> {
    const database = await this.#database()
    const records = await database.getAllFromIndex(
      'studyItems',
      'by-due-date',
      IDBKeyRange.upperBound(dueAtOrBefore),
    )
    return records.sort(ascendingBy('dueAt'))
  }

  async putStudyItems(items: readonly PersistedStudyItem[]): Promise<void> {
    const database = await this.#database()
    const transaction = database.transaction('studyItems', 'readwrite')
    const writes: Promise<unknown>[] = []
    try {
      for (const item of items) writes.push(transaction.store.put(item))
      await Promise.all(writes)
      await transaction.done
    } catch (error) {
      try {
        transaction.abort()
      } catch {
        // A failed request may already have aborted the transaction.
      }
      await Promise.allSettled(writes)
      try {
        await transaction.done
      } catch {
        // Preserve the original write error.
      }
      throw error
    }
  }

  async getSession(id: UUID): Promise<PersistedSession | undefined> {
    return (await this.#database()).get('sessions', id)
  }

  async listSessions(): Promise<readonly PersistedSession[]> {
    const records = await (await this.#database()).getAll('sessions')
    return records.sort(descendingBy('createdAt'))
  }

  async listAttemptsBySession(sessionId: UUID): Promise<readonly PersistedAttempt[]> {
    const database = await this.#database()
    const records = await database.getAllFromIndex('attempts', 'by-session', sessionId)
    return records.sort(ascendingBy('createdAt'))
  }

  async listPendingOutboxEntries(): Promise<readonly OutboxRecord[]> {
    const database = await this.#database()
    const records = await database.getAllFromIndex('outbox', 'by-status', 'pending')
    return records.sort(ascendingBy('createdAt'))
  }

  async putOutboxEntry(entry: OutboxRecord): Promise<void> {
    assertValidSessionFinishedOutboxEntry(entry)
    await (await this.#database()).put('outbox', entry)
  }

  async completeSession(input: CompleteSessionInput): Promise<CompleteSessionOutput> {
    this.assertValidCompletion(input)
    const submittedFingerprint = await completionFingerprint(input)
    const sessionToPersist = { ...input.session, completionFingerprint: submittedFingerprint }
    const database = await this.#database()
    const transaction = database.transaction(
      ['documents', 'sessions', 'attempts', 'studyItems', 'outbox'],
      'readwrite',
    )
    const requests: Promise<unknown>[] = []

    try {
      const documents = transaction.objectStore('documents')
      const sessions = transaction.objectStore('sessions')
      const attempts = transaction.objectStore('attempts')
      const studyItems = transaction.objectStore('studyItems')
      const outbox = transaction.objectStore('outbox')
      const existingSessionRequest = sessions.get(input.session.id)
      const existingAttemptsRequest = attempts.index('by-session').getAll(input.session.id)
      const attemptsByIdRequest = Promise.all(input.attempts.map(({ id }) => attempts.get(id)))
      const existingItemsRequest = Promise.all(
        input.updatedStudyItems.map(({ id }) => studyItems.get(id)),
      )
      const currentOutboxRequest = outbox.get(input.session.id)
      const documentRequest = documents.get(input.session.documentId as UUID)
      requests.push(
        existingSessionRequest,
        existingAttemptsRequest,
        attemptsByIdRequest,
        existingItemsRequest,
        currentOutboxRequest,
        documentRequest,
      )
      const [existingSession, existingAttempts, attemptsById, existingItems, currentOutbox, referencedDocument] = await Promise.all([
        existingSessionRequest,
        existingAttemptsRequest,
        attemptsByIdRequest,
        existingItemsRequest,
        currentOutboxRequest,
        documentRequest,
      ])

      if (existingSession !== undefined) {
        if (existingSession.completionFingerprint === undefined ||
            existingSession.completionFingerprint !== submittedFingerprint ||
            !sameSessionCommand(existingSession, input.session) ||
            !sameAttemptCommands(existingAttempts, input.attempts)) {
          throw new Error('Conflicting reuse of session idempotency key')
        }
        await transaction.done
        return {
          session: existingSession,
          attempts: existingAttempts.sort(ascendingBy('createdAt')),
          updatedStudyItems: existingItems.filter(
            (item): item is PersistedStudyItem => item !== undefined,
          ),
          outboxEntries: currentOutbox === undefined ? [] : [currentOutbox],
        }
      }

      if (attemptsById.some((attempt) => attempt !== undefined)) {
        throw new Error('Attempt identifier collision with an existing session')
      }

      if (referencedDocument === undefined) {
        throw new Error(`Referenced session document not found: ${input.session.documentId}`)
      }
      if (input.updatedStudyItems.some((item) => item.documentId !== input.session.documentId)) {
        throw new Error('Every updated study item must belong to the session document')
      }

      if (existingItems.some((item) => item === undefined)) {
        throw new Error('Every updated study item must already exist')
      }
      if (existingItems.some((item) => item?.documentId !== input.session.documentId)) {
        throw new Error('Every persisted study item must belong to the session document')
      }

      // Queue writes individually so already-created request promises can still
      // be observed if a later put throws synchronously (for example DataCloneError).
      requests.push(sessions.put(sessionToPersist))
      for (const attempt of input.attempts) requests.push(attempts.put(attempt))
      for (const item of input.updatedStudyItems) requests.push(studyItems.put(item))
      for (const entry of input.outboxEntries) requests.push(outbox.put(entry))
      await Promise.all(requests)
      await transaction.done
    } catch (error) {
      try {
        transaction.abort()
      } catch {
        // A failed request may already have aborted the transaction.
      }
      await Promise.allSettled(requests)
      try {
        await transaction.done
      } catch {
        // Preserve the original validation or write error.
      }
      throw error
    }

    return {
      session: sessionToPersist,
      attempts: input.attempts,
      updatedStudyItems: input.updatedStudyItems,
      outboxEntries: input.outboxEntries,
    }
  }

  private assertValidCompletion(input: CompleteSessionInput): void {
    if (!isUuid(input.session.id)) throw new Error('Session identifier must be a valid UUID')
    if (!isUuid(input.session.documentId)) {
      throw new Error('Session document identifier must be a valid UUID')
    }
    assertUniqueIds(input.attempts, 'Attempt')
    assertUniqueIds(input.updatedStudyItems, 'Updated study item')
    if (input.outboxEntries.length !== 1) {
      throw new Error('Session completion requires exactly one outbox entry')
    }

    const attemptedItemIds = input.attempts.map(({ studyItemId }) => studyItemId)
    for (const attempt of input.attempts) {
      if (!isUuid(attempt.id) || !isUuid(attempt.studyItemId)) {
        throw new Error('Attempt identifiers must be valid UUIDs')
      }
      if (attempt.sessionId !== input.session.id) {
        throw new Error('Attempt session reference does not match session')
      }
    }
    for (const item of input.updatedStudyItems) {
      if (!isUuid(item.id)) throw new Error('Study item identifier must be a valid UUID')
    }
    const updatedItemIds = new Set(input.updatedStudyItems.map(({ id }) => id))
    if (attemptedItemIds.some((id) => !updatedItemIds.has(id)) ||
        input.updatedStudyItems.some(({ id }) => !attemptedItemIds.includes(id))) {
      throw new Error('Attempted and updated study item identifiers must match exactly')
    }

    const entry = input.outboxEntries[0]
    assertValidSessionFinishedOutboxEntry(entry)
    if (entry.id !== input.session.id || entry.entityId !== input.session.id) {
      throw new Error('Outbox entry ID and entity ID must match the completed session')
    }
    if (entry.status !== 'pending' || entry.attempts !== 0 || 'lastError' in entry) {
      throw new Error('Outbox entry must have fresh pending queue state')
    }
    if (entry.createdAt !== input.session.updatedAt ||
        entry.updatedAt !== input.session.updatedAt ||
        entry.version !== input.session.version ||
        entry.deviceId !== input.session.deviceId) {
      throw new Error('Outbox metadata must match the completed session')
    }
    if (!sameIdentifiers(entry.payload.attemptIds, input.attempts.map(({ id }) => id)) ||
        !sameIdentifiers(
          entry.payload.studyItems.map(({ id }) => id),
          input.updatedStudyItems.map(({ id }) => id),
        )) {
      throw new Error('Outbox identifiers must match the completed attempts and study items')
    }

    const updatedItemsById = new Map(input.updatedStudyItems.map((item) => [item.id, item]))
    for (const scheduling of entry.payload.studyItems) {
      const item = updatedItemsById.get(scheduling.id)
      if (item === undefined || scheduling.dueAt !== item.dueAt ||
          scheduling.intervalDays !== item.intervalDays ||
          scheduling.repetitions !== item.repetitions ||
          (scheduling.lastRating ?? null) !== (item.lastRating ?? null) ||
          scheduling.easeFactor !== item.easeFactor) {
        throw new Error('Outbox scheduling data must match updated study items exactly')
      }
    }
  }
}
