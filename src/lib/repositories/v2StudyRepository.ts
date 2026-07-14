import { finishStudySession } from '../../application/finishStudySession'
import type {
  DeviceId,
  PersistenceMetadata,
  PersistedAttempt,
  PersistedDocument,
  PersistedSession,
  PersistedStudyItem,
  UUID,
} from '../../domain/entities'
import type { LocalStudyStore, V2StudySnapshot } from '../../domain/ports'
import { IndexedDbStudyRepository } from '../../infrastructure/indexeddb/indexedDbStudyRepository'
import { migrateLegacyLocalStorage, type LegacyMigrationResult } from '../../infrastructure/indexeddb/legacyMigration'
import type {
  AiGenerationLog,
  AppStateSnapshot,
  DocumentChunk,
  ExamProfile,
  RepositoryStatus,
  SessionResult,
  StudyAttempt,
  StudyDocument,
  StudyItem,
} from '../../types'
import { id } from '../studyEngine'
import type { StudyRepository } from './studyRepository'

type Options = {
  migrate?: () => Promise<LegacyMigrationResult | void>
  now?: () => string
  randomUUID?: () => string
}

const UUID_V4_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const ISO_DATE_TIME_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/

function uuidV4(value: unknown, description: string): UUID {
  if (typeof value !== 'string' || !UUID_V4_PATTERN.test(value)) {
    throw new Error(`${description} must be a valid UUID v4`)
  }
  return value as UUID
}

function validatedDeviceId(value: unknown, description: string): DeviceId {
  if (typeof value !== 'string' || !value.startsWith('device-')) {
    throw new Error(`${description} must be based on a valid UUID v4`)
  }
  uuidV4(value.slice('device-'.length), description)
  return value
}

function isoDateTime(value: unknown, description: string): string {
  if (typeof value !== 'string' || !ISO_DATE_TIME_PATTERN.test(value) ||
      !Number.isFinite(Date.parse(value)) || !isValidCalendarDate(value.slice(0, 10))) {
    throw new Error(`${description} must be a valid ISO date-time`)
  }
  return value
}

function isValidCalendarDate(value: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value
}

function isoDate(value: unknown, description: string): string {
  if (typeof value !== 'string' || !isValidCalendarDate(value)) {
    throw new Error(`${description} must be a valid ISO date`)
  }
  return value
}

function omitKeys<T extends object, K extends keyof T>(record: T, keys: readonly K[]): Omit<T, K> {
  const copy = { ...record } as T
  for (const key of keys) delete copy[key]
  return copy
}

const persistenceKeys = ['createdAt', 'updatedAt', 'version', 'deviceId', 'syncStatus'] as const

/** Legacy React compatibility adapter over the normalized, offline-first V2 store. */
export class V2StudyRepository implements StudyRepository {
  readonly #store: LocalStudyStore
  readonly #migrate: () => Promise<LegacyMigrationResult | void>
  readonly #now: () => string
  readonly #randomUUID: () => string
  #readyPromise?: Promise<void>

  constructor(
    store: LocalStudyStore = new IndexedDbStudyRepository(),
    options: Options = {},
  ) {
    this.#store = store
    this.#migrate = options.migrate ?? migrateLegacyLocalStorage
    this.#now = options.now ?? (() => new Date().toISOString())
    this.#randomUUID = options.randomUUID ?? (() => id())
  }

