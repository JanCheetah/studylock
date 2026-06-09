import type { StudyItem } from '../types'
import { supabase, isSupabaseConfigured } from './supabaseClient'

export async function generateStudyItemsWithAi(documentId: string, subject: string, text: string): Promise<StudyItem[] | null> {
  if (!isSupabaseConfigured || !supabase || text.trim().length < 80) return null

  try {
    const { data, error } = await supabase.functions.invoke<{ items?: StudyItem[] }>('generate-study-items', {
      body: { documentId, subject, text },
    })

    if (error) throw error
    return Array.isArray(data?.items) && data.items.length ? data.items : null
  } catch (error) {
    console.warn('StudyLock AI generation fallback:', error)
    return null
  }
}
