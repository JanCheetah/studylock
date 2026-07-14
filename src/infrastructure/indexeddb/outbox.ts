import type {
  OutboxRecord,
  UUID,
} from '../../domain/entities'

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const OUTBOX_KEYS = [
  'id', 'createdAt', 'updatedAt', 'version', 'deviceId', 'entityType', 'entityId',
  'operation', 'payload', 'status', 'attempts', 'lastError',
] as const
const PAYLOAD_KEYS = ['eventType', 'sessionId', 'attemptIds', 'studyItems'] as const
const SCHEDULING_KEYS = [
  'id', 'dueAt', 'intervalDays', 'repetitions', 'lastRating', 'easeFactor',
] as const

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function assertExactEnumerableKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  required: readonly string[],
  description: string,
): void {
  const enumerableKeys = Reflect.ownKeys(value).filter((key) =>
    Object.prototype.propertyIsEnumerable.call(value, key),
  )
  const keys = enumerableKeys.filter((key): key is string => typeof key === 'string')
  if (keys.length !== enumerableKeys.length || keys.some((key) => !allowed.includes(key)) ||
      required.some((key) => !keys.includes(key))) {
    throw new Error(`${description} contains unexpected or missing fields`)
  }
}

export function isUuid(value: unknown): value is UUID {
  return typeof value === 'string' && UUID_PATTERN.test(value)
}

export function assertValidSessionFinishedOutboxEntry(entry: OutboxRecord): void {
  if (!isRecord(entry)) throw new Error('Outbox entry must be a record')
  assertExactEnumerableKeys(
    entry,
    OUTBOX_KEYS,
    OUTBOX_KEYS.filter((key) => key !== 'lastError'),
    'Outbox entry',
  )
  if (!isUuid(entry.id) || !isUuid(entry.entityId)) {
    throw new Error('Outbox identifiers must be valid UUIDs')
  }
  if (entry.entityType !== 'session' || entry.operation !== 'put') {
    throw new Error('A session.finished outbox entry must target a session put')
  }
  if (typeof entry.createdAt !== 'string' || typeof entry.updatedAt !== 'string' ||
      !Number.isInteger(entry.version) || typeof entry.deviceId !== 'string' ||
      !['pending', 'processing', 'failed'].includes(entry.status) ||
      !Number.isInteger(entry.attempts) || entry.attempts < 0 ||
      ('lastError' in entry && typeof entry.lastError !== 'string')) {
    throw new Error('Outbox queue metadata is invalid')
  }

  const payload = entry.payload
  if (!isRecord(payload)) throw new Error('Outbox payload must be a record')
  assertExactEnumerableKeys(payload, PAYLOAD_KEYS, PAYLOAD_KEYS, 'Outbox payload')
  if (payload.eventType !== 'session.finished' || !isUuid(payload.sessionId)) {
    throw new Error('Outbox payload must identify a valid session.finished event')
  }
  if (entry.entityId !== payload.sessionId) {
    throw new Error('Outbox session identifiers must agree')
  }
  if (!Array.isArray(payload.attemptIds) || !payload.attemptIds.every(isUuid) ||
      new Set(payload.attemptIds).size !== payload.attemptIds.length) {
    throw new Error('Outbox attempt identifiers must be valid and unique')
  }
  if (!Array.isArray(payload.studyItems)) {
    throw new Error('Outbox study items must be an array')
  }
  const schedulingIds = payload.studyItems.map((value) => isRecord(value) ? value.id : undefined)
  if (new Set(schedulingIds).size !== payload.studyItems.length) {
    throw new Error('Outbox study item identifiers must be unique')
  }
  for (const scheduling of payload.studyItems) {
    if (!isRecord(scheduling)) throw new Error('Outbox scheduling entry must be a record')
    assertExactEnumerableKeys(
      scheduling,
      SCHEDULING_KEYS,
      ['id', 'dueAt', 'intervalDays', 'repetitions'],
      'Outbox scheduling entry',
    )
    const intervalDays = scheduling.intervalDays
    const repetitions = scheduling.repetitions
    if (!isUuid(scheduling.id) || typeof scheduling.dueAt !== 'string' ||
        typeof intervalDays !== 'number' || !Number.isFinite(intervalDays) || intervalDays < 0 ||
        typeof repetitions !== 'number' || !Number.isInteger(repetitions) || repetitions < 0 ||
        ('easeFactor' in scheduling &&
          (typeof scheduling.easeFactor !== 'number' || !Number.isFinite(scheduling.easeFactor))) ||
        ('lastRating' in scheduling && scheduling.lastRating !== null &&
          !['again', 'hard', 'good', 'easy'].includes(scheduling.lastRating as string))) {
      throw new Error('Outbox study item scheduling data is invalid')
    }
  }
}
