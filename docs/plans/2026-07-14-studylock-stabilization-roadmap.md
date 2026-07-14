# StudyLock Stabilization & Product Roadmap Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task. Do not start Phase 2 before every Phase-1 exit criterion is green.

**Goal:** Turn StudyLock from a convincing local demo into a trustworthy, mobile-friendly Klausurcoach whose local and cloud data cannot silently disappear and whose daily study loop is measurably useful.

**Architecture:** Preserve the current React/Vite local-first product, but separate local state from remote snapshots, introduce explicit sync/conflict handling, and move multi-row cloud mutations behind transactional Supabase RPCs. Keep AI optional: the daily plan and study session must work deterministically without OpenRouter, while AI output is runtime-validated and source-linked.

**Tech Stack:** React 19, TypeScript 6, Vite 8, Supabase Auth/Postgres/Edge Functions, Vitest, Playwright, plain responsive CSS.

---

## 1. Current-state review (2026-07-14)

### What is already good

- The product has the right wedge: exam deadline + daily command + active recall, not a generic notes app.
- Local import, exam profile, session selection, ratings, readiness, weak-topic display, exports, Supabase adapters, AI fallback and audit objects exist.
- The prior AI/persistence plan is largely implemented.
- Unit tests currently pass: **32/32**.
- TypeScript/Vite build currently passes.
- The code is reasonably decomposed into context, hooks, pure study logic and repositories.

### Release blockers

1. **Login can erase local state.** `src/hooks/useCloudSync.ts:34-44` treats the first remote snapshot as authoritative. A new account with an empty cloud can replace populated local state and persist that emptiness back into localStorage.
2. **Generated study-item IDs violate the database schema.** `src/lib/studyEngine.ts:75-110` and the AI paths create suffixed IDs such as `<uuid>-0-recall`, while `public.study_items.id` is `uuid`.
3. **Cloud failures are silent.** `src/lib/persist.ts` catches writes and only logs a warning; the UI can report success while Supabase rejected data.
4. **Snapshot sync is not safely repeatable.** Attempts use `insert`, sync is multi-step without a transaction, and partial failures can leave an unknown cloud state.

### High-priority gaps

- `easeFactor` is used by scheduling but missing from the DB schema/mapping.
- Supabase snapshot reads ignore query errors and can turn failures into empty arrays.
- Rating writes upsert the whole document item set asynchronously, allowing stale writes to win.
- Session rows omit durable document/profile linkage and actual elapsed duration.
- The Edge Function has no repository-verifiable JWT/quota/rate-limit configuration.
- A central operator OpenRouter key could be exposed if placed in `VITE_OPENROUTER_API_KEY`.
- `npm run lint` fails with 18 errors.
- `npm run smoke` cannot start because `@playwright/test` is absent; config also uses Windows-only `npm.cmd`.
- Visible German text in `src/App.tsx` contains mojibake (`t├ñglicher`, `Pr├╝fung`, broken emoji).
- The current readiness percentage starts untested material at 15% and relies mostly on self-ratings; it must be labeled as an estimate until calibrated.

### Product/UX diagnosis

- The dashboard contains useful information, but first-time and returning-user actions compete with auth, AI settings, exports, multiple modes and the command center.
- The strongest product loop should be: **open → see exactly one task → complete 10–25 minute session → see what changed → know tomorrow's task**.
- AI provenance exists in data, but the learner still needs visible source evidence and an easy “question is wrong” action to trust generated items.
- Streaks can help, but should never punish missed days. The main motivational signal should be “today done” and an honest coverage/retention estimate.
- The app should be optimized for phone use before adding social features, payments, knowledge graphs or chat.

---

## 2. Roadmap overview

### Phase 1 — Trustworthy local/cloud foundation (P0, 2–4 focused days)

**Outcome:** No silent loss, valid IDs, repeatable sync, visible persistence state.

