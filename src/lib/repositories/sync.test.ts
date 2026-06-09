import { describe, expect, it, vi } from 'vitest'
import type { AppStateSnapshot } from '../../types'
import type { StudyRepository } from './studyRepository'
import { countSnapshot, syncSnapshotToRepository } from './sync'

const snapshot: AppStateSnapshot = {
  documents: [
    {
      id: 'doc-1',
      title: 'OR Skript',
      subject: 'Operations Research',
      sourceType: 'paste',
      text: 'Lineare Optimierung',
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      items: [],
    },
  ],
  examProfiles: [
    {
      id: 'exam-1',
      subject: 'Operations Research',
      examDate: '2026-07-01',
      dailyMinutes: 25,
      goal: 'gut',
      confidence: 2,
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
  ],
  results: [
    {
      id: 'session-1',
      date: '01.01.26, 10:00',
      subject: 'Operations Research',
      documentTitle: 'OR Skript',
      mode: 'recall',
      score: 70,
      minutes: 25,
      answered: 4,
      blockers: 1,
      readinessAfter: 62,
    },
  ],
}

function fakeRepo(overrides: Partial<StudyRepository>): StudyRepository {
  return {
    status: vi.fn(),
    loadSnapshot: vi.fn(),
    saveDocument: vi.fn(),
    deleteDocument: vi.fn(),
    saveExamProfile: vi.fn(),
    saveStudyItems: vi.fn(),
    saveSession: vi.fn(),
    saveStudyAttempts: vi.fn(),
    saveDocumentChunks: vi.fn(),
    recordAiGeneration: vi.fn(),
    saveSnapshot: vi.fn(),
    ...overrides,
  } as StudyRepository
}

describe('local-to-cloud sync', () => {
  it('counts snapshot records for a user-facing sync result', () => {
    expect(countSnapshot(snapshot)).toEqual({ documents: 1, examProfiles: 1, results: 1 })
  })

  it('copies the local snapshot to the authenticated cloud repository', async () => {
    const source = fakeRepo({ loadSnapshot: vi.fn().mockResolvedValue(snapshot) })
    const target = fakeRepo({ saveSnapshot: vi.fn().mockResolvedValue(undefined) })

    const result = await syncSnapshotToRepository(source, target)

    expect(source.loadSnapshot).toHaveBeenCalledOnce()
    expect(target.saveSnapshot).toHaveBeenCalledWith(snapshot)
    expect(result).toEqual({ documents: 1, examProfiles: 1, results: 1 })
  })
})
