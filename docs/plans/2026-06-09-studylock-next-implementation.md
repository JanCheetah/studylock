# StudyLock Next Implementation Plan

> **For Hermes:** Use subagent-driven-development or Codex for bounded task execution. Keep tasks small and verify after each slice.

**Goal:** Make StudyLock's AI/import/session loop durable enough for real testing, not just a working demo.

**Architecture:** Keep the current local-first React/Vite app, but make Supabase persistence richer: AI generations, chunks, and per-item attempts should become first-class data. Keep deterministic fallback for missing auth/provider errors and avoid blocking study sessions on AI.

**Tech Stack:** Vite, React, TypeScript, Supabase Auth/Postgres/Edge Functions, OpenRouter via server-side Edge Function, Vitest, optional Playwright smoke tests.

---

## Priority Order

1. AI generation audit trail and source labeling.
2. Persist real per-item study attempts.
3. Harden AI/import fallback behavior with tests.
4. Add a public-demo smoke regression path.

---

### Task 1: Inspect current AI/data mapping

**Objective:** Confirm exactly where generated items lose source/model/audit metadata.

**Files:**
- Inspect: `src/lib/ai.ts`
- Inspect: `src/App.tsx`
- Inspect: `src/lib/repositories/studyRepository.ts`
- Inspect: `src/lib/repositories/supabaseStudyRepository.ts`
- Inspect: `src/types.ts`
- Inspect: `supabase/functions/generate-study-items/index.ts`
- Inspect: `supabase/migrations/*.sql`

**Steps:**
1. Read the listed files.
2. Search for `generation_source`, `ai_generations`, `document_chunks`, `saveStudyItems`, `generateStudyItemsWithAi`.
3. Write down the smallest interface change needed so items can carry `generationSource` and model metadata.

**Verification:**

```bash
npm run test
npm run build
```

Expected: existing checks still pass before implementation.

---

### Task 2: Add generation source to app-level item flow

**Objective:** Preserve whether an item came from OpenRouter or heuristic fallback.

**Files:**
- Modify: `src/types.ts`
- Modify: `src/lib/ai.ts`
- Modify: `src/App.tsx`
- Modify: `src/lib/repositories/studyRepository.ts`
- Modify: `src/lib/repositories/localStudyRepository.ts`
- Modify: `src/lib/repositories/supabaseStudyRepository.ts`
- Test: `src/lib/repositories/sync.test.ts`

**Steps:**
1. Add an app-level field such as `generationSource?: 'openrouter' | 'heuristic-v1'` to `StudyItem` or repository save input.
2. Set `generationSource: 'openrouter'` for AI-generated items.
3. Set `generationSource: 'heuristic-v1'` for fallback items.
4. Update Supabase mapping so DB `generation_source` is no longer hardcoded.
5. Update local repository so the field survives localStorage round-trips.
6. Extend an existing repository/sync test to assert both source values survive.

**Verification:**

```bash
npm run test
npm run build
```

Expected: tests pass; no TypeScript errors.

---

### Task 3: Log AI generation attempts

**Objective:** Use the existing `ai_generations` table for observability: success, provider error, model, prompt version.

**Files:**
- Modify: `src/lib/repositories/studyRepository.ts`
- Modify: `src/lib/repositories/supabaseStudyRepository.ts`
- Modify: `src/App.tsx`
- Modify: `src/lib/ai.ts`
- Optional modify: `supabase/functions/generate-study-items/index.ts`
- Test: `src/lib/repositories/sync.test.ts` or new repository unit test with mocked Supabase client

**Steps:**
1. Add a repository method like `recordAiGeneration(log)` or extend the document save result with AI metadata.
2. On AI success, log `status='succeeded'`, `provider='openrouter'`, `model`, `items_count`, and prompt version.
3. On AI failure/rate-limit, log `status='failed'`, error message/status if available, and fallback source.
4. Keep logging best-effort: failure to write the log must not break import/session.

**Verification:**

```bash
npm run test
npm run build
```

Manual Supabase check after deployment:

```sql
select status, provider, model, items_count, error_message, created_at
from public.ai_generations
order by created_at desc
limit 10;
```

---

### Task 4: Persist document chunks on import

**Objective:** Make imported material reusable for later re-generation, weakness lookup, and quote/source evidence.

**Files:**
- Modify: `src/lib/studyEngine.ts`
- Modify: `src/App.tsx`
- Modify: `src/lib/repositories/studyRepository.ts`
- Modify: `src/lib/repositories/supabaseStudyRepository.ts`
- Test: `src/lib/studyEngine.test.ts` new

