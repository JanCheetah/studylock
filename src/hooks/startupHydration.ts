import { useCallback, useEffect, useReducer, useRef, useState } from 'react'
import type { ExamProfile, SessionResult, StudyDocument } from '../types'
import { getStudyRepository } from '../lib/repositories'

type Snapshot = { documents: StudyDocument[]; examProfiles: ExamProfile[]; results: SessionResult[] }
type SnapshotReader = { loadSnapshot(): Promise<Snapshot> }
type HydrationTargets = {
  setDocuments(value: StudyDocument[]): void
  setExamProfiles(value: ExamProfile[]): void
  setResults(value: SessionResult[]): void
}

type StartupHydrationState = {
  status: 'pending' | 'success' | 'error'
  requestId: number
  error: string
}

type StartupHydrationAction =
  | { type: 'started'; requestId: number }
  | { type: 'succeeded'; requestId: number }
  | { type: 'failed'; requestId: number; error: string }

export const initialStartupHydrationState: StartupHydrationState = {
  status: 'pending',
  requestId: 0,
  error: '',
}

export function startupHydrationReducer(
  state: StartupHydrationState,
  action: StartupHydrationAction,
): StartupHydrationState {
  if (action.type === 'started') return { status: 'pending', requestId: action.requestId, error: '' }
  if (action.requestId !== state.requestId) return state
  if (action.type === 'succeeded') return { ...state, status: 'success', error: '' }
  return { ...state, status: 'error', error: action.error }
}

function applySnapshot(snapshot: Snapshot, targets: HydrationTargets) {
  targets.setDocuments(snapshot.documents)
  targets.setExamProfiles(snapshot.examProfiles)
  targets.setResults(snapshot.results)
}

export async function hydrateStudyState(
  repository: SnapshotReader,
  targets: HydrationTargets,
  reportError: (error: unknown) => void = (error) => console.error('StudyLock startup hydration failed:', error),
): Promise<void> {
  try {
    applySnapshot(await repository.loadSnapshot(), targets)
  } catch (error) {
    reportError(error)
    throw error
  }
}

export function useStartupHydration(targets: HydrationTargets) {
  const [state, dispatch] = useReducer(startupHydrationReducer, initialStartupHydrationState)
  const [retryKey, setRetryKey] = useState(0)
  const latestRequestId = useRef(0)
  const { setDocuments, setExamProfiles, setResults } = targets

  const retryHydration = useCallback(() => setRetryKey((key) => key + 1), [])

  useEffect(() => {
    const requestId = ++latestRequestId.current
    let active = true
    dispatch({ type: 'started', requestId })

    void getStudyRepository()
      .then((repository) => repository.loadSnapshot())
      .then((snapshot) => {
        if (!active || requestId !== latestRequestId.current) return
        applySnapshot(snapshot, { setDocuments, setExamProfiles, setResults })
        dispatch({ type: 'succeeded', requestId })
      })
      .catch((error: unknown) => {
        if (!active || requestId !== latestRequestId.current) return
        console.error('StudyLock startup hydration failed:', error)
        dispatch({
          type: 'failed',
          requestId,
          error: error instanceof Error ? error.message : 'Lokale Daten konnten nicht geladen werden',
        })
      })

    return () => { active = false }
  }, [retryKey, setDocuments, setExamProfiles, setResults])

  return {
    hydrated: state.status === 'success',
    isHydrating: state.status === 'pending',
    hydrationError: state.error,
    retryHydration,
  }
}
