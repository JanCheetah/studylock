import type { ReactNode } from 'react'

type StartupHydrationBarrierProps = {
  hydrated: boolean
  isHydrating: boolean
  hydrationError: string
  retryHydration(): void
  children: ReactNode
}

/** Prevents any writable application UI from mounting before local state is authoritative. */
export function StartupHydrationBarrier({
  hydrated,
  isHydrating,
  hydrationError,
  retryHydration,
  children,
}: StartupHydrationBarrierProps) {
  if (hydrated) return children

  if (isHydrating) {
    return (
      <main className="app-shell" aria-busy="true">
        <section className="panel flow" role="status">
          <h1>Lokale Lerndaten werden geladen …</h1>
          <p>StudyLock wartet, bis deine gespeicherten Daten vollständig verfügbar sind.</p>
        </section>
      </main>
    )
  }

  return (
    <main className="app-shell">
      <section className="panel flow" role="alert" aria-live="assertive">
        <h1>Lokale Daten konnten nicht geladen werden</h1>
        <p>StudyLock bleibt gesperrt, damit keine vorhandenen Lerndaten überschrieben werden.</p>
        {hydrationError && <p className="nudge">Technischer Hinweis: {hydrationError}</p>}
        <button type="button" onClick={retryHydration}>Erneut versuchen</button>
      </section>
    </main>
  )
}
