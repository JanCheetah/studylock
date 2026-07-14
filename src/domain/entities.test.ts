import { describe, expectTypeOf, it } from 'vitest'
import type {
  PersistedAttempt,
  PersistedDocument,
  PersistedStudyItem,
  UUID,
} from './entities'

describe('persisted entity identifiers', () => {
  it('types every persisted foreign key as a UUID', () => {
    expectTypeOf<PersistedStudyItem['documentId']>().toEqualTypeOf<UUID>()
    expectTypeOf<NonNullable<PersistedDocument['examProfileId']>>().toEqualTypeOf<UUID>()
    expectTypeOf<PersistedAttempt['sessionId']>().toEqualTypeOf<UUID>()
    expectTypeOf<PersistedAttempt['studyItemId']>().toEqualTypeOf<UUID>()
  })
})
