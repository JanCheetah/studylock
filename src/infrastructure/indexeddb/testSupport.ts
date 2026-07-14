import { deleteDB } from 'idb'
import { closeStudyLockDatabase } from './database'
import { STUDYLOCK_DB_NAME } from './schema'

/** Test-only cleanup kept out of the production database module. */
export async function resetStudyLockDatabaseForTests(): Promise<void> {
  closeStudyLockDatabase()
  await deleteDB(STUDYLOCK_DB_NAME)
}