- Fix entity IDs and add schema-level integration coverage.
- Stop automatic cloud overwrite; add explicit first-sync decision.
- Check every Supabase read error.
- Replace fire-and-forget success with visible pending/synced/failed state.
- Make snapshot upload idempotent.
- Repair lint and offline smoke test.

**Exit gate:** Local data survives first login; two consecutive syncs yield the same cloud state; simulated cloud failures preserve local data and display a retry action; lint/test/build/smoke are green.

### Phase 2 — Atomic learning history and reliable scheduling (P1, 3–5 focused days)

**Outcome:** One completed answer produces one durable attempt and one correct schedule update across reloads/devices.

- Add immutable follow-up migration(s), never rewrite `001` for deployed environments.
- Persist `ease_factor`, actual session timing and document/profile links.
- Add transactional `finish_study_session` RPC.
- Remove full-document rating upserts and stale-write races.
- Add two-user RLS and transaction tests.

**Exit gate:** Completing a session either persists session + attempts + schedules completely or persists none; a reload retains the same due dates/ease factors/readiness inputs.

### Phase 3 — Focused friend-test UX (P1, 3–5 focused days)

**Outcome:** A student can reach the first useful question in under 90 seconds and complete daily study on a phone without dashboard confusion.

- Fix copy/encoding and reduce first-run choices.
- Make “Heute lernen” the single primary action.
- Collapse advanced cloud/AI/export settings.
- Add mobile session ergonomics, resume/exit safety and a clear session-end next action.
- Show sync confidence without technical jargon.

**Exit gate:** 5 manual friend-test runs; median time from opening the app to first typed answer < 90 seconds; no horizontal overflow at 360 px; no accidental answer/session loss.

### Phase 4 — Learning quality and AI trust (P2, 5–8 focused days)

**Outcome:** Readiness becomes explainable, generated questions are traceable, and weak-topic selection reflects real attempts rather than completion theater.

- Replace lossy 16-chunk pipeline with complete deterministic chunking and source metadata.
- Runtime-validate AI output.
- Add question feedback and source display.
- Split readiness into coverage, recent retrieval and retention; label it as an estimate.
- Improve exam mode scoring and per-item timing.

**Exit gate:** Every generated item links to source text/chunk; malformed AI responses cannot enter storage; readiness details explain why the score changed.

### Phase 5 — Beta hardening (Later, 3–5 focused days)

**Outcome:** A small private beta can run with bounded cost and observable failures.

- Explicit Edge Function JWT verification, payload limits, per-user quota/rate limiting.
- Remove operator-key browser path; optional BYOK is clearly isolated and opt-in.
- CI quality gate, error telemetry without study-text leakage, backup/export/import.
- Stable deployment and a repeatable two-account acceptance run.

**Not in this roadmap:** payments, social study groups, chat tutor, native app, OCR, knowledge graph, gamified leagues. Add only after friend-test retention proves the daily loop.

---

## 3. Detailed implementation plan

## Phase 1 — Trustworthy foundation

### Task 1: Lock in failing regression tests for UUID compatibility

**Objective:** Prove that every locally/AI-generated persistent entity ID is a valid UUID before fixing generation.

**Files:**
- Modify: `src/lib/studyEngine.test.ts`
- Modify: `src/lib/ai.test.ts`
- Modify: `src/lib/repositories/supabaseStudyRepository.test.ts`
- Inspect: `src/lib/aiStudyEngine.ts`
- Inspect: `supabase/functions/generate-study-items/index.ts`

**Steps:**
1. Add a UUID regex/helper only in tests.
2. Assert all IDs returned by `buildItems()` are valid UUIDs and unique.
3. Assert mapped AI study items have valid UUIDs and unique IDs.
4. Assert document, profile, session and attempt IDs remain valid UUIDs.
5. Run the tests and confirm the new item-ID assertions fail against the current implementation.

**Verification:**

```bash
npm run test -- src/lib/studyEngine.test.ts src/lib/ai.test.ts
```

Expected before fix: FAIL on generated study-item IDs.

