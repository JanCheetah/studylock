import type { AppStateSnapshot } from '../../types'
import type { StudyRepository } from './studyRepository'

export type SyncCounts = {
  documents: number
  examProfiles: number
  results: number
}

export function countSnapshot(snapshot: AppStateSnapshot): SyncCounts {
  return {
    documents: snapshot.documents.length,
    examProfiles: snapshot.examProfiles.length,
    results: snapshot.results.length,
  }
}

export async function syncSnapshotToRepository(source: StudyRepository, target: StudyRepository): Promise<SyncCounts> {
  const snapshot = await source.loadSnapshot()
  await target.saveSnapshot(snapshot)
  return countSnapshot(snapshot)
}
