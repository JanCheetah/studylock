import { describe, expect, it } from 'vitest'
import documentsSource from './useDocuments.ts?raw'
import examProfileSource from './useExamProfile.ts?raw'
import sessionSource from './useSession.ts?raw'

const sources = {
  useDocuments: documentsSource,
  useExamProfile: examProfileSource,
  useSession: sessionSource,
}

describe('IndexedDB domain collection authority', () => {
  it.each([
    ['useDocuments', 'documents'],
    ['useExamProfile', 'examProfiles'],
    ['useSession', 'results'],
  ] as const)('%s does not initialize or mirror %s through localStorage', (hook, collectionKey) => {
    const source = sources[hook]

    expect(source).not.toContain(`safeParse(storageKeys.${collectionKey}`)
    expect(source).not.toContain(`saveJson(storageKeys.${collectionKey}`)
  })

  it('keeps the active document ID as a small localStorage preference', () => {
    expect(documentsSource).toContain('safeParse<string | null>(storageKeys.activeDocument, null)')
    expect(documentsSource).toContain('saveJson(storageKeys.activeDocument, activeDocumentId)')
  })
})