**Commit:** `test: cover persistent entity uuid compatibility`

---

### Task 2: Generate real UUIDs for every study item

**Objective:** Make generated items writable to `public.study_items.id uuid` without weakening the schema.

**Files:**
- Modify: `src/lib/studyEngine.ts:66-125`
- Modify: `src/lib/aiStudyEngine.ts`
- Modify: `supabase/functions/generate-study-items/index.ts`
- Modify tests from Task 1

**Steps:**
1. Replace suffix-based item IDs with `id('item')`/`crypto.randomUUID()`.
2. Do not derive identity from array index; keep `documentId`, `source` and chunk reference as separate fields.
3. Ensure fallback and AI paths use the same UUID rule.
4. Run focused tests, then the full suite and build.

**Verification:**

```bash
npm run test
npm run build
```

Expected: all UUID assertions and existing tests pass.

**Commit:** `fix: use database-compatible study item ids`

---

### Task 3: Prevent destructive login hydration

**Objective:** Keep local state intact when a user authenticates and make local/cloud choice explicit.

**Files:**
- Modify: `src/hooks/useCloudSync.ts`
- Modify: `src/components/AuthPanel.tsx`
- Modify: `src/context/StudyLockContext.tsx`
- Create: `src/lib/repositories/merge.ts`
- Create: `src/lib/repositories/merge.test.ts`
- Test: add a hook/component test if the current test setup supports React rendering; otherwise extract the decision logic as a pure function.

**Steps:**
1. Replace direct `setDocuments/setExamProfiles/setResults` during auth refresh with separate `remoteSnapshot` state.
2. Compare local and remote snapshots using IDs and `updatedAt`.
3. Present explicit first-sync choices:
   - `Lokale Daten hochladen` when cloud is empty.
   - `Cloud-Daten auf diesem Gerät verwenden` only after showing counts and creating a local backup.
   - `Zusammenführen` when both sides contain data.
4. Default to preserving local data; never treat a failed load as an empty authoritative snapshot.
5. Store a timestamped local backup key before any replacement.
6. Test: populated local + empty cloud + login leaves local state unchanged.
7. Test: failed remote read leaves local state unchanged.

**Verification:**

```bash
npm run test -- src/lib/repositories/merge.test.ts
npm run test
npm run build
```

**Acceptance:** Login alone changes no study data.

**Commit:** `fix: preserve local data during cloud authentication`

---

### Task 4: Fail closed on Supabase snapshot reads

**Objective:** Distinguish “zero records” from “query failed.”

**Files:**
- Modify: `src/lib/repositories/supabaseStudyRepository.ts:83-114`
- Modify: `src/lib/repositories/supabaseStudyRepository.test.ts`

**Steps:**
1. Capture `data` and `error` for each query.
2. If any query fails, throw a typed snapshot error containing the table name but no private row data.
3. Only map/publish a snapshot after all reads succeed.
4. Add tests for an error from each query group and one legitimate empty snapshot.

**Verification:**

```bash
npm run test -- src/lib/repositories/supabaseStudyRepository.test.ts
```

Expected: query failure rejects; real empty data resolves to empty arrays.

**Commit:** `fix: reject incomplete cloud snapshots`

---

### Task 5: Make snapshot upload idempotent

**Objective:** Allow a user to press sync repeatedly without duplicate-attempt failures.

**Files:**
- Modify: `src/lib/repositories/supabaseStudyRepository.ts:196-256`
- Modify: `src/lib/repositories/sync.ts`
- Modify: `src/lib/repositories/sync.test.ts`
- Modify: `src/lib/repositories/supabaseStudyRepository.test.ts`

**Steps:**
1. Change attempt persistence from plain `insert` to `upsert` on stable attempt IDs.
2. Validate that every attempt references a session included in cloud or in the upload batch.
3. Return structured sync counts plus warnings instead of a single success assumption.
4. Add a test that uploads the same snapshot twice and observes no duplicate logical rows.
5. Add a partial-failure test; local state must remain untouched and the UI must report which stage failed.

