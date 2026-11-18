-- ---------------------------------------------------------------------------
-- Public share links for studio pictures.
--
-- A link is `/s/<slug>` in this app, and the page behind it reads the row
-- through a Convex action that selects by slug and returns only the picture's
-- public fields. No Supabase key reaches the browser, and RLS stays closed, so
-- the table is not readable directly even with the anon key.
--
-- Run after 0001_studio_renders.sql. Idempotent.
-- ---------------------------------------------------------------------------

alter table public.studio_renders
  add column if not exists share_slug text,
  add column if not exists shared_at timestamptz;

-- Unique so one link can never resolve to two pictures. Null for every picture
-- that is not shared, which is the normal state and why the index is partial in
-- effect (Postgres stores many nulls without treating them as duplicates).
create unique index if not exists studio_renders_share_slug
  on public.studio_renders (share_slug);
