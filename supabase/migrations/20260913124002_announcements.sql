-- ============================================================
-- Migration: announcements
-- Ankündigungen: Admin/Kassierer posten eine Nachricht, alle
-- Mitglieder des Clubs sehen sie. Reines CRUD (kein RPC nötig,
-- analog zu penalty_rule in Migration 17) – RLS regelt die
-- Berechtigung.
-- ============================================================

create table announcement (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references club(id) on delete cascade,
  author_member_id uuid references member(id) on delete set null,
  title text not null,
  body text not null,
  created_at timestamptz not null default now()
);

alter table announcement enable row level security;

create policy "announcement_select_same_club"
  on announcement for select
  using (club_id in (select auth_club_ids()));

create policy "announcement_write_staff"
  on announcement for all
  using (club_id in (select auth_staff_club_ids()))
  with check (club_id in (select auth_staff_club_ids()));