**Verification:**

```bash
npm run test -- src/lib/repositories/sync.test.ts src/lib/repositories/supabaseStudyRepository.test.ts
```

**Commit:** `fix: make local to cloud sync repeatable`

---

### Task 6: Introduce visible persistence status and retry

**Objective:** Stop telling the user that cloud writes succeeded when they only changed React/local state.

**Files:**
- Replace or refactor: `src/lib/persist.ts`
- Create: `src/lib/writeQueue.ts`
- Create: `src/lib/writeQueue.test.ts`
- Modify: `src/context/StudyLockContext.tsx`
- Modify: `src/hooks/useDocuments.ts`
- Modify: `src/hooks/useExamProfile.ts`
- Modify: `src/hooks/useSession.ts`
- Modify: `src/components/CommandCenter.tsx`
- Modify: `src/components/Toast.tsx`

**Steps:**
1. Model write status as `idle | pending | synced | failed` with the last safe retry action.
2. Keep local-first optimistic UI, but persist failed remote actions in a small local outbox.
3. Serialize writes per entity/document so older rating snapshots cannot complete after newer ones.
4. Show compact user copy: `Lokal gespeichert`, `Cloud wird synchronisiert`, `Cloud-Sync fehlgeschlagen – erneut versuchen`.
5. Never include document content or answers in console/error messages.
6. Test queue order, retry and reload persistence.

**Verification:**

```bash
npm run test -- src/lib/writeQueue.test.ts
npm run test
npm run build
```

**Acceptance:** Simulated network failure keeps the local answer and exposes a working retry.

**Commit:** `feat: add durable cloud write status and retry`

---

### Task 7: Restore quality gates and deterministic offline smoke

**Objective:** Make the repository executable and testable on Linux without AI/Supabase.

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `playwright.config.ts`
- Modify: `tests/studylock-smoke.spec.ts`
- Modify lint findings in:
  - `src/components/StudySession.tsx`
  - `src/components/Toast.tsx`
  - `src/context/StudyLockContext.tsx`
  - `src/lib/ai.test.ts`
  - `src/lib/repositories/localStudyRepository.ts`
  - `src/lib/repositories/supabaseStudyRepository.ts`
  - `src/lib/studyEngine.ts`
  - `vite.config.ts`
- Create: `.github/workflows/ci.yml`

**Steps:**
1. Install `@playwright/test` as a dev dependency and install Chromium in CI.
2. Replace `npm.cmd run dev` with `npm run dev`.
3. Make the smoke test explicitly use deterministic heuristic/local mode; do not depend on a provider key.
4. Remove debug console logging from the browser test.
5. Fix lint issues without suppressing whole rules.
6. Add CI jobs for lint, unit tests, build and Chromium smoke.

**Verification:**

```bash
npm run lint
npm run test
npm run build
npm run smoke
```

Expected: all commands exit 0.

**Commit:** `chore: enforce studylock quality gates`

---

## Phase 2 — Atomic learning history and scheduling

### Task 8: Add immutable scheduling/session migration

**Objective:** Persist all fields needed to reproduce scheduling and session history.

**Files:**
- Create: `supabase/migrations/002_scheduling_and_session_integrity.sql`
- Modify: `src/types.ts`
- Modify: `src/lib/repositories/supabaseStudyRepository.ts`
- Modify repository tests

**Schema changes:**
- `study_items.ease_factor numeric not null default 2.5` with a sensible check range.
- Session `exam_profile_id`, `document_id`, `started_at`, `finished_at`, and actual elapsed seconds/minutes mapped consistently.
- Add `updated_at`/version support needed for stale-write protection.
- Add indexes only for demonstrated query paths.

**Steps:**
1. Create `002`; do not edit `001` as the deployment mechanism.
2. Extend TypeScript DB row types and mappings.
3. Add round-trip tests for `easeFactor`, session links and actual elapsed duration.
4. Verify existing rows receive valid defaults.

