import { describe, expect, it, vi } from 'vitest'
import type { SessionResult, StudyAttempt, StudyDocument, StudyItem } from '../types'
import { applyFinalRatingsToDocuments, commitCompletionCommand, createCompletionCommand, persistCompletedSession } from './useSession'

const item: StudyItem = { id: '10000000-0000-4000-8000-000000000003', documentId: '10000000-0000-4000-8000-000000000001', topic: 'T', question: 'Q', answer: 'A', source: 'S', difficulty: 'mittel', type: 'karte', dueAt: '2026-07-14T12:00:00.000Z', intervalDays: 0, repetitions: 0, easeFactor: 2.5 }
const document: StudyDocument = { id: item.documentId, title: 'Doc', subject: 'Math', text: 'Text', createdAt: item.dueAt, updatedAt: item.dueAt, items: [item] }

describe('session persistence boundary', () => {
  it('derives final scheduling once from the pre-completion document and final rating', () => {
    const schedule = vi.fn(() => ({ dueAt: '2026-07-15T12:00:00.000Z', intervalDays: 1, repetitions: 1, lastRating: 'good' as const, easeFactor: 2.6 }))
    const updated = applyFinalRatingsToDocuments([document], document.id, { [item.id]: 'good' }, schedule)

    expect(schedule).toHaveBeenCalledOnce()
    expect(schedule).toHaveBeenCalledWith(item, 'good')
    expect(updated[0].items[0]).toMatchObject({ lastRating: 'good', repetitions: 1 })
    expect(document.items[0].repetitions).toBe(0)
    expect(document.items[0].lastRating).toBeUndefined()
  })

  it('uses only the final rating and cannot compound intervals after re-rating', () => {
    const schedule = vi.fn((source: StudyItem, rating: 'again' | 'hard' | 'good') => ({
      dueAt: '2026-07-17T12:00:00.000Z', intervalDays: source.intervalDays + 3,
      repetitions: source.repetitions + 1, lastRating: rating, easeFactor: source.easeFactor + 0.1,
    }))

    const updated = applyFinalRatingsToDocuments([document], document.id, { [item.id]: 'good' }, schedule)

    expect(schedule).toHaveBeenCalledOnce()
    expect(updated[0].items[0].intervalDays).toBe(3)
    expect(updated[0].items[0].repetitions).toBe(1)
  })

  it('finishes with one completion call and exactly the attempted final items', async () => {
    const repository = { completeSession: vi.fn().mockResolvedValue(undefined) }
    const result = { id: '10000000-0000-4000-8000-000000000004' } as SessionResult
    const attempts = [{ id: '10000000-0000-4000-8000-000000000005', studyItemId: item.id }] as StudyAttempt[]
    const unrelated = { ...item, id: '10000000-0000-4000-8000-000000000006' }

    await persistCompletedSession(repository, result, attempts, [{ ...item, lastRating: 'good' }, unrelated])

    expect(repository.completeSession).toHaveBeenCalledOnce()
    expect(repository.completeSession).toHaveBeenCalledWith(result, attempts, [{ ...item, lastRating: 'good' }])
  })

  it('creates one stable completion command for retries with the same session and attempt IDs', () => {
    const command = createCompletionCommand({
      activeDocument: document,
      documents: [document],
      mode: 'recall',
      sessionScore: 100,
      sessionMinutes: 25,
      answeredCount: 1,
      blockerCount: 0,
      items: [item],
      answers: { [item.id]: 'answer' },
      ratings: { [item.id]: 'good' },
      elapsedSeconds: 30,
      finishedAt: '2026-07-14T13:00:00.000Z',
      sessionId: '10000000-0000-4000-8000-000000000004',
    })

    expect(command.result.id).toBe('10000000-0000-4000-8000-000000000004')
    expect(command.result.documentId).toBe(document.id)
    expect(command.attempts).toHaveLength(1)
    expect(command.attempts[0].sessionId).toBe(command.result.id)
    expect(command.finalDocuments[0].items[0]).toMatchObject({ lastRating: 'good', repetitions: 1 })
  })

  it('does not publish completion on failure and retries the identical command atomically', async () => {
    const command = createCompletionCommand({
      activeDocument: document, documents: [document], mode: 'recall', sessionScore: 100,
      sessionMinutes: 25, answeredCount: 1, blockerCount: 0, items: [item],
      answers: { [item.id]: 'answer' }, ratings: { [item.id]: 'good' }, elapsedSeconds: 30,
      finishedAt: '2026-07-14T13:00:00.000Z', sessionId: '10000000-0000-4000-8000-000000000004',
    })
    const error = new Error('disk full')
    const repository = { completeSession: vi.fn().mockRejectedValueOnce(error).mockResolvedValueOnce(undefined) }
    const publish = vi.fn()

    await expect(commitCompletionCommand(repository, command, publish)).rejects.toBe(error)
    expect(publish).not.toHaveBeenCalled()

    await commitCompletionCommand(repository, command, publish)
    expect(repository.completeSession).toHaveBeenCalledTimes(2)
    expect(repository.completeSession.mock.calls[0]).toEqual(repository.completeSession.mock.calls[1])
    expect(publish).toHaveBeenCalledOnce()
    expect(publish).toHaveBeenCalledWith(command)
  })
})
