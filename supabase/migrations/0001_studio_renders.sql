-- ---------------------------------------------------------------------------
-- Image Studio history, mirrored into Postgres.
--
-- Convex keeps the app's own data. This table exists for the one thing a
-- browser-local history cannot do: be read from a second device, survive a
-- cleared cache, and be queried with SQL. The studio writes to it through
-- `supabase.backup` (a Convex action holding the secret key) and reads it back
-- with `supabase.pull`.
--
-- Run this once, in Supabase → SQL Editor. It is idempotent: running it again
-- after an edit is safe.
-- ---------------------------------------------------------------------------

create table if not exists public.studio_renders (
  -- Row id. Not the picture, because the same picture may be saved again
  -- after a re-score; the unique constraint below is what makes it one row.
  id uuid primary key default gen_random_uuid(),
  -- Convex user id, as text: this table is read by one deployment, not by
  -- Supabase Auth, so there is no auth.users row to point at.
  user_id text not null,
  image_url text not null,
  prompt text not null,
  kind text not null default 'ai',
  provider text,
  aspect text,
  score integer,
  refined boolean not null default false,
  pinned boolean not null default false,
  -- The character brief and page title the prompt was grounded with, kept so a
  -- picture pulled back on another device can still be generated again as it
  -- was.
  reference text,
  page_title text,
  -- When the picture was made, not when it was backed up.
  created_at timestamptz not null,
  saved_at timestamptz not null default now(),
  -- The upsert target: backing up twice updates the same row instead of
  -- growing a duplicate for every press.
  unique (user_id, image_url)
);

-- The only read pattern the app uses: this user's pictures, newest first.
create index if not exists studio_renders_user_time
  on public.studio_renders (user_id, created_at desc);

-- Row Level Security on, with no policies: the anon/publishable key can read
-- nothing here. The Convex action uses the secret key, which bypasses RLS, and
-- filters by user_id itself. If a public gallery is wanted later, add:
--
--   alter table public.studio_renders add column is_public boolean not null default false;
--   create policy "public renders are readable"
--     on public.studio_renders for select
--     using (is_public = true);
--
-- and the publishable key can then read exactly those rows and no others.
alter table public.studio_renders enable row level security;