**Verification:**

```bash
npm run test
npm run build
supabase db reset
```

If Supabase CLI/local Docker is unavailable, mark DB reset as an explicit environment blocker; do not claim schema integration passed.

**Commit:** `feat: persist scheduling and session integrity fields`

---

### Task 9: Add atomic session-finish RPC

**Objective:** Commit session row, attempts and item schedule updates in one PostgreSQL transaction.

**Files:**
- Create: `supabase/migrations/003_finish_session_rpc.sql`
- Modify: `src/lib/repositories/studyRepository.ts`
- Modify: `src/lib/repositories/localStudyRepository.ts`
- Modify: `src/lib/repositories/supabaseStudyRepository.ts`
- Modify: `src/hooks/useSession.ts`
- Add integration tests under `tests/integration/` or `supabase/tests/`

**Steps:**
1. Define a typed `finishSession(input)` repository operation.
2. RPC validates authenticated ownership of session/document/items.
3. In one transaction: insert/upsert session, insert/upsert attempts, update only attempted item schedules.
4. Return canonical persisted values.
5. Keep a local repository implementation with equivalent semantics.
6. Remove per-rating full-document cloud upserts.
7. Test rollback when any attempt/item is invalid.

**Acceptance:** No state exists where a cloud session is saved without its attempts or schedule changes.

**Commit:** `feat: finish study sessions atomically`

---

### Task 10: Strengthen tenant/RLS integrity

**Objective:** Prevent child rows from referencing another user's parent IDs.

**Files:**
- Create: `supabase/migrations/004_tenant_integrity_policies.sql`
- Create: `supabase/tests/rls_two_user.sql` or equivalent integration test
- Document: `docs/database-ai-architecture.md`

**Steps:**
1. Add ownership checks for referenced document, chunk, item, session and profile rows.
2. Prefer writes through narrow RPCs where cross-table ownership is involved.
3. Test user A cannot select, mutate or reference user B's IDs.
4. Test legitimate same-user operations still work.

**Verification:** Two-account RLS suite passes against a reset local database.

**Commit:** `security: enforce cross-table tenant ownership`

---

## Phase 3 — Focused friend-test UX

### Task 11: Fix encoding and simplify first-run onboarding

**Objective:** Remove broken copy and get a new user to a useful question quickly.

**Files:**
- Modify: `src/App.tsx`
- Modify: `src/components/MaterialImport.tsx`
- Modify: `src/components/ExamSetup.tsx`
- Modify: `src/App.css`
- Modify: `tests/studylock-smoke.spec.ts`

**Steps:**
1. Replace all mojibake/broken emoji with valid UTF-8 German copy or simple icons.
2. Make one primary CTA: `Heute lernen` for returning users, `Material hinzufügen` for first-time users.
3. Keep the first-run sequence: material → exam date/time budget → first question.
4. Move “Später” behind a less prominent action but retain local demo accessibility.
5. Remove duplicated primary actions from hero and work panel.
6. Update smoke assertions to visible accessible names, not brittle CSS positions.

**Acceptance:** First question reached with one import and at most one short setup form; no malformed characters in rendered HTML.

**Commit:** `feat: streamline first study session onboarding`

---

### Task 12: Create a calm returning-user home

**Objective:** Make the daily action obvious and advanced controls secondary.

**Files:**
- Modify: `src/components/CommandCenter.tsx`
- Modify: `src/components/AuthPanel.tsx`
- Modify: `src/components/AISettingsPanel.tsx`
- Modify: `src/App.tsx`
- Modify: `src/App.css`

**Steps:**
1. Top area shows only: today status, days left, due count and one `Session starten` button.
2. Move auth, AI/BYOK and export controls into collapsed `Einstellungen & Daten`.
3. Keep weak topics visible only when actionable; clicking a topic starts a targeted review.
4. Label readiness as `Schätzung` and expose a short explanation.
5. Replace punitive streak wording with neutral continuity: `Heute erledigt` and `aktive Lerntage`.

