# StudyLock Database/AI Context Architecture

StudyLock is still usable as a local-first demo, but the data model is now prepared for Supabase persistence and later AI/RAG generation.

## Why this schema exists

AI needs stable learning context, not just one-off PDF prompts:

- documents store raw extracted material
- document_chunks become the RAG/AI generation unit
- study_items store generated questions/tasks and review state
- study_sessions + study_attempts create the learning history
- ai_generations logs model/prompt/version/cost/debug metadata

## Setup

1. Create a Supabase project.
2. Run `supabase/migrations/001_studylock_core.sql` in the SQL editor or via Supabase CLI.
3. Copy `.env.example` to `.env.local` and fill:

```bash
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
```

4. Add Auth UI before expecting cloud writes. The migration uses RLS with `auth.uid() = user_id`, so anonymous unauthenticated writes are intentionally blocked.

## Current app behavior

- If env vars are missing: StudyLock uses localStorage.
- If env vars exist but the user is not authenticated: StudyLock still falls back to localStorage and shows that Supabase is prepared.
- Once Auth is added and a user is authenticated: `getStudyRepository()` switches to `SupabaseStudyRepository` for load/save operations.

## Next implementation slice

1. Add email magic-link auth UI.
2. Add “Sync local data to cloud” action after login.
3. Store document chunks on import.
4. Add AI generation job that reads chunks and writes `study_items` + `ai_generations`.
