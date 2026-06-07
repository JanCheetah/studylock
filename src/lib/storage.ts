export function safeParse<T>(key: string, fallback: T): T {
  try {
    const saved = localStorage.getItem(key)
    return saved ? (JSON.parse(saved) as T) : fallback
  } catch {
    return fallback
  }
}

export function saveJson<T>(key: string, value: T) {
  localStorage.setItem(key, JSON.stringify(value))
}

export const storageKeys = {
  documents: 'studylock-documents',
  activeDocument: 'studylock-active-document',
  examProfiles: 'studylock-exam-profiles',
  activeExamProfile: 'studylock-active-exam-profile',
  results: 'studylock-results',
} as const
