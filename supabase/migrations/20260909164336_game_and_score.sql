-- ============================================================
-- Migration: game_and_score
-- Ergebniserfassung: ein `game` pro Kegelabend (mit Spieltyp),
-- `score` = Ergebnis (Kegel) pro Mitglied und Spiel.
-- ============================================================

create table game (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references club(id) on delete cascade,
  event_id uuid not null references event(id) on delete cascade,
  type text not null default 'punktekegeln'
    check (type in ('punktekegeln', 'bundeskegeln')),
  created_at timestamptz not null default now()
);

create table score (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references club(id) on delete cascade,
  game_id uuid not null references game(id) on delete cascade,
  member_id uuid not null references member(id) on delete cascade,
  pins integer not null check (pins >= 0),
  created_at timestamptz not null default now(),
  unique (game_id, member_id)
);

alter table game enable row level security;
alter table score enable row level security;

-- Hilfsfunktion: Club-IDs, in denen der eingeloggte User admin oder
-- kassierer ist (analog zu auth_admin_club_ids(), aber für beide
-- schreibberechtigten Rollen). security definer, um RLS-Rekursion
-- auf member zu vermeiden.
create or replace function auth_staff_club_ids()
returns setof uuid
language sql
security definer
stable
as $$
  select club_id from member where user_id = auth.uid() and role in ('admin', 'kassierer');
$$;

create policy "game_select_same_club"
  on game for select
  using (club_id in (select auth_club_ids()));

create policy "game_write_staff"
  on game for all
  using (club_id in (select auth_staff_club_ids()))
  with check (club_id in (select auth_staff_club_ids()));

create policy "score_select_same_club"
  on score for select
  using (club_id in (select auth_club_ids()));

create policy "score_write_staff"
  on score for all
  using (club_id in (select auth_staff_club_ids()))
  with check (club_id in (select auth_staff_club_ids()));
