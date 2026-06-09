import { describe, expect, it, vi } from 'vitest'
import type { StudyItem } from '../../types'
import { SupabaseStudyRepository } from './supabaseStudyRepository'

function makeItem(overrides: Partial<StudyItem> = {}): StudyItem {
  return {
    id: 'item-1',
    documentId: 'doc-1',
    topic: 'Dualismus',
    question: 'Was ist Soll an Haben?',
    answer: 'Buchungssatz-Logik',
    source: 'Abschnitt 1',
    difficulty: 'mittel',
    type: 'karte',
    dueAt: '2026-06-09T12:00:00.000Z',
    intervalDays: 0,
    repetitions: 0,
    easeFactor: 2.5,
    ...overrides,
  }
}

describe('SupabaseStudyRepository', () => {
  it('persists each study item generation source instead of hardcoding heuristic fallback', async () => {
    const upsert = vi.fn().mockResolvedValue({ error: null })
    const fakeClient = {
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null }),
      },
      from: vi.fn(() => ({ upsert })),
    }
    const repository = new SupabaseStudyRepository(fakeClient as never)

    await repository.saveStudyItems('doc-1', [
      makeItem({ id: 'item-ai', generationSource: 'openrouter', aiGenerated: true }),
      makeItem({ id: 'item-local', generationSource: 'heuristic-v1' }),
    ])

    expect(fakeClient.from).toHaveBeenCalledWith('study_items')
    expect(upsert).toHaveBeenCalledOnce()
    expect(upsert).toHaveBeenCalledWith(expect.arrayContaining([
      expect.objectContaining({ id: 'item-ai', generation_source: 'openrouter' }),
      expect.objectContaining({ id: 'item-local', generation_source: 'heuristic-v1' }),
    ]))
  })
})
