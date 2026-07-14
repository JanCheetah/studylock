import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'
import { StartupHydrationBarrier } from './components/StartupHydrationBarrier'

describe('StartupHydrationBarrier', () => {
  it('blocks mutation-capable children while hydration is pending', () => {
    const html = renderToStaticMarkup(
      <StartupHydrationBarrier hydrated={false} isHydrating hydrationError="" retryHydration={vi.fn()}>
        <button>Dokument löschen</button>
      </StartupHydrationBarrier>,
    )

    expect(html).toContain('Lokale Lerndaten werden geladen')
    expect(html).not.toContain('Dokument löschen')
  })

  it('shows a blocking German failure with retry instead of app children', () => {
    const html = renderToStaticMarkup(
      <StartupHydrationBarrier hydrated={false} isHydrating={false} hydrationError="IndexedDB unavailable" retryHydration={vi.fn()}>
        <button>Dokument importieren</button>
      </StartupHydrationBarrier>,
    )

    expect(html).toContain('Lokale Daten konnten nicht geladen werden')
    expect(html).toContain('Erneut versuchen')
    expect(html).toContain('IndexedDB unavailable')
    expect(html).not.toContain('Dokument importieren')
  })

  it('renders the app only after successful hydration', () => {
    const html = renderToStaticMarkup(
      <StartupHydrationBarrier hydrated isHydrating={false} hydrationError="" retryHydration={vi.fn()}>
        <button>App bereit</button>
      </StartupHydrationBarrier>,
    )
    expect(html).toContain('App bereit')
  })
})
