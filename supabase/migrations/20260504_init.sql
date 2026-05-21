-- ============================================================
-- Nahweeezy's Tactics Board — initial Supabase schema
-- Run from the Supabase SQL editor or via `supabase db push`.
-- ============================================================

-- ── Profiles ────────────────────────────────────────────────
-- One row per auth.users, keyed by their auth uid.
create table if not exists public.profiles (
  id          uuid        primary key references auth.users on delete cascade,
  username    text        unique not null check (char_length(username) between 3 and 24),
  created_at  timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "profiles are viewable by everyone" on public.profiles;
create policy "profiles are viewable by everyone"
  on public.profiles for select
  using (true);

drop policy if exists "users can insert their own profile" on public.profiles;
create policy "users can insert their own profile"
  on public.profiles for insert
  with check (auth.uid() = id);

drop policy if exists "users can update their own profile" on public.profiles;
create policy "users can update their own profile"
  on public.profiles for update
  using (auth.uid() = id);

-- ── Shared (public) tactics ─────────────────────────────────
create table if not exists public.shared_tactics (
  id          uuid        primary key default gen_random_uuid(),
  user_id     uuid        not null references auth.users on delete cascade,
  name        text        not null check (char_length(name) between 1 and 80),
  description text,
  data        jsonb       not null,
  views       integer     not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

create index if not exists shared_tactics_created_at_idx
  on public.shared_tactics (created_at desc);
create index if not exists shared_tactics_user_id_idx
  on public.shared_tactics (user_id);

alter table public.shared_tactics enable row level security;

drop policy if exists "shared tactics are viewable by everyone" on public.shared_tactics;
create policy "shared tactics are viewable by everyone"
  on public.shared_tactics for select
  using (true);

drop policy if exists "users can insert their own tactics" on public.shared_tactics;
create policy "users can insert their own tactics"
  on public.shared_tactics for insert
  with check (auth.uid() = user_id);

drop policy if exists "users can update their own tactics" on public.shared_tactics;
create policy "users can update their own tactics"
  on public.shared_tactics for update
  using (auth.uid() = user_id);

drop policy if exists "users can delete their own tactics" on public.shared_tactics;
create policy "users can delete their own tactics"
  on public.shared_tactics for delete
  using (auth.uid() = user_id);

-- ── Touch-updated trigger ───────────────────────────────────
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists shared_tactics_touch_updated_at on public.shared_tactics;
create trigger shared_tactics_touch_updated_at
  before update on public.shared_tactics
  for each row execute function public.touch_updated_at();