**Acceptance:** A returning user can identify the next action within 5 seconds in an unmoderated test.

**Commit:** `feat: focus dashboard on today's study action`

---

### Task 13: Make the session safe and phone-first

**Objective:** Support one-handed, interruption-tolerant studying on 360–430 px screens.

**Files:**
- Modify: `src/components/StudySession.tsx`
- Modify: `src/hooks/useSession.ts`
- Modify: `src/lib/storage.ts`
- Modify: `src/App.css`
- Extend: `tests/studylock-smoke.spec.ts`

**Steps:**
1. Persist in-progress session ID, current item, answers, ratings and elapsed start time locally.
2. Offer `Session fortsetzen` after reload.
3. Confirm explicit exit only when unsaved answer text exists.
4. Use a sticky bottom action area; 44 px minimum tap targets; no horizontal overflow.
5. Preserve answer → reveal source/model answer → rate order.
6. Make blocker actions shrink the current task, not navigate away.
7. Add mobile Playwright viewport coverage.

**Verification:** Reload mid-answer restores text and current item; mobile smoke passes at 360×800.

**Commit:** `feat: add resumable mobile study sessions`

---

## Phase 4 — Learning quality and AI trust

### Task 14: Replace lossy chunking with complete source-aware chunks

**Objective:** Cover the whole imported document and retain evidence for every question.

**Files:**
- Modify: `src/lib/studyEngine.ts`
- Modify: `src/lib/pdf.ts`
- Modify: `src/types.ts`
- Modify: `src/lib/repositories/supabaseStudyRepository.ts`
- Create: `supabase/migrations/005_source_aware_chunks.sql` if new fields are needed
- Extend: `src/lib/studyEngine.test.ts`

**Steps:**
1. Do not drop sentences solely because they are under 25 characters.
2. Remove the hard first-16-chunk truncation; use bounded generation batches instead.
3. Preserve page/heading/character-range metadata where extraction supports it.
4. Attach `chunkId` to generated items.
5. Test long documents, lists, headings, short definitions and deterministic ordering.

**Acceptance:** Concatenated chunk content accounts for all normalized source text except explicitly documented separators.

**Commit:** `feat: preserve complete source coverage during import`

---

### Task 15: Runtime-validate AI output and expose provenance

**Objective:** Keep malformed/provider-hallucinated objects out of storage and let users inspect evidence.

**Files:**
- Modify: `src/lib/ai.ts`
- Modify: `src/lib/aiStudyEngine.ts`
- Modify: `supabase/functions/generate-study-items/index.ts`
- Modify: `src/components/StudySession.tsx`
- Create: `src/lib/aiSchema.ts` (Zod or a small explicit validator)
- Create/modify AI tests

**Steps:**
1. Validate question, answer, topic, type, difficulty and source/chunk IDs at runtime.
2. Reject empty, oversized or unsupported fields and fall back safely.
3. Return/store the actual model and prompt version, not hardcoded aliases.
4. Show `Aus deinem Material` with expandable source excerpt.
5. Add `Frage unklar/falsch` feedback stored locally/cloud for later review.

**Acceptance:** Invalid model JSON never becomes a `StudyItem`; every AI item has source evidence and actual model metadata.

**Commit:** `feat: validate and explain generated study items`

---

### Task 16: Replace vanity readiness with explainable signals

**Objective:** Make readiness useful without pretending to predict a grade precisely.

**Files:**
- Modify: `src/lib/studyEngine.ts`
- Modify: `src/types.ts`
- Modify: `src/components/CommandCenter.tsx`
- Modify: `src/components/SessionDone.tsx`
- Extend: `src/lib/studyEngine.test.ts`

**Steps:**
1. Start untouched items at 0, not 15.
2. Calculate separate components:
   - coverage: attempted items / total items;
   - retrieval: recent correct/partial/failed attempts;
   - retention: due/overdue performance over time.
