-- StudyLock core schema for exam-accountability + AI/RAG pipeline
-- Run in Supabase SQL editor or via Supabase CLI.

create extension if not exists pgcrypto;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email text,
  created_at timestamptz not null default now()
);

create table if not exists public.courses (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  semester text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.exam_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  course_id uuid references public.courses(id) on delete cascade,
  subject text not null,
  exam_date date not null,
  goal text not null check (goal in ('bestehen', 'gut', 'sehr-gut')),
  daily_minutes integer not null check (daily_minutes between 1 and 240),
  confidence integer not null check (confidence between 1 and 5),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  course_id uuid references public.courses(id) on delete set null,
  exam_profile_id uuid references public.exam_profiles(id) on delete set null,
  title text not null,
  subject text not null,
  source_type text not null default 'paste' check (source_type in ('pdf', 'txt', 'md', 'paste')),
  raw_text text not null,
  text_hash text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.document_chunks (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  document_id uuid not null references public.documents(id) on delete cascade,
  chunk_index integer not null,
  text text not null,
  page_number integer,
  heading text,
  token_estimate integer not null default 0,
  created_at timestamptz not null default now(),
  unique (document_id, chunk_index)
);

create table if not exists public.study_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  course_id uuid references public.courses(id) on delete set null,
  document_id uuid not null references public.documents(id) on delete cascade,
  chunk_id uuid references public.document_chunks(id) on delete set null,
  topic text not null,
  question text not null,
  answer text not null,
  source text not null,
  type text not null check (type in ('karte', 'quiz', 'aufgabe')),
  difficulty text not null check (difficulty in ('leicht', 'mittel', 'hart')),
  due_at timestamptz not null default now(),
  interval_days integer not null default 0,
  repetitions integer not null default 0,
  last_rating text check (last_rating in ('again', 'hard', 'good')),
  generation_source text not null default 'heuristic-v1',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.study_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  course_id uuid references public.courses(id) on delete set null,
  exam_profile_id uuid references public.exam_profiles(id) on delete set null,
  document_id uuid references public.documents(id) on delete set null,
  mode text not null check (mode in ('recall', 'deepwork', 'review', 'exam')),
  started_at timestamptz,
  finished_at timestamptz not null default now(),
  minutes integer not null default 25,
  score integer not null default 0,
  answered integer not null default 0,
  blocker_count integer not null default 0,
  readiness_after integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.study_attempts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  session_id uuid not null references public.study_sessions(id) on delete cascade,
  study_item_id uuid references public.study_items(id) on delete set null,
  user_answer text,
  rating text check (rating in ('again', 'hard', 'good')),
  self_score integer check (self_score between 0 and 100),
  time_spent_seconds integer,
  created_at timestamptz not null default now()
);

create table if not exists public.ai_generations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  document_id uuid references public.documents(id) on delete cascade,
  chunk_id uuid references public.document_chunks(id) on delete set null,
  model text not null,
  prompt_version text not null,
  input_hash text not null,
  status text not null default 'pending' check (status in ('pending', 'running', 'succeeded', 'failed')),
  output jsonb,
  error_message text,
  cost_estimate numeric(10, 6),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists courses_user_idx on public.courses(user_id);
create index if not exists documents_user_idx on public.documents(user_id);
create index if not exists documents_text_hash_idx on public.documents(user_id, text_hash);
create index if not exists chunks_document_idx on public.document_chunks(document_id, chunk_index);
create index if not exists study_items_user_due_idx on public.study_items(user_id, due_at);
create index if not exists study_items_document_idx on public.study_items(document_id);
create index if not exists sessions_user_created_idx on public.study_sessions(user_id, created_at desc);
create index if not exists attempts_session_idx on public.study_attempts(session_id);
create index if not exists ai_generations_document_idx on public.ai_generations(document_id, created_at desc);

alter table public.profiles enable row level security;
alter table public.courses enable row level security;
alter table public.exam_profiles enable row level security;
alter table public.documents enable row level security;
alter table public.document_chunks enable row level security;
alter table public.study_items enable row level security;
alter table public.study_sessions enable row level security;
alter table public.study_attempts enable row level security;
alter table public.ai_generations enable row level security;

drop policy if exists "profiles own rows" on public.profiles;
drop policy if exists "courses own rows" on public.courses;
drop policy if exists "exam_profiles own rows" on public.exam_profiles;
drop policy if exists "documents own rows" on public.documents;
drop policy if exists "document_chunks own rows" on public.document_chunks;
drop policy if exists "study_items own rows" on public.study_items;
drop policy if exists "study_sessions own rows" on public.study_sessions;
drop policy if exists "study_attempts own rows" on public.study_attempts;
drop policy if exists "ai_generations own rows" on public.ai_generations;

create policy "profiles own rows" on public.profiles for all using (auth.uid() = id) with check (auth.uid() = id);
create policy "courses own rows" on public.courses for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "exam_profiles own rows" on public.exam_profiles for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "documents own rows" on public.documents for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "document_chunks own rows" on public.document_chunks for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "study_items own rows" on public.study_items for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "study_sessions own rows" on public.study_sessions for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "study_attempts own rows" on public.study_attempts for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy "ai_generations own rows" on public.ai_generations for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists courses_touch_updated_at on public.courses;
drop trigger if exists exam_profiles_touch_updated_at on public.exam_profiles;
drop trigger if exists documents_touch_updated_at on public.documents;
drop trigger if exists study_items_touch_updated_at on public.study_items;
drop trigger if exists ai_generations_touch_updated_at on public.ai_generations;

create trigger courses_touch_updated_at before update on public.courses for each row execute function public.touch_updated_at();
create trigger exam_profiles_touch_updated_at before update on public.exam_profiles for each row execute function public.touch_updated_at();
create trigger documents_touch_updated_at before update on public.documents for each row execute function public.touch_updated_at();
create trigger study_items_touch_updated_at before update on public.study_items for each row execute function public.touch_updated_at();
create trigger ai_generations_touch_updated_at before update on public.ai_generations for each row execute function public.touch_updated_at();
