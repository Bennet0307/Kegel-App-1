-- ============================================================
-- Migration: init_schema
-- Legt die Kern-Tabellen club, member, event an inkl. RLS.
-- ============================================================

-- 1) club: der Verein / Mandant
create table club (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  invite_code text not null unique default substr(md5(random()::text), 1, 8),
  created_at timestamptz not null default now()
);

-- 2) member: ein Vereinsmitglied, verknüpft mit einem Auth-User
create table member (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references club(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  display_name text not null,
  role text not null default 'mitglied'
    check (role in ('admin', 'kassierer', 'mitglied', 'gast')),
  joined_at timestamptz not null default now(),
  unique (club_id, user_id)
);

-- 3) event: ein Termin (Kegelabend, Turnier, Sitzung)
create table event (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references club(id) on delete cascade,
  type text not null default 'kegelabend'
    check (type in ('kegelabend', 'turnier', 'sitzung')),
  title text not null,
  starts_at timestamptz not null,
  location text,
  status text not null default 'geplant'
    check (status in ('geplant', 'abgeschlossen', 'abgesagt')),
  created_at timestamptz not null default now()
);

-- ============================================================
-- Row Level Security
-- ============================================================

alter table club enable row level security;
alter table member enable row level security;
alter table event enable row level security;

-- Hilfsfunktion: liefert alle club_ids, in denen der eingeloggte
-- User Mitglied ist. security definer, damit sie in Policies
-- ohne erneute RLS-Prüfung auf "member" laufen kann (sonst
-- entsteht eine rekursive Policy-Prüfung).
create or replace function auth_club_ids()
returns setof uuid
language sql
security definer
stable
as $$
  select club_id from member where user_id = auth.uid();
$$;

-- club: sichtbar/änderbar nur für Mitglieder des jeweiligen Clubs
create policy "club_select_own"
  on club for select
  using (id in (select auth_club_ids()));

create policy "club_update_admin"
  on club for update
  using (
    id in (
      select club_id from member
      where user_id = auth.uid() and role = 'admin'
    )
  );

-- member: sichtbar für alle Mitglieder desselben Clubs
create policy "member_select_same_club"
  on member for select
  using (club_id in (select auth_club_ids()));

-- member: nur Admins dürfen Mitglieder anlegen/ändern/entfernen
create policy "member_write_admin"
  on member for all
  using (
    club_id in (
      select club_id from member
      where user_id = auth.uid() and role = 'admin'
    )
  )
  with check (
    club_id in (
      select club_id from member
      where user_id = auth.uid() and role = 'admin'
    )
  );

-- event: sichtbar für alle Mitglieder desselben Clubs
create policy "event_select_same_club"
  on event for select
  using (club_id in (select auth_club_ids()));

-- event: Admins und Kassierer dürfen Termine anlegen/ändern
create policy "event_write_admin_kassierer"
  on event for all
  using (
    club_id in (
      select club_id from member
      where user_id = auth.uid() and role in ('admin', 'kassierer')
    )
  )
  with check (
    club_id in (
      select club_id from member
      where user_id = auth.uid() and role in ('admin', 'kassierer')
    )
  );