  async #ready(): Promise<void> {
    if (this.#readyPromise === undefined) {
      this.#readyPromise = (async () => {
        const migration = await this.#migrate()
        if (migration?.status === 'blocked') {
          throw new Error(`Legacy migration blocked: ${migration.warnings.join(' ')}`)
        }
        await this.#deviceId()
      })()
    }
    const pending = this.#readyPromise
    try {
      await pending
    } catch (error) {
      if (this.#readyPromise === pending) this.#readyPromise = undefined
      throw error
    }
  }

  async #deviceId(): Promise<DeviceId> {
    const existing = await this.#store.getMeta('deviceId')
    if (existing !== undefined) return validatedDeviceId(existing.value, 'Stored device ID')
    const now = isoDateTime(this.#now(), 'Generated timestamp')
    const generatedUuid = uuidV4(this.#randomUUID(), 'Generated device ID')
    const deviceId = validatedDeviceId(`device-${generatedUuid}`, 'Generated device ID')
    await this.#store.putMeta({ key: 'deviceId', value: deviceId, updatedAt: now })
    return deviceId
  }

  async #metadata(
    record: { id: string; createdAt?: string; updatedAt?: string },
    existing?: PersistenceMetadata,
  ): Promise<PersistenceMetadata> {
    const now = isoDateTime(this.#now(), 'Generated timestamp')
    return {
      id: uuidV4(record.id, 'Record ID'),
      createdAt: existing?.createdAt ?? (record.createdAt === undefined ? now : isoDateTime(record.createdAt, 'createdAt')),
      updatedAt: record.updatedAt === undefined ? now : isoDateTime(record.updatedAt, 'updatedAt'),
      version: existing ? existing.version + 1 : 1,
      deviceId: await this.#deviceId(),
      syncStatus: 'local',
    }
  }

  async status(): Promise<RepositoryStatus> {
    await this.#ready()
    return {
      mode: 'local',
      configured: true,
      authenticated: true,
      label: 'Lokale IndexedDB',
      detail: 'IndexedDB ist die offline-first Datenquelle. Cloud-Sync erfolgt nur auf ausdrücklichen Wunsch.',
    }
  }

  async loadSnapshot(): Promise<AppStateSnapshot> {
    await this.#ready()
    return this.#toLegacySnapshot(await this.#store.loadSnapshot())
  }

  #toLegacySnapshot(snapshot: V2StudySnapshot): AppStateSnapshot {
    const itemsByDocument = new Map<string, StudyItem[]>()
    snapshot.studyItems.forEach((persisted) => {
      const item = omitKeys(persisted, persistenceKeys)
      itemsByDocument.set(item.documentId, [...(itemsByDocument.get(item.documentId) ?? []), item])
    })
    return {
      documents: snapshot.documents.map((persisted) => {
        const document = omitKeys(persisted, ['version', 'deviceId', 'syncStatus'] as const)
        return { ...document, items: itemsByDocument.get(document.id) ?? [] }
      }),
      examProfiles: snapshot.examProfiles.map((persisted) => {
        return omitKeys(persisted, ['version', 'deviceId', 'syncStatus'] as const)
      }),
      results: snapshot.sessions.map((persisted) => {
        return omitKeys(persisted, [...persistenceKeys, 'completionFingerprint'] as const)
      }),
      attempts: snapshot.attempts.map((persisted) => {
        return omitKeys(persisted, ['updatedAt', 'version', 'deviceId', 'syncStatus'] as const)
      }),
    }
  }

  async saveDocument(document: StudyDocument): Promise<void> {
    const documentId = uuidV4(document.id, 'Document ID')
    isoDateTime(document.createdAt, 'Document createdAt')
    isoDateTime(document.updatedAt, 'Document updatedAt')
    const examProfileId = document.examProfileId === undefined
      ? undefined
      : uuidV4(document.examProfileId, 'Document exam profile ID')
    const itemIds = new Set<string>()
    for (const item of document.items) {
      const itemId = uuidV4(item.id, 'Study item ID')
      if (itemIds.has(itemId)) throw new Error('Study item IDs must be unique')
      itemIds.add(itemId)
      if (uuidV4(item.documentId, 'Study item document ID') !== documentId) {
        throw new Error('Study item document reference must match document')
      }
      isoDateTime(item.dueAt, 'Study item dueAt')
    }
    await this.#ready()
    if (examProfileId !== undefined && await this.#store.getExamProfile(examProfileId) === undefined) {
      throw new Error(`Referenced exam profile not found: ${examProfileId}`)
    }
    const existing = await this.#store.getDocument(documentId)
    const { items, ...fields } = document
    const persisted: PersistedDocument = {
      ...fields,
      ...await this.#metadata(document, existing),
      examProfileId,
    }
    const persistedItems = await Promise.all(items.map(async (item): Promise<PersistedStudyItem> => {
      const itemId = uuidV4(item.id, 'Study item ID')
      const existingItem = await this.#store.getStudyItem(itemId)
      if (existingItem !== undefined && existingItem.documentId !== documentId) {
        throw new Error(`Study item ID already belongs to another document: ${itemId}`)
      }
      return { ...item, ...await this.#metadata({ id: item.id }, existingItem), documentId }
    }))
    await this.#store.replaceDocumentAggregate({ document: persisted, studyItems: persistedItems })
  }

  async deleteDocument(documentId: string): Promise<void> {
    const id = uuidV4(documentId, 'Document ID')
    await this.#ready()
    await this.#store.deleteDocument(id)
  }

  async saveExamProfile(profile: ExamProfile): Promise<void> {
    const profileId = uuidV4(profile.id, 'Exam profile ID')
    isoDate(profile.examDate, 'Exam date')
    isoDateTime(profile.createdAt, 'Exam profile createdAt')
    isoDateTime(profile.updatedAt, 'Exam profile updatedAt')
    await this.#ready()
    const existing = await this.#store.getExamProfile(profileId)
    await this.#store.putExamProfile({ ...profile, ...await this.#metadata(profile, existing) })
  }

  async saveStudyItems(documentId: string, items: StudyItem[]): Promise<void> {
    const parentId = uuidV4(documentId, 'Document ID')
    const uniqueIds = new Set<string>()
    for (const item of items) {
      const itemId = uuidV4(item.id, 'Study item ID')
      if (uniqueIds.has(itemId)) throw new Error('Study item IDs must be unique')
      uniqueIds.add(itemId)
      if (uuidV4(item.documentId, 'Study item document ID') !== parentId) {
        throw new Error('Study item document reference must match document')
      }
      isoDateTime(item.dueAt, 'Study item dueAt')
    }
    await this.#ready()
    if (await this.#store.getDocument(parentId) === undefined) {
      throw new Error(`Parent document not found: ${parentId}`)
    }
    const persisted = await Promise.all(items.map(async (item): Promise<PersistedStudyItem> => {
      const existing = await this.#store.getStudyItem(uuidV4(item.id, 'Study item ID'))
      if (existing !== undefined && existing.documentId !== parentId) {
        throw new Error(`Study item ID already belongs to another document: ${item.id}`)
      }
      return {
        ...item,
        ...await this.#metadata({ id: item.id }, existing),
        documentId: parentId,
      }
    }))
    await this.#store.putStudyItems(persisted)
  }

  async completeSession(result: SessionResult, attempts: StudyAttempt[], updatedItems: StudyItem[]): Promise<void> {
    const sessionId = uuidV4(result.id, 'Session ID')
    const documentId = uuidV4(result.documentId, 'Session document ID')
    isoDateTime(result.date, 'Session date')
    const attemptIds = new Set<string>()
    for (const attempt of attempts) {
      const attemptId = uuidV4(attempt.id, 'Attempt ID')
      if (attemptIds.has(attemptId)) throw new Error('Attempt IDs must be unique')
      attemptIds.add(attemptId)
      if (uuidV4(attempt.sessionId, 'Attempt session ID') !== sessionId) {
        throw new Error('Attempt session reference must match session')
      }
      uuidV4(attempt.studyItemId, 'Attempt study item ID')
      isoDateTime(attempt.createdAt, 'Attempt createdAt')
    }
    for (const item of updatedItems) {
      uuidV4(item.id, 'Study item ID')
      if (uuidV4(item.documentId, 'Study item document ID') !== documentId) {
        throw new Error('Completed study items must belong to the session document')
      }
      isoDateTime(item.dueAt, 'Study item dueAt')
    }
    await this.#ready()
    const completionTime = attempts[0]?.createdAt ?? result.date
    const deviceId = await this.#deviceId()
    const base = (recordId: string): PersistenceMetadata => ({
      id: uuidV4(recordId, 'Record ID'), createdAt: completionTime, updatedAt: completionTime,
      version: 1, deviceId, syncStatus: 'pending',
    })
    const session: PersistedSession = { ...result, ...base(result.id) }
    const persistedAttempts: PersistedAttempt[] = attempts.map((attempt) => ({
      ...attempt,
      ...base(attempt.id),
      createdAt: attempt.createdAt,
      updatedAt: attempt.createdAt,
      sessionId,
      studyItemId: uuidV4(attempt.studyItemId, 'Attempt study item ID'),
    }))
    const persistedItems = await Promise.all(updatedItems.map(async (item): Promise<PersistedStudyItem> => {
      const existing = await this.#store.getStudyItem(uuidV4(item.id, 'Study item ID'))
      if (!existing) throw new Error(`Completed study item not found: ${item.id}`)
      if (existing.documentId !== documentId) {
        throw new Error(`Completed study item does not belong to the session document: ${item.id}`)
      }
      return { ...existing, ...item, id: existing.id, documentId: existing.documentId, updatedAt: completionTime, version: existing.version + 1, deviceId, syncStatus: 'pending' }
    }))
    await finishStudySession(this.#store, { session, attempts: persistedAttempts, updatedStudyItems: persistedItems })
  }

  async saveSession(_result: SessionResult): Promise<void> {
    void _result
    throw new Error('V2 sessions must be persisted with completeSession')
  }

  async saveStudyAttempts(_attempts: StudyAttempt[]): Promise<void> {
    void _attempts
    throw new Error('V2 attempts must be persisted with completeSession')
  }

  async recordAiGeneration(_log: AiGenerationLog): Promise<void> {
    void _log
    // Deliberate local no-op for this V2 slice; generated items retain their source.
  }

  async saveDocumentChunks(_documentId: string, _chunks: DocumentChunk[]): Promise<void> {
    void _documentId
    void _chunks
    // Deliberate local no-op until normalized chunk storage is introduced.
  }

  async saveSnapshot(snapshot: AppStateSnapshot): Promise<void> {
    await this.#ready()
    for (const profile of snapshot.examProfiles) await this.saveExamProfile(profile)
    for (const document of snapshot.documents) await this.saveDocument(document)
    if (snapshot.results.length || snapshot.attempts?.length) {
      throw new Error('Importing completed V2 sessions requires atomic completion commands')
    }
  }
}
