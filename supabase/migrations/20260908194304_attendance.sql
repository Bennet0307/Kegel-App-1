-- ============================================================
-- Migration: attendance
-- Zu-/Absage pro Event und Mitglied ("Anwesenheit").
-- ============================================================

create table attendance (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references event(id) on delete cascade,
  member_id uuid not null references member(id) on delete cascade,
  status text not null default 'offen'
    check (status in ('offen', 'zugesagt', 'abgesagt')),
  responded_at timestamptz,
  unique (event_id, member_id)
);

alter table attendance enable row level security;

-- Hilfsfunktion: eigene member-Zeilen des eingeloggten Users.
-- security definer, damit Policies auf anderen Tabellen (hier:
-- attendance) member abfragen können, ohne dessen RLS erneut
-- auszulösen (analog zu auth_club_ids()).
create or replace function auth_member_ids()
returns setof uuid
language sql
security definer
stable
as $$
  select id from member where user_id = auth.uid();
$$;

-- Sichtbar für alle Mitglieder desselben Clubs (offene Zu-/Absagen-Liste).
create policy "attendance_select_same_club"
  on attendance for select
  using (
    event_id in (select id from event where club_id in (select auth_club_ids()))
  );

-- Jedes Mitglied darf nur seine eigene Zu-/Absage setzen.
create policy "attendance_write_own"
  on attendance for all
  using (member_id in (select auth_member_ids()))
  with check (
    member_id in (select auth_member_ids())
    and event_id in (select id from event where club_id in (select auth_club_ids()))
  );
