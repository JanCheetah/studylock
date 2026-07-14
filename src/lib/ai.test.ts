import { describe, expect, it, vi, beforeEach } from 'vitest'
import { generateStudyItemsWithAi } from './ai'
import { supabase as configuredSupabase } from './supabaseClient'

type ConfiguredSupabase = NonNullable<typeof configuredSupabase>
type GetUserResponse = Awaited<ReturnType<ConfiguredSupabase['auth']['getUser']>>
type InvokeResponse = Awaited<ReturnType<ConfiguredSupabase['functions']['invoke']>>

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
    vi.mocked(supabase!.auth.getUser).mockResolvedValue(
      { data: { user: null }, error: null } as unknown as GetUserResponse,
    )

    const result = await generateStudyItemsWithAi('doc-1', 'Mathe', 'A'.repeat(100))
    expect(result.source).toBe('heuristic-v1')
    expect(result.error).toBe('Login fehlt')
  })

  it('returns items from edge function on success', async () => {
    const { supabase } = await import('./supabaseClient')
    vi.mocked(supabase!.auth.getUser).mockResolvedValue(
      { data: { user: { id: 'user-1' } }, error: null } as unknown as GetUserResponse,
    )
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
    } as InvokeResponse)

    const result = await generateStudyItemsWithAi('doc-1', 'Mathe', 'A'.repeat(100))
    expect(result.source).toBe('openrouter')
    expect(result.items[0].topic).toBe('Topic')
    expect(result.items[0].id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(result.items[0].documentId).toBe('doc-1')
    expect(result.error).toBeUndefined()
  })

  it('handles edge function errors gracefully', async () => {
    const { supabase } = await import('./supabaseClient')
    vi.mocked(supabase!.auth.getUser).mockResolvedValue(
      { data: { user: { id: 'user-1' } }, error: null } as unknown as GetUserResponse,
    )
    vi.mocked(supabase!.functions.invoke).mockResolvedValue({
      data: null,
      error: new Error('Rate limit exceeded: 429'),
    } as unknown as InvokeResponse)

    const result = await generateStudyItemsWithAi('doc-1', 'Mathe', 'A'.repeat(100))
    expect(result.source).toBe('heuristic-v1')
    expect(result.error).toBe('OpenRouter rate-limited')
  })
})