**Steps:**
1. Ensure `splitIntoChunks` has deterministic output and stable ordering.
2. Add repository method `saveDocumentChunks(documentId, chunks)` or include chunks in `saveDocument`.
3. Save chunks in Supabase `document_chunks` during import/sync.
4. Local mode may store chunks or no-op, but interface should stay consistent.
5. Add tests for chunk count/order and minimum text behavior.

**Verification:**

```bash
npm run test
npm run build
```

Manual Supabase check:

```sql
select document_id, chunk_index, left(content, 80) as preview
from public.document_chunks
order by created_at desc, chunk_index asc
limit 20;
```

---

### Task 5: Add real per-item study attempts

**Objective:** Store every answer/rating as a durable `StudyAttempt`, not only aggregate session result.

**Files:**
- Modify: `src/types.ts`
- Modify: `src/App.tsx`
- Modify: `src/lib/repositories/studyRepository.ts`
- Modify: `src/lib/repositories/localStudyRepository.ts`
- Modify: `src/lib/repositories/supabaseStudyRepository.ts`
- Modify: `src/lib/storage.ts`
- Test: `src/lib/repositories/sync.test.ts`

**Steps:**
1. Define `StudyAttempt` with `sessionId`, `itemId`, `answer`, `selfRating`, `isCorrect?`, `createdAt`.
2. In `finishSession`, derive attempts from current `answers` and `ratings`.
3. Save attempts through repository interface.
4. In Supabase repository, insert into `study_attempts`.
5. In local repository, persist attempts to localStorage.
6. Add test that a completed session saves attempts count equal to answered/rated items.

**Verification:**

```bash
npm run test
npm run build
```

Manual Supabase check:

```sql
select session_id, item_id, self_rating, created_at
from public.study_attempts
order by created_at desc
limit 20;
```

---

### Task 6: Harden AI/import fallback UI

**Objective:** Make demo behavior understandable when AI is unavailable or rate-limited.

**Files:**
- Modify: `src/lib/ai.ts`
- Modify: `src/App.tsx`
- Test: `src/lib/ai.test.ts` new

**Steps:**
1. Change `generateStudyItemsWithAi` to return a result object such as `{ items, source, error? }` instead of only `StudyItem[] | null`.
2. Distinguish missing Supabase config, logged-out/JWT error, provider rate-limit, missing secret, and empty model output where practical.
3. In UI status, show short German messages:
   - `KI erzeugt Lernitems ...`
   - `KI gerade nicht verfügbar – lokaler Fallback genutzt.`
   - `OpenRouter rate-limited – Fallback genutzt.`
4. Ensure study flow continues even on failure.
5. Add tests for success, error, and too-short text behavior by mocking Supabase function invoke.

**Verification:**

```bash
npm run test
npm run build
```

---

### Task 7: Add public-demo smoke test

**Objective:** Catch broken demo flows before auto-rehost makes them public.

**Files:**
- Modify: `package.json`
- Create: `playwright.config.ts`
- Create: `tests/studylock-smoke.spec.ts`

**Steps:**
1. Add Playwright dependency only if acceptable for repo size.
2. Add `smoke` script: `playwright test`.
3. Test core local flow without needing Supabase auth:
   - open `/`
   - configure exam plan
   - import/paste sample material or use available input path
   - start a session
   - answer one item
   - rate it
   - finish session
4. Keep selectors robust via accessible labels/text.

**Verification:**

```bash
npm run build
npm run test
npm run smoke
```

---

### Task 8: Deploy and verify production demo

**Objective:** Confirm the pushed implementation is live and stable.

**Files/Systems:**
- GitHub repo: `JanCheetah/studylock`
- Supabase Edge Function: `generate-study-items`
- Auto-rehost script: `/home/agent/.hermes/scripts/github_auto_rehost.py`

**Steps:**
1. Commit and push after green checks.
2. Wait up to 1 minute for `github-auto-rehost`.
3. Verify public URL returns 200 and current app asset.
4. Browser smoke: open page, check console, run import/session path manually if needed.

**Verification:**

```bash
npm run test
npm run build
curl -L -I https://similar-tracker-ross-interact.trycloudflare.com
```

Expected: HTTP 200, no browser console errors.

---

## Codex Notes

Codex was used read-only for planning. Local shell reads inside Codex hit a sandbox/bubblewrap issue, so Codex used GitHub/Supabase connectors instead. For implementation, prefer narrow Codex prompts per task, e.g.:

```bash
codex exec "Implement only Task 2 from docs/plans/2026-06-09-studylock-next-implementation.md. Do not touch unrelated files. Run npm run test and npm run build."
```

Avoid broad prompts because Codex used a high token budget even for planning.
