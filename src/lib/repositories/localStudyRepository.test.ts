import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SessionResult, StudyAttempt, StudyDocument, StudyItem } from '../../types'
import { storageKeys } from '../storage'
import { LocalStudyRepository } from './localStudyRepository'

const timestamp = '2026-07-14T12:00:00.000Z'

function makeItem(id: string, documentId: string, question: string): StudyItem {
  return {
    id,
    documentId,
    topic: 'Topic',
    question,
    answer: 'Answer',
    source: 'Source',
    difficulty: 'mittel',
    type: 'karte',
    dueAt: timestamp,
    intervalDays: 0,
    repetitions: 0,
    easeFactor: 2.5,
  }
}

function memoryStorage(): Storage {
  const values = new Map<string, string>()
  return {
    get length() { return values.size },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => { values.delete(key) },
    setItem: (key, value) => { values.set(key, value) },
  }
}

describe('LocalStudyRepository.completeSession', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', memoryStorage())
  })

  it('merges attempted items into each existing document without deleting unattempted items', async () => {
    const attemptedA = makeItem('item-a', 'doc-a', 'Attempted A')
    const untouchedA = makeItem('item-b', 'doc-a', 'Untouched A')
    const attemptedB = makeItem('item-c', 'doc-b', 'Attempted B')
    const untouchedB = makeItem('item-d', 'doc-b', 'Untouched B')
    const documents: StudyDocument[] = [
      { id: 'doc-a', title: 'A', subject: 'Math', text: 'A', createdAt: timestamp, updatedAt: timestamp, items: [attemptedA, untouchedA] },
      { id: 'doc-b', title: 'B', subject: 'Math', text: 'B', createdAt: timestamp, updatedAt: timestamp, items: [attemptedB, untouchedB] },
    ]
    localStorage.setItem(storageKeys.documents, JSON.stringify(documents))

    const result: SessionResult = { id: 'session-1', date: timestamp, subject: 'Math', documentTitle: 'A + B', mode: 'review', score: 80, minutes: 25, answered: 2, blockers: 0, readinessAfter: 50 }
    const attempts: StudyAttempt[] = [
      { id: 'attempt-a', sessionId: result.id, studyItemId: attemptedA.id, userAnswer: 'A', rating: 'good', createdAt: timestamp },
      { id: 'attempt-b', sessionId: result.id, studyItemId: attemptedB.id, userAnswer: 'B', rating: 'hard', createdAt: timestamp },
    ]
    const updatedItems = [
      { ...attemptedA, repetitions: 1, lastRating: 'good' as const },
      { ...attemptedB, repetitions: 1, lastRating: 'hard' as const },
    ]

    await new LocalStudyRepository().completeSession(result, attempts, updatedItems)

    const persistedDocuments = JSON.parse(localStorage.getItem(storageKeys.documents)!) as StudyDocument[]
    expect(persistedDocuments.find((document) => document.id === 'doc-a')?.items).toEqual([updatedItems[0], untouchedA])
    expect(persistedDocuments.find((document) => document.id === 'doc-b')?.items).toEqual([updatedItems[1], untouchedB])
    expect(JSON.parse(localStorage.getItem(storageKeys.results)!)).toEqual([result])
    expect(JSON.parse(localStorage.getItem(storageKeys.attempts)!)).toEqual(attempts)
  })
})
