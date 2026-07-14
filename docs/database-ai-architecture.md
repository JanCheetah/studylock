# StudyLock Database and AI Architecture

StudyLock V2 is a local-first application. IndexedDB is always the local authority for application reads and writes; cloud configuration and authentication do not replace that repository.

## Local authority

The app uses the `studylock-v2` IndexedDB database through `V2StudyRepository` and `IndexedDbStudyRepository`. The repository is selected unconditionally by `getStudyRepository()`. This keeps onboarding, studying, scheduling, and session completion available offline and prevents login state from changing the source of truth underneath the UI.

Data is normalized into these stores:

- `meta`: schema and migration metadata
- `documents`: imported source documents
- `examProfiles`: exam goals and schedules
- `studyItems`: questions and scheduling state, indexed by document and due date
- `sessions`: completed study sessions
- `attempts`: individual answers/ratings, indexed by session and study item
- `outbox`: durable, ordered upload intents

Documents no longer embed the authoritative study-item collection in storage. The compatibility repository assembles normalized records into the legacy application snapshot shape at its boundary.

## One-time localStorage migration

On startup, StudyLock performs a guarded, one-time migration of legacy localStorage collections into IndexedDB. It validates source records, identifiers, references, and collisions before writing. The data and completion marker are committed transactionally; invalid or unavailable legacy data blocks the migration with a visible warning rather than silently marking it complete.

After successful migration, IndexedDB remains authoritative. localStorage is not an ongoing persistence fallback. A small legacy UI preference such as the active exam-profile selection may still exist outside the domain repository, but domain collections are hydrated from IndexedDB.

## Atomic session completion and outbox

Finishing a session is one IndexedDB transaction across `sessions`, `attempts`, `studyItems`, and `outbox`. The transaction records the result, attempts, updated spaced-repetition scheduling, and exactly one durable `session.finished` outbox event. A stable session UUID acts as the idempotency key, making an equivalent completion retry safe.

The outbox deliberately contains only synchronization metadata and the minimum scheduling payload. Raw document text and user answers remain in their local stores and are rejected at the outbox boundary. Pending events survive reloads and database reopen, and are ordered for a future processor.

## Supabase upload target

Supabase is an explicit upload target, not an alternate live repository. `syncLocalSnapshotToCloud()` requires both configured environment variables and an authenticated user, then copies the current local snapshot to `SupabaseStudyRepository`. Authentication never swaps `getStudyRepository()` away from IndexedDB.

To prepare the upload target:

1. Create a Supabase project.
2. Apply `supabase/migrations/001_studylock_core.sql`.
3. Copy `.env.example` to `.env.local` and set:

```bash
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
```

4. Sign in through the app before invoking cloud upload. Row-level security requires `auth.uid() = user_id`; unauthenticated writes are intentionally rejected.

## AI context

The cloud schema remains suitable for later AI/RAG workflows:

- `documents` hold extracted source material at the explicit upload target.
- `document_chunks` are intended as retrieval/generation units.
- `study_items` hold generated questions and review state.
- `study_sessions` and `study_attempts` provide learning history.
- `ai_generations` records model, prompt version, status, cost/debug metadata, and output summaries.

Local heuristic and configured AI generation can create study items without changing the persistence authority.

## Current limitations and future work

- The durable outbox exists, but its background transport/retry processor is not implemented yet. Explicit snapshot upload is the current cloud path.
- Local normalized document-chunk persistence and chunk upload/processing remain future work.
- Cloud upload is not bidirectional merge or multi-device conflict resolution.
- Supabase Auth and RLS are required for upload; offline/local study does not require either.
