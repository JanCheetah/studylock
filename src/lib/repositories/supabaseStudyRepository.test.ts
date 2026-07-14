import { describe, expect, it, vi } from 'vitest'
import type { AppStateSnapshot, SessionResult, StudyAttempt, StudyItem } from '../../types'
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
  it('writes and reads the spaced-repetition ease factor', async () => {
    const upsert = vi.fn().mockResolvedValue({ error: null })
    const fakeClient = {
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null }),
      },
      from: vi.fn(() => ({ upsert })),
    }
    const repository = new SupabaseStudyRepository(fakeClient as never)

    await repository.saveStudyItems('doc-1', [makeItem({ easeFactor: 1.85 })])

    expect(upsert).toHaveBeenCalledWith([
      expect.objectContaining({ id: 'item-1', ease_factor: 1.85 }),
    ])
  })

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

  it('records AI generation audit rows with status, model, prompt version, and item count', async () => {
    const insert = vi.fn().mockResolvedValue({ error: null })
    const fakeClient = {
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null }),
      },
      from: vi.fn(() => ({ insert })),
    }
    const repository = new SupabaseStudyRepository(fakeClient as never)

    await repository.recordAiGeneration({
      documentId: 'doc-1',
      status: 'succeeded',
      provider: 'openrouter',
      model: 'openrouter/horizon-alpha',
      promptVersion: 'study-items-v1',
      inputHash: 'hash-1',
      itemsCount: 7,
    })

    expect(fakeClient.from).toHaveBeenCalledWith('ai_generations')
    expect(insert).toHaveBeenCalledWith(expect.objectContaining({
      user_id: 'user-1',
      document_id: 'doc-1',
      status: 'succeeded',
      model: 'openrouter/horizon-alpha',
      prompt_version: 'study-items-v1',
      input_hash: 'hash-1',
      output: { provider: 'openrouter', items_count: 7 },
      error_message: null,
    }))
  })

  it('upserts repeated snapshot attempts by id and preserves session history', async () => {
    const upsert = vi.fn().mockResolvedValue({ error: null })
    const fakeClient = {
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null }),
      },
      from: vi.fn(() => ({ upsert })),
    }
    const repository = new SupabaseStudyRepository(fakeClient as never)
    const finishedAt = '2026-06-09T12:34:56.000Z'
    const result: SessionResult = {
      id: 'session-1',
      date: finishedAt,
      documentId: 'doc-1',
      subject: 'BWL',
      documentTitle: 'Buchführung',
      mode: 'recall',
      score: 100,
      minutes: 25,
      answered: 1,
      blockers: 0,
      readinessAfter: 88,
    }
    const attempt: StudyAttempt = {
      id: 'attempt-1',
      sessionId: 'session-1',
      studyItemId: 'item-1',
      userAnswer: 'Eigene Antwort',
      rating: 'good',
      selfScore: 100,
      timeSpentSeconds: 45,
      createdAt: finishedAt,
    }
    const snapshot: AppStateSnapshot = {
      documents: [],
      examProfiles: [],
      results: [result],
      attempts: [attempt],
    }

    await repository.saveSnapshot(snapshot)
    await repository.saveSnapshot(snapshot)

    const sessionCalls = upsert.mock.calls.filter(([payload]) => !Array.isArray(payload))
    expect(sessionCalls).toHaveLength(2)
    expect(sessionCalls[0][0]).toEqual(expect.objectContaining({
      id: 'session-1',
      document_id: 'doc-1',
      finished_at: finishedAt,
    }))
    const attemptCalls = upsert.mock.calls.filter(([payload]) => Array.isArray(payload))
    expect(attemptCalls).toHaveLength(2)
    for (const call of attemptCalls) expect(call[1]).toEqual({ onConflict: 'id' })
    expect(attemptCalls[0][0]).toEqual([
      expect.objectContaining({
        id: 'attempt-1',
        user_id: 'user-1',
        session_id: 'session-1',
        study_item_id: 'item-1',
        user_answer: 'Eigene Antwort',
        rating: 'good',
        self_score: 100,
        time_spent_seconds: 45,
        created_at: finishedAt,
      }),
    ])
  })

  it('maps cloud document, timestamp, and ease factor back without changing them', async () => {
    const finishedAt = '2026-06-09T12:34:56.000Z'
    const rowsByTable: Record<string, unknown[]> = {
      documents: [{
        id: 'doc-1', title: 'Buchführung', subject: 'BWL', source_type: 'paste', raw_text: 'Text',
        exam_profile_id: null, created_at: finishedAt, updated_at: finishedAt,
      }],
      exam_profiles: [],
      study_items: [{
        id: 'item-1', document_id: 'doc-1', topic: 'Dualismus', question: 'Frage', answer: 'Antwort',
        source: 'Abschnitt 1', type: 'karte', difficulty: 'mittel', due_at: finishedAt,
        interval_days: 4, repetitions: 2, last_rating: 'good', generation_source: 'heuristic-v1',
        ease_factor: 1.85,
      }],
      study_sessions: [{
        id: 'session-1', document_id: 'doc-1', mode: 'recall', finished_at: finishedAt,
        minutes: 25, score: 80, answered: 1, blocker_count: 0, readiness_after: 70,
      }],
      study_attempts: [],
    }
    const fakeClient = {
      auth: {
        getUser: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } }, error: null }),
      },
      from: vi.fn((table: string) => {
        const query = {
          select: vi.fn(() => query),
          eq: vi.fn(() => query),
          order: vi.fn(() => query),
          limit: vi.fn(() => query),
          then: (resolve: (value: { data: unknown[]; error: null }) => unknown) =>
            Promise.resolve(resolve({ data: rowsByTable[table], error: null })),
        }
        return query
      }),
    }

    const snapshot = await new SupabaseStudyRepository(fakeClient as never).loadSnapshot()

    expect(snapshot.documents[0].items[0].easeFactor).toBe(1.85)
    expect(snapshot.results[0]).toEqual(expect.objectContaining({
      date: finishedAt,
      documentId: 'doc-1',
    }))
  })
})
