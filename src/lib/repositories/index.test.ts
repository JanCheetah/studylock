import { describe, expect, it, vi } from 'vitest'

vi.mock('../supabaseClient', () => ({
  isSupabaseConfigured: true,
  supabase: { auth: { getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user' } } }) } },
}))

describe('repository selection', () => {
  it('keeps the singleton IndexedDB adapter authoritative when cloud auth exists', async () => {
    const repositories = await import('./index')
    const first = await repositories.getStudyRepository()
    const second = await repositories.getStudyRepository()
    expect(first).toBe(repositories.localStudyRepository)
    expect(second).toBe(first)
    expect(first.constructor.name).toBe('V2StudyRepository')
  })
})
