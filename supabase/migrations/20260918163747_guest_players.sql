-- ============================================================
-- Migration: guest_players
-- Gastkegler (Idee aus "Offene Punkte"/Kern-Datenmodell umgesetzt):
-- Admin/Kassierer können für einen einzelnen Termin einen Gastkegler
-- ohne eigenes Konto einladen. Bewusst als `member`-Zeile mit der
-- schon seit Migration 1 vorgesehenen, aber nie genutzten Rolle
-- `'gast'` umgesetzt statt einer komplett separaten Tabelle: dadurch
-- funktionieren alle bestehenden Spiel-/Strafen-/Kassen-RPCs
-- (record_game_scores, book_freitext_game, book_zehner_game,
-- record_event_penalties, check_in – alle nehmen ohnehin nur eine
-- `member_id` entgegen) sofort auch für Gastkegler, ohne dort etwas
-- ändern zu müssen.
-- ============================================================

alter table member alter column user_id drop not null;

alter table member add column guest_event_id uuid references event(id) on delete cascade;
comment on column member.guest_event_id is
  'Nur bei role = ''gast'' gesetzt: der Termin, für den dieser Gastkegler eingeladen wurde. In Mitglieder-Auswahllisten (enter-score.tsx, enter-penalties.tsx, check-in.tsx) erscheint der Gast nur bei genau diesem Termin. NULL bei echten Mitgliedern.';

alter table member add constraint member_guest_event_id_requires_role
  check (guest_event_id is null or role = 'gast');

-- Lädt einen Gastkegler für einen Termin ein. Security-definer statt
-- einer Erweiterung von `member_write_admin`, damit reguläre
-- Mitglieder-Policies (nur Admin, nicht Kassierer) unangetastet
-- bleiben – Gastkegler einladen ist wie andere Termin-Aktionen
-- (Ergebnisse/Strafen erfassen) bewusst Admin+Kassierer erlaubt.
create or replace function invite_guest(p_event_id uuid, p_display_name text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_club_id uuid;
  v_member_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Nicht eingeloggt';
  end if;

  select club_id into v_club_id from event where id = p_event_id;
  if v_club_id is null then
    raise exception 'Kegelabend nicht gefunden';
  end if;

  if not exists (
    select 1 from member
    where user_id = auth.uid() and club_id = v_club_id and role in ('admin', 'kassierer')
  ) then
    raise exception 'Nur Admin/Kassierer dürfen Gastkegler einladen';
  end if;

  insert into member (club_id, user_id, display_name, role, guest_event_id)
  values (v_club_id, null, p_display_name, 'gast', p_event_id)
  returning id into v_member_id;

  return v_member_id;
end;
$$;

revoke all on function invite_guest(uuid, text) from public;
grant execute on function invite_guest(uuid, text) to authenticated;

-- Entfernt eine versehentliche Einladung wieder – nur solange der
-- Gast noch keine Ergebnisse/Strafen/Buchungen hat, um nicht
-- rückwirkend Kassenbuch-Historie zu zerstören (siehe Kaskaden auf
-- score/penalty/transaction/attendance/zehner_milestone).
create or replace function remove_guest(p_member_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_club_id uuid;
  v_role text;
begin
  if auth.uid() is null then
    raise exception 'Nicht eingeloggt';
  end if;

  select club_id, role into v_club_id, v_role from member where id = p_member_id;
  if v_club_id is null then
    raise exception 'Mitglied nicht gefunden';
  end if;
  if v_role <> 'gast' then
    raise exception 'Nur Gastkegler können auf diesem Weg entfernt werden';
  end if;

  if not exists (
    select 1 from member
    where user_id = auth.uid() and club_id = v_club_id and role in ('admin', 'kassierer')
  ) then
    raise exception 'Nur Admin/Kassierer dürfen Gastkegler entfernen';
  end if;

  if exists (select 1 from score where member_id = p_member_id)
    or exists (select 1 from penalty where member_id = p_member_id)
    or exists (select 1 from transaction where member_id = p_member_id)
    or exists (select 1 from attendance where member_id = p_member_id)
    or exists (select 1 from zehner_milestone where thrower_member_id = p_member_id)
  then
    raise exception 'Gastkegler hat bereits Ergebnisse/Buchungen und kann nicht mehr entfernt werden';
  end if;

  delete from member where id = p_member_id;
end;
$$;

revoke all on function remove_guest(uuid) from public;
grant execute on function remove_guest(uuid) to authenticated;
