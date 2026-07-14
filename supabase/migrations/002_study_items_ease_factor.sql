alter table public.study_items
  add column if not exists ease_factor numeric not null default 2.5;

alter table public.study_items
  drop constraint if exists study_items_ease_factor_check;

alter table public.study_items
  add constraint study_items_ease_factor_check check (ease_factor >= 1.3);
