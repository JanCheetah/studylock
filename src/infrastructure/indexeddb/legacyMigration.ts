import type {
  ExamProfile,
  SessionResult,
  StudyAttempt,
  StudyDocument,
} from '../../types'
import type {
  DeviceId,
  MetaRecord,
  PersistenceMetadata,
  PersistedAttempt,
  PersistedDocument,
  PersistedExamProfile,
  PersistedSession,
  PersistedStudyItem,
  UUID,
} from '../../domain/entities'
import { storageKeys } from '../../lib/storage'
import { openStudyLockDatabase, type StudyLockDatabase } from './database'

export const LEGACY_MIGRATION_META_KEY = 'legacyMigrationV1' as const
const LEGACY_MIGRATION_MARKER_VERSION = 1 as const
const UUID_GENERATION_ATTEMPTS = 16

const legacyCollections = [
  ['documents', storageKeys.documents],
  ['examProfiles', storageKeys.examProfiles],
  ['results', storageKeys.results],
  ['attempts', storageKeys.attempts],
] as const

const migrationStores = [
  'meta',
  'documents',
  'examProfiles',
  'studyItems',
  'sessions',
  'attempts',
] as const

export interface LegacyStorageReader {
  getItem(key: string): string | null
}

export type LegacyMigrationCounts = {
  documents: number
  examProfiles: number
  studyItems: number
  sessions: number
  attempts: number
}

export type LegacyMigrationResult = {
  status: 'migrated' | 'already-migrated' | 'blocked'
  counts: LegacyMigrationCounts
  warnings: string[]
}

export type LegacyMigrationOptions = {
  storage?: LegacyStorageReader
  database?: StudyLockDatabase
  now?: () => string
  randomUUID?: () => string
}

type ParsedLegacy = {
  documents: StudyDocument[]
  examProfiles: ExamProfile[]
  results: SessionResult[]
  attempts: StudyAttempt[]
}

type MarkerState =
  | { state: 'absent' }
  | { state: 'valid'; counts: LegacyMigrationCounts }
  | { state: 'invalid' }

const emptyCounts = (): LegacyMigrationCounts => ({
  documents: 0,
  examProfiles: 0,
  studyItems: 0,
  sessions: 0,
  attempts: 0,
})

const blocked = (warnings: string[]): LegacyMigrationResult => ({
  status: 'blocked',
  counts: emptyCounts(),
  warnings,
})

function acquireDefaultStorage():
  | { storage: LegacyStorageReader }
  | { warning: string } {
  try {
    if (typeof globalThis === 'undefined' || !('localStorage' in globalThis)) {
      return { warning: 'Legacy storage is unavailable; migration blocked.' }
    }
    const storage = globalThis.localStorage
    if (!storage || typeof storage.getItem !== 'function') {
      return { warning: 'Legacy storage is unavailable; migration blocked.' }
    }
    return { storage }
  } catch {
    return { warning: 'Legacy storage is unavailable; migration blocked.' }
  }
}

