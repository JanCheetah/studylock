import { getStudyRepository } from './repositories'

export function persistRepositoryWrite(
  action: (repository: Awaited<ReturnType<typeof getStudyRepository>>) => Promise<void>
) {
  void getStudyRepository()
    .then(action)
    .catch((error: unknown) => console.warn('StudyLock persistence warning:', error))
}
