import { useState, useCallback, useEffect } from 'react'
import type { RepositoryStatus, StudyDocument, ExamProfile, SessionResult } from '../types'
import { getAuthState, sendMagicLink, signOut, subscribeToAuthChanges, type AuthState } from '../lib/auth'
import { getRepositoryStatus, getStudyRepository, syncLocalSnapshotToCloud } from '../lib/repositories'

const defaultRepositoryStatus: RepositoryStatus = {
  mode: 'local',
  configured: true,
  authenticated: true,
  label: 'Lokaler Modus',
  detail: 'Daten liegen im Browser-localStorage. Supabase ist vorbereitet, aber noch nicht aktiv.',
}

const defaultAuthState: AuthState = {
  configured: false,
  authenticated: false,
  email: null,
  label: 'Cloud Login aus',
  detail: 'Ohne Supabase Env bleibt StudyLock lokal und friend-testbar.',
}

export function useCloudSync(
  setDocuments: React.Dispatch<React.SetStateAction<StudyDocument[]>>,
  setExamProfiles: React.Dispatch<React.SetStateAction<ExamProfile[]>>,
  setResults: React.Dispatch<React.SetStateAction<SessionResult[]>>
) {
  const [repositoryStatus, setRepositoryStatus] = useState<RepositoryStatus>(defaultRepositoryStatus)
  const [authState, setAuthState] = useState<AuthState>(defaultAuthState)
  const [authEmail, setAuthEmail] = useState('')
  const [authMessage, setAuthMessage] = useState('')
  const [syncMessage, setSyncMessage] = useState('')
  const [syncing, setSyncing] = useState(false)

  const refreshCloudState = useCallback(async () => {
    try {
      const [status, auth] = await Promise.all([getRepositoryStatus(), getAuthState()])
      setRepositoryStatus(status)
      setAuthState(auth)
      if (status.mode === 'supabase' && status.authenticated) {
        const snapshot = await getStudyRepository().then((repository) => repository.loadSnapshot())
        setDocuments(snapshot.documents)
        setExamProfiles(snapshot.examProfiles)
        setResults(snapshot.results)
      }
    } catch (error) {
      setRepositoryStatus(defaultRepositoryStatus)
      setAuthState(defaultAuthState)
      setAuthMessage(error instanceof Error ? error.message : 'Cloud Status konnte nicht geladen werden')
    }
  }, [setDocuments, setExamProfiles, setResults])

  useEffect(() => {
    void Promise.resolve().then(refreshCloudState)
    return subscribeToAuthChanges(() => {
      void refreshCloudState()
    })
  }, [refreshCloudState])

  const handleMagicLinkSubmit = async () => {
    setAuthMessage('Sende Magic Link ...')
    try {
      await sendMagicLink(authEmail)
      setAuthMessage('Magic Link gesendet. Mail öffnen, danach kommt StudyLock automatisch zurück.')
    } catch (error) {
      setAuthMessage(error instanceof Error ? error.message : 'Magic Link konnte nicht gesendet werden')
    }
  }

  const handleSignOut = async () => {
    setAuthMessage('Logge aus ...')
    try {
      await signOut()
      await refreshCloudState()
      setAuthMessage('Ausgeloggt. Neue Änderungen bleiben lokal, bis du wieder syncst.')
    } catch (error) {
      setAuthMessage(error instanceof Error ? error.message : 'Logout fehlgeschlagen')
    }
  }

  const handleCloudSync = async () => {
    setSyncing(true)
    setSyncMessage('Synchronisiere lokale Daten in Supabase ...')
    try {
      const counts = await syncLocalSnapshotToCloud()
      await refreshCloudState()
      setSyncMessage(`${counts.documents} Dokumente, ${counts.examProfiles} Klausurprofile und ${counts.results} Sessions in die Cloud gesynct.`)
    } catch (error) {
      setSyncMessage(error instanceof Error ? error.message : 'Cloud Sync fehlgeschlagen')
    } finally {
      setSyncing(false)
    }
  }

  return {
    repositoryStatus,
    authState,
    authEmail,
    setAuthEmail,
    authMessage,
    setAuthMessage,
    syncMessage,
    setSyncMessage,
    syncing,
    refreshCloudState,
    handleMagicLinkSubmit,
    handleSignOut,
    handleCloudSync,
  }
}
