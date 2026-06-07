import type { RepositoryStatus } from '../../types'
import { isSupabaseConfigured, supabase } from '../supabaseClient'
import { LocalStudyRepository } from './localStudyRepository'
import { SupabaseStudyRepository } from './supabaseStudyRepository'
import type { StudyRepository } from './studyRepository'

export const localStudyRepository = new LocalStudyRepository()

export async function getRepositoryStatus(): Promise<RepositoryStatus> {
  if (!isSupabaseConfigured || !supabase) return localStudyRepository.status()
  return new SupabaseStudyRepository(supabase).status()
}

export async function getStudyRepository(): Promise<StudyRepository> {
  if (!isSupabaseConfigured || !supabase) return localStudyRepository
  const cloudRepository = new SupabaseStudyRepository(supabase)
  const status = await cloudRepository.status()
  return status.authenticated ? cloudRepository : localStudyRepository
}
