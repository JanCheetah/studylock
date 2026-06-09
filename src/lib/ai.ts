import type { StudyItem } from '../types'
import { supabase, isSupabaseConfigured } from './supabaseClient'
import { hasApiKey } from './openrouter'
import { generateItemsFromText } from './aiStudyEngine'
import { buildItems } from './studyEngine'

export async function generateStudyItemsWithAi(
  documentId: string,
  subject: string,
  text: string,
  onProgress?: (status: string) => void
): Promise<{ items: StudyItem[]; source: 'openrouter' | 'heuristic-v1'; error?: string; model?: string; promptVersion?: string }> {
  // 1. If local API key is configured, use direct client-side openrouter call
  if (hasApiKey()) {
    onProgress?.('KI erzeugt Lernitems (Client-Direkt)...')
    try {
      const result = await generateItemsFromText(documentId, subject, text, 20, onProgress)
      return {
        items: result.items,
        source: result.aiGenerated ? 'openrouter' : 'heuristic-v1',
        error: result.errorMessage,
        model: result.model,
        promptVersion: result.promptVersion,
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Client AI failed'
      return {
        items: buildItems(documentId, subject, text),
        source: 'heuristic-v1',
        error: msg,
      }
    }
  }

  // 2. Check Supabase configuration
  if (!isSupabaseConfigured || !supabase) {
    return {
      items: buildItems(documentId, subject, text),
      source: 'heuristic-v1',
      error: 'Supabase nicht konfiguriert',
    }
  }

  if (text.trim().length < 80) {
    return {
      items: buildItems(documentId, subject, text),
      source: 'heuristic-v1',
      error: 'Text zu kurz',
    }
  }

  onProgress?.('KI erzeugt Lernitems (Edge Function)...')
  try {
    const { data: userResponse } = await supabase.auth.getUser()
    if (!userResponse.user) {
      return {
        items: buildItems(documentId, subject, text),
        source: 'heuristic-v1',
        error: 'Login fehlt',
      }
    }

    const { data, error } = await supabase.functions.invoke<{ items?: StudyItem[]; error?: string }>('generate-study-items', {
      body: { documentId, subject, text },
    })

    if (error) throw error

    if (Array.isArray(data?.items) && data.items.length) {
      const items = data.items.map((item) => ({
        ...item,
        generationSource: 'openrouter' as const,
      }))
      return {
        items,
        source: 'openrouter',
        model: 'openrouter/owl-alpha',
        promptVersion: 'v1',
      }
    }

    throw new Error(data?.error || 'Empty output from Edge Function')
  } catch (error) {
    const msg = error instanceof Error ? error.message : 'Unknown Edge Function error'
    const isRateLimit = msg.toLowerCase().includes('429') || msg.toLowerCase().includes('rate limit') || msg.toLowerCase().includes('rate-limited')
    return {
      items: buildItems(documentId, subject, text),
      source: 'heuristic-v1',
      error: isRateLimit ? 'OpenRouter rate-limited' : msg,
    }
  }
}

