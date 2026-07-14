import { describe, expect, it, vi } from 'vitest'
import type { AppStateSnapshot } from '../types'
import { hydrateStudyState, startupHydrationReducer, initialStartupHydrationState } from './startupHydration'

const snapshot: AppStateSnapshot = { documents: [], examProfiles: [], results: [], attempts: [] }

describe('startup hydration', () => {
  it('hydrates all authoritative React collections from the repository snapshot', async () => {
    const repository = { loadSnapshot: vi.fn().mockResolvedValue(snapshot) }
    const targets = { setDocuments: vi.fn(), setExamProfiles: vi.fn(), setResults: vi.fn() }

    await hydrateStudyState(repository, targets)

    expect(targets.setDocuments).toHaveBeenCalledWith(snapshot.documents)
    expect(targets.setExamProfiles).toHaveBeenCalledWith(snapshot.examProfiles)
    expect(targets.setResults).toHaveBeenCalledWith(snapshot.results)
  })

  it('reports and rethrows startup failures instead of treating them as empty data', async () => {
    const error = new Error('IndexedDB unavailable')
    const reportError = vi.fn()
    const targets = { setDocuments: vi.fn(), setExamProfiles: vi.fn(), setResults: vi.fn() }

    await expect(hydrateStudyState({ loadSnapshot: vi.fn().mockRejectedValue(error) }, targets, reportError)).rejects.toBe(error)
    expect(reportError).toHaveBeenCalledWith(error)
    expect(targets.setDocuments).not.toHaveBeenCalled()
  })

  it('tracks pending, failure, and successful retry states', () => {
    const pending = startupHydrationReducer(initialStartupHydrationState, { type: 'started', requestId: 1 })
    const failed = startupHydrationReducer(pending, { type: 'failed', requestId: 1, error: 'IndexedDB ist blockiert' })
    const retrying = startupHydrationReducer(failed, { type: 'started', requestId: 2 })
    const succeeded = startupHydrationReducer(retrying, { type: 'succeeded', requestId: 2 })

    expect(pending).toMatchObject({ status: 'pending', requestId: 1, error: '' })
    expect(failed).toMatchObject({ status: 'error', error: 'IndexedDB ist blockiert' })
    expect(retrying).toMatchObject({ status: 'pending', requestId: 2, error: '' })
    expect(succeeded).toMatchObject({ status: 'success', requestId: 2, error: '' })
  })

  it('ignores stale success and failure responses from an older request', () => {
    const current = { status: 'pending' as const, requestId: 2, error: '' }

    expect(startupHydrationReducer(current, { type: 'succeeded', requestId: 1 })).toBe(current)
    expect(startupHydrationReducer(current, { type: 'failed', requestId: 1, error: 'stale' })).toBe(current)
  })
})