function randomValuesUUID(): string {
  const getRandomValues = globalThis.crypto?.getRandomValues?.bind(globalThis.crypto)
  if (!getRandomValues) throw new Error('Secure UUID generation is unavailable')
  const bytes = new Uint8Array(16)
  getRandomValues(bytes)
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('')
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`
}

function defaultRandomUUID(): string {
  if (typeof globalThis.crypto?.randomUUID === 'function') return globalThis.crypto.randomUUID()
  return randomValuesUUID()
}

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
const isUUID = (value: unknown): value is UUID => typeof value === 'string' && uuidPattern.test(value)
const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)
const isNonemptyString = (value: unknown): value is string =>
  typeof value === 'string' && value.trim().length > 0
const isDateString = (value: unknown): value is string => {
  if (!isNonemptyString(value) || !/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(value) || !Number.isFinite(Date.parse(value))) return false
  const [year, month, day] = value.slice(0, 10).split('-').map(Number)
  const calendarDate = new Date(Date.UTC(year, month - 1, day))
  return calendarDate.getUTCFullYear() === year && calendarDate.getUTCMonth() === month - 1 && calendarDate.getUTCDate() === day
}
function normalizeSessionDate(value: unknown): string | undefined {
  if (isDateString(value)) return new Date(value).toISOString()
  if (typeof value !== 'string') return undefined
  const match = /^(\d{2})\.(\d{2})\.(\d{2}|\d{4}),\s*(\d{2}):(\d{2})$/.exec(value)
  if (!match) return undefined
  const [, dayText, monthText, yearText, hourText, minuteText] = match
  const year = yearText.length === 2 ? 2000 + Number(yearText) : Number(yearText)
  const month = Number(monthText)
  const day = Number(dayText)
  const hour = Number(hourText)
  const minute = Number(minuteText)
  if (hour > 23 || minute > 59) return undefined
  const date = new Date(Date.UTC(year, month - 1, day, hour, minute))
  if (
    date.getUTCFullYear() !== year
    || date.getUTCMonth() !== month - 1
    || date.getUTCDate() !== day
  ) return undefined
  return date.toISOString()
}
const isFiniteInRange = (value: unknown, minimum: number, maximum: number): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= minimum && value <= maximum
const isIntegerInRange = (value: unknown, minimum: number, maximum: number): value is number =>
  isFiniteInRange(value, minimum, maximum) && Number.isInteger(value)
const oneOf = <T extends string>(value: unknown, choices: readonly T[]): value is T =>
  typeof value === 'string' && choices.includes(value as T)

function validateRequiredStrings(record: Record<string, unknown>, fields: string[]): string | undefined {
  const invalid = fields.find((field) => !isNonemptyString(record[field]))
  return invalid ? `field "${invalid}" must be a nonempty string` : undefined
}

function validateItem(value: unknown): string | undefined {
  if (!isRecord(value)) return 'must be an object'
  const strings = validateRequiredStrings(value, ['id', 'documentId', 'topic', 'question', 'answer', 'source'])
  if (strings) return strings
  if (!oneOf(value.difficulty, ['leicht', 'mittel', 'hart'])) return 'field "difficulty" is invalid'
  if (!oneOf(value.type, ['karte', 'quiz', 'aufgabe'])) return 'field "type" is invalid'
  if (!isDateString(value.dueAt)) return 'field "dueAt" must be a parseable ISO/date string'
  if (!isFiniteInRange(value.intervalDays, 0, 365000)) return 'field "intervalDays" is invalid'
  if (!isIntegerInRange(value.repetitions, 0, Number.MAX_SAFE_INTEGER)) return 'field "repetitions" is invalid'
  if (!isFiniteInRange(value.easeFactor, 0, 10)) return 'field "easeFactor" is invalid'
  if (value.lastRating !== undefined && !oneOf(value.lastRating, ['again', 'hard', 'good'])) return 'field "lastRating" is invalid'
  if (value.aiGenerated !== undefined && typeof value.aiGenerated !== 'boolean') return 'field "aiGenerated" is invalid'
  if (value.generationSource !== undefined && !oneOf(value.generationSource, ['openrouter', 'heuristic-v1'])) return 'field "generationSource" is invalid'
  for (const optional of ['hint', 'aiEvaluation']) {
    if (value[optional] !== undefined && typeof value[optional] !== 'string') return `field "${optional}" is invalid`
  }
  return undefined
}

function validateDocument(value: unknown): string | undefined {
  if (!isRecord(value)) return 'must be an object'
  const strings = validateRequiredStrings(value, ['id', 'title', 'subject', 'text'])
  if (strings) return strings
  if (value.sourceType !== undefined && !oneOf(value.sourceType, ['pdf', 'txt', 'md', 'paste'])) return 'field "sourceType" is invalid'
  if (value.examProfileId !== undefined && !isNonemptyString(value.examProfileId)) return 'field "examProfileId" is invalid'
  if (!isDateString(value.createdAt) || !isDateString(value.updatedAt)) return 'timestamps must be parseable ISO/date strings'
  if (!Array.isArray(value.items)) return 'field "items" must be an array'
  return undefined
}

function validateProfile(value: unknown): string | undefined {
  if (!isRecord(value)) return 'must be an object'
  const strings = validateRequiredStrings(value, ['id', 'subject'])
  if (strings) return strings
  if (!isDateString(value.examDate) || !isDateString(value.createdAt) || !isDateString(value.updatedAt)) return 'date fields must be parseable ISO/date strings'
  if (!isIntegerInRange(value.dailyMinutes, 1, 1440)) return 'field "dailyMinutes" is invalid'
  if (!oneOf(value.goal, ['bestehen', 'gut', 'sehr-gut'])) return 'field "goal" is invalid'
  if (!isIntegerInRange(value.confidence, 1, 5)) return 'field "confidence" is invalid'
  return undefined
}

function validateSession(value: unknown): string | undefined {
  if (!isRecord(value)) return 'must be an object'
  const strings = validateRequiredStrings(value, ['id', 'subject', 'documentTitle'])
  if (strings) return strings
  if (!normalizeSessionDate(value.date)) return 'field "date" must be a valid ISO/date or German short date/time string'
  if (!oneOf(value.mode, ['recall', 'deepwork', 'review', 'exam'])) return 'field "mode" is invalid'
  if (!isFiniteInRange(value.score, 0, 100) || !isFiniteInRange(value.readinessAfter, 0, 100)) return 'score fields must be between 0 and 100'
  for (const field of ['minutes', 'answered', 'blockers']) {
    if (!isIntegerInRange(value[field], 0, Number.MAX_SAFE_INTEGER)) return `field "${field}" is invalid`
  }
  return undefined
}

function validateAttempt(value: unknown): string | undefined {
  if (!isRecord(value)) return 'must be an object'
  const strings = validateRequiredStrings(value, ['id', 'sessionId', 'studyItemId'])
  if (strings) return strings
  if (typeof value.userAnswer !== 'string') return 'field "userAnswer" must be a string'
  if (!isDateString(value.createdAt)) return 'field "createdAt" must be a parseable ISO/date string'
  if (value.rating !== undefined && !oneOf(value.rating, ['again', 'hard', 'good'])) return 'field "rating" is invalid'
  if (!isNonemptyString(value.userAnswer) && value.rating === undefined) return 'an answer or rating is required'
  if (value.selfScore !== undefined && !isFiniteInRange(value.selfScore, 0, 100)) return 'field "selfScore" is invalid'
  if (value.timeSpentSeconds !== undefined && !isFiniteInRange(value.timeSpentSeconds, 0, Number.MAX_SAFE_INTEGER)) return 'field "timeSpentSeconds" is invalid'
  return undefined
}

function parseLegacy(storage: LegacyStorageReader):
  | { parsed: ParsedLegacy; warnings: [] }
  | { parsed?: never; warnings: string[] } {
  const parsed: Record<string, unknown[]> = {}
  const warnings: string[] = []

  for (const [name, key] of legacyCollections) {
    let raw: string | null
    try {
      raw = storage.getItem(key)
    } catch {
      warnings.push(`Legacy key "${key}" could not be read; migration blocked.`)
      continue
    }
    if (raw === null) {
      parsed[name] = []
      continue
    }
    try {
      const value: unknown = JSON.parse(raw)
      if (!Array.isArray(value)) {
        warnings.push(`Legacy key "${key}" must contain a JSON array; migration blocked.`)
      } else {
        parsed[name] = value
      }
    } catch {
      warnings.push(`Legacy key "${key}" contains invalid JSON; migration blocked.`)
    }
  }
  if (warnings.length > 0) return { warnings }

  const validators = {
    documents: validateDocument,
    examProfiles: validateProfile,
    results: validateSession,
    attempts: validateAttempt,
  } as const
  for (const [name, key] of legacyCollections) {
    const seen = new Set<string>()
    parsed[name].forEach((record, index) => {
      const problem = validators[name](record)
      if (problem) {
        warnings.push(`Legacy key "${key}" record [${index}] ${problem}; migration blocked.`)
        return
      }
      const id = (record as Record<string, unknown>).id as string
      if (seen.has(id)) warnings.push(`Legacy ${name} record [${index}] has a duplicate source ID; migration blocked.`)
      seen.add(id)
      if (name === 'documents') {
        const items = (record as unknown as StudyDocument).items
        items.forEach((item, itemIndex) => {
          const itemProblem = validateItem(item)
          if (itemProblem) warnings.push(`Legacy key "${key}" record [${index}].items[${itemIndex}] ${itemProblem}; migration blocked.`)
        })
      }
    })
  }

  const itemIds = new Set<string>()
  ;(parsed.documents as unknown as StudyDocument[]).forEach((document, documentIndex) => {
    if (!isRecord(document) || !Array.isArray(document.items)) return
    document.items.forEach((item, itemIndex) => {
      if (!isRecord(item) || !isNonemptyString(item.id)) return
      if (itemIds.has(item.id)) warnings.push(`Legacy documents record [${documentIndex}].items[${itemIndex}] has a duplicate source ID; migration blocked.`)
      itemIds.add(item.id)
      if (item.documentId !== document.id) warnings.push(`Legacy documents record [${documentIndex}].items[${itemIndex}] does not belong to its containing document; migration blocked.`)
    })
  })

  if (warnings.length > 0) return { warnings }
  return { parsed: parsed as ParsedLegacy, warnings: [] }
}

function markerState(record: MetaRecord | undefined): MarkerState {
  if (!record) return { state: 'absent' }
  const value = record.value
  if (!isRecord(value) || value.completed !== true || value.version !== LEGACY_MIGRATION_MARKER_VERSION || !isRecord(value.counts)) {
    return { state: 'invalid' }
  }
  const counts = value.counts as Record<string, unknown>
  const fields: (keyof LegacyMigrationCounts)[] = ['documents', 'examProfiles', 'studyItems', 'sessions', 'attempts']
  if (!fields.every((field) => isIntegerInRange(counts[field], 0, Number.MAX_SAFE_INTEGER))) return { state: 'invalid' }
  return { state: 'valid', counts: counts as LegacyMigrationCounts }
}

function metadata(id: UUID, createdAt: string, updatedAt: string, deviceId: DeviceId): PersistenceMetadata {
  return { id, createdAt, updatedAt, version: 1, deviceId, syncStatus: 'local' }
}

function abortTransaction(transaction: ReturnType<StudyLockDatabase['transaction']>): void {
  try { transaction.abort() } catch { /* It may already be inactive. */ }
}

export async function migrateLegacyLocalStorage(
  options: LegacyMigrationOptions = {},
): Promise<LegacyMigrationResult> {
  const database = options.database ?? await openStudyLockDatabase()
  const initialMarker = markerState(await database.get('meta', LEGACY_MIGRATION_META_KEY))
  if (initialMarker.state === 'valid') return { status: 'already-migrated', counts: initialMarker.counts, warnings: [] }
  if (initialMarker.state === 'invalid') return blocked(['Legacy migration marker is invalid; migration blocked.'])

  let storage = options.storage
  if (!storage) {
    const acquired = acquireDefaultStorage()
    if ('warning' in acquired) return blocked([acquired.warning])
    storage = acquired.storage
  }
  const legacy = parseLegacy(storage)
  if (!legacy.parsed) return blocked(legacy.warnings)

  const now = (options.now ?? (() => new Date().toISOString()))()
  if (!isDateString(now)) return blocked(['Migration timestamp is invalid; migration blocked.'])
  const randomUUID = options.randomUUID ?? defaultRandomUUID
  const generationWarnings: string[] = []
  // A generated ID must not alias any preserved UUID, even across entity types.
  const allocatedIds = new Set<string>()
  for (const profile of legacy.parsed.examProfiles) if (isUUID(profile.id)) allocatedIds.add(profile.id)
  for (const document of legacy.parsed.documents) {
    if (isUUID(document.id)) allocatedIds.add(document.id)
    for (const item of document.items) if (isUUID(item.id)) allocatedIds.add(item.id)
  }
  for (const session of legacy.parsed.results) if (isUUID(session.id)) allocatedIds.add(session.id)
  for (const attempt of legacy.parsed.attempts) if (isUUID(attempt.id)) allocatedIds.add(attempt.id)
  const generateUUID = (): UUID | undefined => {
    for (let attempt = 0; attempt < UUID_GENERATION_ATTEMPTS; attempt += 1) {
      let candidate: string
      try { candidate = randomUUID() } catch { continue }
      if (isUUID(candidate) && !allocatedIds.has(candidate)) {
        allocatedIds.add(candidate)
        return candidate
      }
    }
    generationWarnings.push('A valid unique UUID could not be generated; migration blocked.')
    return undefined
  }

  const existingDevice = await database.get('meta', 'deviceId')
  let deviceId: DeviceId
  let deviceRecord: MetaRecord | undefined
  if (existingDevice && isNonemptyString(existingDevice.value)) {
    deviceId = existingDevice.value as DeviceId
  } else {
    const generated = generateUUID()
    if (!generated) return blocked(generationWarnings)
    deviceId = `device-${generated}` as DeviceId
    deviceRecord = { key: 'deviceId', value: deviceId, updatedAt: now }
  }

  const repairWarnings: string[] = []
  const createMapper = (entityName: string) => {
    const ids = new Map<string, UUID>()
    return {
      add(sourceId: string): boolean {
        if (isUUID(sourceId)) {
          ids.set(sourceId, sourceId)
          return true
        }
        const replacement = generateUUID()
        if (!replacement) return false
        ids.set(sourceId, replacement)
        repairWarnings.push(`Repaired invalid ${entityName} UUID "${sourceId}" as "${replacement}".`)
        return true
      },
      get(sourceId: string): UUID | undefined { return ids.get(sourceId) },
    }
  }
  const profileIds = createMapper('exam profile')
  const documentIds = createMapper('document')
  const itemIds = createMapper('study item')
  const sessionIds = createMapper('session')
  const attemptIds = createMapper('attempt')
  for (const profile of legacy.parsed.examProfiles) if (!profileIds.add(profile.id)) return blocked(generationWarnings)
  for (const document of legacy.parsed.documents) {
    if (!documentIds.add(document.id)) return blocked(generationWarnings)
    for (const item of document.items) if (!itemIds.add(item.id)) return blocked(generationWarnings)
  }
  for (const session of legacy.parsed.results) if (!sessionIds.add(session.id)) return blocked(generationWarnings)
  for (const attempt of legacy.parsed.attempts) if (!attemptIds.add(attempt.id)) return blocked(generationWarnings)

  const profiles: PersistedExamProfile[] = legacy.parsed.examProfiles.map((profile) => ({
    ...profile,
    ...metadata(profileIds.get(profile.id)!, profile.createdAt, profile.updatedAt, deviceId),
  }))
  const documents: PersistedDocument[] = legacy.parsed.documents.map((document) => ({
    title: document.title,
    subject: document.subject,
    sourceType: document.sourceType,
    text: document.text,
    ...metadata(documentIds.get(document.id)!, document.createdAt, document.updatedAt, deviceId),
    ...(document.examProfileId && profileIds.get(document.examProfileId)
      ? { examProfileId: profileIds.get(document.examProfileId) }
      : document.examProfileId && isUUID(document.examProfileId)
        ? { examProfileId: document.examProfileId }
        : {}),
  }))
  const items: PersistedStudyItem[] = legacy.parsed.documents.flatMap((document) => document.items.map((item) => ({
    ...item,
    ...metadata(itemIds.get(item.id)!, now, now, deviceId),
    documentId: documentIds.get(document.id)!,
  })))
  const sessions: PersistedSession[] = legacy.parsed.results.map((session) => ({
    ...session,
    ...metadata(sessionIds.get(session.id)!, normalizeSessionDate(session.date)!, normalizeSessionDate(session.date)!, deviceId),
  }))

  const referenceWarnings: string[] = []
  legacy.parsed.documents.forEach((document, index) => {
    if (document.examProfileId && !profileIds.get(document.examProfileId) && !isUUID(document.examProfileId)) {
      referenceWarnings.push(`Legacy documents record [${index}] exam profile reference cannot resolve; migration blocked.`)
    }
  })
  legacy.parsed.attempts.forEach((attempt, index) => {
    if (!sessionIds.get(attempt.sessionId) && !isUUID(attempt.sessionId)) referenceWarnings.push(`Legacy attempts record [${index}] session reference cannot resolve; migration blocked.`)
    if (!itemIds.get(attempt.studyItemId) && !isUUID(attempt.studyItemId)) referenceWarnings.push(`Legacy attempts record [${index}] study item reference cannot resolve; migration blocked.`)
  })
  if (referenceWarnings.length > 0) return blocked(referenceWarnings)

  const attempts: PersistedAttempt[] = legacy.parsed.attempts.map((attempt) => ({
    ...attempt,
    ...metadata(attemptIds.get(attempt.id)!, attempt.createdAt, attempt.createdAt, deviceId),
    sessionId: sessionIds.get(attempt.sessionId) ?? attempt.sessionId as UUID,
    studyItemId: itemIds.get(attempt.studyItemId) ?? attempt.studyItemId as UUID,
  }))

  const transaction = database.transaction(migrationStores, 'readwrite')
  try {
    const metaStore = transaction.objectStore('meta')
    const transactionMarker = markerState(await metaStore.get(LEGACY_MIGRATION_META_KEY))
    if (transactionMarker.state === 'valid') {
      await transaction.done
      return { status: 'already-migrated', counts: transactionMarker.counts, warnings: [] }
    }
    if (transactionMarker.state === 'invalid') {
      abortTransaction(transaction)
      try { await transaction.done } catch { /* Expected after abort. */ }
      return blocked(['Legacy migration marker is invalid; migration blocked.'])
    }

    const entityGroups = [
      ['examProfiles', profiles], ['documents', documents], ['studyItems', items],
      ['sessions', sessions], ['attempts', attempts],
    ] as const
    for (const [storeName, records] of entityGroups) {
      const store = transaction.objectStore(storeName)
      for (const record of records) {
        if (await store.get(record.id)) {
          abortTransaction(transaction)
          try { await transaction.done } catch { /* Expected after abort. */ }
          return blocked([`Target ${storeName} key collision detected; migration blocked.`])
        }
      }
    }

    for (let index = 0; index < legacy.parsed.documents.length; index += 1) {
      const reference = legacy.parsed.documents[index].examProfileId
      if (reference && !profileIds.get(reference) && !await transaction.objectStore('examProfiles').get(reference as UUID)) {
        abortTransaction(transaction)
        try { await transaction.done } catch { /* Expected after abort. */ }
        return blocked([`Legacy documents record [${index}] exam profile reference cannot resolve; migration blocked.`])
      }
    }
    for (let index = 0; index < legacy.parsed.attempts.length; index += 1) {
      const attempt = legacy.parsed.attempts[index]
      if (!sessionIds.get(attempt.sessionId) && !await transaction.objectStore('sessions').get(attempt.sessionId as UUID)) {
        abortTransaction(transaction)
        try { await transaction.done } catch { /* Expected after abort. */ }
        return blocked([`Legacy attempts record [${index}] session reference cannot resolve; migration blocked.`])
      }
      if (!itemIds.get(attempt.studyItemId) && !await transaction.objectStore('studyItems').get(attempt.studyItemId as UUID)) {
        abortTransaction(transaction)
        try { await transaction.done } catch { /* Expected after abort. */ }
        return blocked([`Legacy attempts record [${index}] study item reference cannot resolve; migration blocked.`])
      }
    }

    if (deviceRecord) await metaStore.put(deviceRecord)
    for (const profile of profiles) await transaction.objectStore('examProfiles').put(profile)
    for (const document of documents) await transaction.objectStore('documents').put(document)
    for (const item of items) await transaction.objectStore('studyItems').put(item)
    for (const session of sessions) await transaction.objectStore('sessions').put(session)
    for (const attempt of attempts) await transaction.objectStore('attempts').put(attempt)

    const counts: LegacyMigrationCounts = {
      documents: documents.length,
      examProfiles: profiles.length,
      studyItems: items.length,
      sessions: sessions.length,
      attempts: attempts.length,
    }
    await metaStore.add({
      key: LEGACY_MIGRATION_META_KEY,
      value: { completed: true, version: LEGACY_MIGRATION_MARKER_VERSION, counts },
      updatedAt: now,
    })
    await transaction.done
    return { status: 'migrated', counts, warnings: repairWarnings }
  } catch (error) {
    abortTransaction(transaction)
    try { await transaction.done } catch { /* Preserve the original failure. */ }
    throw error
  }
}
