import type { RepositoryStatus } from '../../types'
import { isSupabaseConfigured, supabase } from '../supabaseClient'
import { syncSnapshotToRepository, type SyncCounts } from './sync'
import { SupabaseStudyRepository } from './supabaseStudyRepository'
import type { StudyRepository } from './studyRepository'
import { V2StudyRepository } from './v2StudyRepository'

/** The sole app repository. Authentication never replaces the local source of truth. */
export const localStudyRepository = new V2StudyRepository()

export async function getRepositoryStatus(): Promise<RepositoryStatus> {
  return localStudyRepository.status()
}

export async function getStudyRepository(): Promise<StudyRepository> {
  return localStudyRepository
}

export async function syncLocalSnapshotToCloud(): Promise<SyncCounts> {
  if (!isSupabaseConfigured || !supabase) throw new Error('Supabase ist nicht konfiguriert')
  const cloudRepository = new SupabaseStudyRepository(supabase)
  const status = await cloudRepository.status()
  if (!status.authenticated) throw new Error('Bitte zuerst per Magic Link einloggen')
  return syncSnapshotToRepository(localStudyRepository, cloudRepository)
}
