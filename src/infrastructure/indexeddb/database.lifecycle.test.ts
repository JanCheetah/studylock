import { afterEach, describe, expect, it, vi, type Mock } from 'vitest'
import { openDB } from 'idb'
import {
  closeStudyLockDatabase,
  openStudyLockDatabase,
  type StudyLockDatabase,
} from './database'

vi.mock('idb', () => ({ openDB: vi.fn() }))

type Deferred<T> = {
  promise: Promise<T>
  resolve: (value: T) => void
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => {
    resolve = done
  })
  return { promise, resolve }
}

function fakeDatabase() {
  return {
    addEventListener: vi.fn(),
    close: vi.fn(),
    createObjectStore: vi.fn(),
  } as unknown as StudyLockDatabase
}

type DatabaseCallbacks = {
  terminated?: () => void
  upgrade?: (
    database: StudyLockDatabase,
    oldVersion: number,
    newVersion: number | null,
    transaction: never,
    event: never,
  ) => void
}

const openDBMock = openDB as unknown as Mock<
  (
    name: string,
    version: number,
    callbacks?: DatabaseCallbacks,
  ) => Promise<StudyLockDatabase>
>

afterEach(() => {
  closeStudyLockDatabase()
  vi.clearAllMocks()
})

describe('StudyLock IndexedDB connection lifecycle', () => {
  it('closes a late connection and keeps a reopen made after close active', async () => {
    const firstOpen = deferred<StudyLockDatabase>()
    const secondOpen = deferred<StudyLockDatabase>()
    const lateDatabase = fakeDatabase()
    const reopenedDatabase = fakeDatabase()
    openDBMock
      .mockReturnValueOnce(firstOpen.promise)
      .mockReturnValueOnce(secondOpen.promise)

    const staleResult = openStudyLockDatabase()
    closeStudyLockDatabase()
    const reopenedResult = openStudyLockDatabase()

    firstOpen.resolve(lateDatabase)
    await staleResult
    secondOpen.resolve(reopenedDatabase)
    await expect(reopenedResult).resolves.toBe(reopenedDatabase)

    expect(lateDatabase.close).toHaveBeenCalledOnce()
    await expect(openStudyLockDatabase()).resolves.toBe(reopenedDatabase)
    expect(openDBMock).toHaveBeenCalledTimes(2)
  })

  it('clears the active connection when IndexedDB terminates it', async () => {
    const terminatedDatabase = fakeDatabase()
    const replacementDatabase = fakeDatabase()
    openDBMock
      .mockResolvedValueOnce(terminatedDatabase)
      .mockResolvedValueOnce(replacementDatabase)

    await openStudyLockDatabase()
    const callbacks = openDBMock.mock.calls[0]?.[2]
    callbacks?.terminated?.()

    await expect(openStudyLockDatabase()).resolves.toBe(replacementDatabase)
    expect(openDBMock).toHaveBeenCalledTimes(2)
  })
})

describe('StudyLock IndexedDB upgrades', () => {
  it('does not recreate version-1 stores during a later-version upgrade', async () => {
    const database = fakeDatabase()
    openDBMock.mockResolvedValueOnce(database)

    await openStudyLockDatabase()
    const callbacks = openDBMock.mock.calls[0]?.[2]
    callbacks?.upgrade?.(database, 1, 2, {} as never, {} as never)

    expect(database.createObjectStore).not.toHaveBeenCalled()
  })
})
