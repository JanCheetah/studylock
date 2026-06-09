import { useStudyLock } from '../context/StudyLockContext'

export function AuthPanel() {
  const {
    authState,
    authEmail,
    setAuthEmail,
    handleMagicLinkSubmit,
    handleCloudSync,
    syncing,
    handleSignOut,
    authMessage,
    syncMessage,
  } = useStudyLock()

  if (!authState.configured) return null

  return (
    <div className="auth-card">
      <span>Cloud Account</span>
      <strong>{authState.label}</strong>
      <small>{authState.detail}</small>
      {!authState.authenticated ? (
        <div className="auth-form">
          <input
            type="email"
            value={authEmail}
            onChange={(event) => setAuthEmail(event.target.value)}
            placeholder="deine@mail.de"
          />
          <button className="secondary mini" onClick={handleMagicLinkSubmit}>
            Magic Link senden
          </button>
        </div>
      ) : (
        <div className="auth-form">
          <button className="secondary mini" onClick={handleCloudSync} disabled={syncing}>
            {syncing ? 'Sync läuft ...' : 'Lokale Daten in Cloud syncen'}
          </button>
          <button className="secondary mini" onClick={handleSignOut}>
            Logout
          </button>
        </div>
      )}
      {(authMessage || syncMessage) && <small className="status-line">{syncMessage || authMessage}</small>}
    </div>
  )
}
export default AuthPanel