3. Use self-rating only as one input; prefer explicit answer evaluation when available.
4. Display component breakdown and `Schätzung, keine Notenprognose`.
5. Ensure repeated easy items cannot mask untouched hard topics.
6. Add fixed-fixture tests for monotonic and anti-gaming behavior.

**Acceptance:** The UI can explain every score change in one or two sentences.

**Commit:** `feat: make exam readiness explainable`

---

## Phase 5 — Beta hardening

### Task 17: Secure and bound AI usage

**Objective:** Prevent provider-key exposure and unbounded Edge Function cost.

**Files:**
- Modify: `supabase/functions/generate-study-items/index.ts`
- Create: `supabase/config.toml`
- Create: `supabase/migrations/006_ai_usage_limits.sql`
- Modify/remove central-key path in `src/lib/openrouter.ts`
- Modify: `.env.example`
- Modify: `README.md`

**Steps:**
1. Verify JWT in function code/config and derive the user from the token.
2. Add payload size, timeout, item-count and per-user daily quota limits.
3. Store only safe usage metadata; do not log full study text by default.
4. Remove instructions suggesting an operator key in any `VITE_*` variable.
5. If BYOK remains, label it as optional, local-device-only and never sync it.
6. Test unauthenticated, over-quota, malformed and valid requests.

**Commit:** `security: bound authenticated ai generation`

---

### Task 18: Private-beta release gate

**Objective:** Produce a repeatable decision on whether StudyLock is safe for 5–10 testers.

**Files:**
- Create: `docs/beta-checklist.md`
- Modify: `README.md`
- Modify: `.github/workflows/ci.yml`

**Required checks:**

```bash
npm ci
npm run lint
npm run test
npm run build
npm run smoke
npm audit --audit-level=moderate
supabase db reset
```

**Manual acceptance matrix:**
1. Local-only first run and reload.
2. Populated local state → first login → upload/merge decision.
3. Empty local state → cloud restore.
4. Two consecutive syncs.
5. Offline answer/rating → reconnect → retry.
6. Two users proving RLS isolation.
7. Long PDF import and source-linked question.
8. Mobile 360 px session, reload/resume and finish.
9. Provider outage/rate limit falls back without blocking study.
10. Export/backup can restore a fresh browser profile.

**Beta metrics to record (privacy-safe):**
- time to first answered question;
- daily-plan start rate;
- session completion rate;
- next-day return rate;
- question feedback/error rate;
- sync failure rate.

**Release rule:** No open BLOCKER/HIGH findings, all automated gates green, and no data-loss result in the manual matrix.

**Commit:** `docs: define private beta release gate`

---

## 4. Recommended execution order

1. Tasks 1–4: immediate data-loss/schema blockers.
2. Tasks 5–7: repeatable persistence and green quality gates.
3. Tasks 8–10: atomic cloud learning history and RLS.
4. Tasks 11–13: focused friend-test UX.
5. Tasks 14–16: learning quality and AI trust.
6. Tasks 17–18: bounded private beta.

Do not mix visual redesign, learning algorithm changes and sync internals in one commit. Each task should receive:

1. failing test or reproducible failure;
2. minimal implementation;
3. focused test;
4. full lint/test/build gate;
5. independent BLOCKER/HIGH review;
6. one scoped commit.

---

## 5. Definition of done for the next milestone

The next milestone is **“Trustworthy Friend-Test Alpha”**, not “finished SaaS.” It is done when:

- Local study data cannot be overwritten merely by logging in.
- All database IDs and foreign keys are valid.
- Sync is repeatable, failures are visible and retryable, and local state remains usable offline.
- A session’s attempts and scheduling survive reload/cloud round-trip together.
- `npm run lint`, `npm run test`, `npm run build` and `npm run smoke` pass in CI.
- German copy renders correctly.
- A phone user can go from open app to first answer in under 90 seconds.
- AI is optional, validated and source-linked.
- Readiness is explicitly presented as an explainable estimate.
- Two-account RLS tests and the beta acceptance matrix pass.
