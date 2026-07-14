# StudyLock V2 Vertical Slice Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Replace StudyLock's fragile localStorage/fire-and-forget persistence foundation with an offline-first IndexedDB architecture that atomically saves completed sessions and queues cloud synchronization without rewriting the working product UI.

**Architecture:** Introduce domain, application and infrastructure boundaries inside the existing repository. IndexedDB becomes the local source of truth; a durable outbox records sync work in the same transaction as domain changes. Existing React hooks temporarily consume a compatibility repository so the product remains usable while features migrate.

**Tech Stack:** React 19, TypeScript 6, Vite 8, native IndexedDB through `idb`, `fake-indexeddb` for Vitest, Supabase retained as the future remote adapter.

---

## Scope of this slice

This slice must prove:

1. Legacy localStorage data imports once into IndexedDB without data loss.
2. Documents, profiles, items, sessions and attempts survive reloads.
3. Finishing a session stores session + attempts + schedule updates + outbox entry atomically.
4. Failed cloud delivery never rolls back or deletes local learning data.
5. The existing StudyLock UI continues to work through a compatibility adapter.

It does not yet implement cloud conflict resolution, AI quota handling, a visual redesign or a complete readiness redesign.

### Task 1: Add V2 domain contracts and database schema

**Files:**
- Create: `src/domain/entities.ts`
- Create: `src/domain/ports.ts`
- Create: `src/infrastructure/indexeddb/schema.ts`
- Create: `src/infrastructure/indexeddb/database.ts`
- Create: `src/infrastructure/indexeddb/database.test.ts`
- Modify: `package.json`
- Modify: `package-lock.json`

**TDD:** First test database creation, required stores, schema version and UUID-shaped IDs. Verify RED before implementation.

**Required stores:** `meta`, `documents`, `examProfiles`, `studyItems`, `sessions`, `attempts`, `outbox`.

**Verification:**

```bash
npm run test -- src/infrastructure/indexeddb/database.test.ts
```

### Task 2: Import the legacy localStorage snapshot once

**Files:**
- Create: `src/infrastructure/indexeddb/legacyMigration.ts`
- Create: `src/infrastructure/indexeddb/legacyMigration.test.ts`
- Modify: `src/infrastructure/indexeddb/database.ts`

**Rules:**
- Never delete legacy keys during the first migration.
- Record migration completion in `meta` only after a successful transaction.
- Re-running migration is idempotent.
- Invalid JSON is reported as a warning result, not treated as authoritative emptiness.

**Verification:**

```bash
npm run test -- src/infrastructure/indexeddb/legacyMigration.test.ts
```

### Task 3: Implement the local V2 repository

**Files:**
- Create: `src/infrastructure/indexeddb/indexedDbStudyRepository.ts`
- Create: `src/infrastructure/indexeddb/indexedDbStudyRepository.test.ts`
- Modify: `src/domain/ports.ts`

**Rules:**
- IndexedDB is the local source of truth.
- Saves are idempotent by stable UUID.
- Documents and items are stored separately.
- Snapshot loading rejects transaction failures; it does not convert failures into empty data.

**Verification:** focused repository tests, then full unit suite.

### Task 4: Implement atomic session completion and durable outbox

**Files:**
- Create: `src/application/finishStudySession.ts`
- Create: `src/application/finishStudySession.test.ts`
- Create: `src/infrastructure/indexeddb/outbox.ts`
- Modify: `src/infrastructure/indexeddb/indexedDbStudyRepository.ts`
- Modify: `src/domain/ports.ts`

**Atomic transaction:**
- write/update study session;
- write attempts;
- update only attempted study items;
- append one `session.finished` outbox message.

**Rules:**
- Any failed write aborts all four changes.
- Retrying the same command is idempotent.
- Outbox payload contains IDs and scheduling data, not raw document text.

### Task 5: Integrate through a compatibility repository

**Files:**
- Create: `src/lib/repositories/v2StudyRepository.ts`
- Modify: `src/lib/repositories/index.ts`
- Modify: `src/lib/repositories/studyRepository.ts`
- Modify: `src/hooks/useSession.ts`
- Modify: `src/hooks/useDocuments.ts`
- Modify: `src/hooks/useExamProfile.ts`

**Rules:**
- Local unauthenticated mode selects V2 IndexedDB.
- First repository initialization runs legacy migration.
- Existing hook-facing types remain stable in this slice.
- `finishSession` uses the new atomic operation rather than separate fire-and-forget writes.
- Cloud/Supabase mode remains available but cannot overwrite IndexedDB merely because authentication changed.

### Task 6: Quality and smoke gate

**Files:**
- Modify tests/config only as required.
- Update: `docs/database-ai-architecture.md`

**Verification:**

```bash
npm run lint
npm run test
npm run build
npm run smoke
```

**Acceptance criteria:**
- Existing localStorage demo data appears after V2 startup.
- Reload retains documents and session history.
- Atomic-session test proves rollback.
- Outbox remains pending after simulated remote failure.
- Existing core browser study flow passes.
- No unrelated product features or visual redesign are included.
