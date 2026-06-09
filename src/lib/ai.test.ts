import { describe, expect, it, vi, beforeEach } from 'vitest'
import { generateStudyItemsWithAi } from './ai'

vi.mock('./supabaseClient', () => ({
  supabase: {
    auth: {
      getUser: vi.fn(),
    },
    functions: {
      invoke: vi.fn(),
    },
  },
  isSupabaseConfigured: true,
}))

vi.mock('./openrouter', () => ({
  hasApiKey: vi.fn().mockReturnValue(false),
}))

vi.mock('./aiStudyEngine', () => ({
  generateItemsFromText: vi.fn(),
  isAIAvailable: vi.fn().mockReturnValue(false),
}))

describe('generateStudyItemsWithAi', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('falls back to heuristic when text is too short', async () => {
    const result = await generateStudyItemsWithAi('doc-1', 'Mathe', 'Short')
    expect(result.source).toBe('heuristic-v1')
    expect(result.items.length).toBe(0)
    expect(result.error).toBe('Text zu kurz')
  })

  it('falls back to heuristic when not logged in', async () => {
    const { supabase } = await import('./supabaseClient')
    vi.mocked(supabase!.auth.getUser).mockResolvedValue({ data: { user: null }, error: null } as any)

    const result = await generateStudyItemsWithAi('doc-1', 'Mathe', 'A'.repeat(100))
    expect(result.source).toBe('heuristic-v1')
    expect(result.error).toBe('Login fehlt')
  })

  it('returns items from edge function on success', async () => {
    const { supabase } = await import('./supabaseClient')
    vi.mocked(supabase!.auth.getUser).mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null } as any)
    vi.mocked(supabase!.functions.invoke).mockResolvedValue({
      data: {
        items: [
          {
            id: 'item-1',
            topic: 'Topic',
            question: 'Question?',
            answer: 'Answer',
            source: 'Source',
            type: 'karte',
            difficulty: 'leicht',
            dueAt: new Date().toISOString(),
            intervalDays: 0,
            repetitions: 0,
          },
        ],
      },
      error: null,
    } as any)

    const result = await generateStudyItemsWithAi('doc-1', 'Mathe', 'A'.repeat(100))
    expect(result.source).toBe('openrouter')
    expect(result.items[0].topic).toBe('Topic')
    expect(result.error).toBeUndefined()
  })

  it('handles edge function errors gracefully', async () => {
    const { supabase } = await import('./supabaseClient')
    vi.mocked(supabase!.auth.getUser).mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null } as any)
    vi.mocked(supabase!.functions.invoke).mockResolvedValue({
      data: null,
      error: new Error('Rate limit exceeded: 429') as any,
    })

    const result = await generateStudyItemsWithAi('doc-1', 'Mathe', 'A'.repeat(100))
    expect(result.source).toBe('heuristic-v1')
    expect(result.error).toBe('OpenRouter rate-limited')
  })
})
