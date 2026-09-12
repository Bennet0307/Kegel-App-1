-- ============================================================
-- Migration: late_penalty
-- (1) Check-in-Zeit soll von Admin/Kassierer nachträglich angepasst
--     werden können (nicht nur "jetzt" setzen/löschen).
-- (2) Automatische Verspätungsstrafe (die in Migration 24 bewusst
--     zurückgestellte Idee): pro Club konfigurierbar entweder
--     "pauschal" (fester Betrag, egal wie spät) oder "intervall"
--     (X Euro pro angefangene Y Minuten). NULL/deaktiviert ist der
--     Default – kein Club zahlt automatisch Verspätungsstrafe, bis
--     das explizit in den Club-Einstellungen aktiviert wird.
--
-- Beides läuft über eine neue RPC `check_in`, die Self-Check-in und
-- Staff-Check-in/-Bearbeitung vereinheitlicht: sie setzt
-- `attendance.checked_in_at` (beliebiger Zeitpunkt, nicht nur "jetzt")
-- und berechnet danach die Verspätungsstrafe neu (Replace-Muster wie
-- bei record_event_penalties: alte automatische Buchung für dieses
-- Einchecken erst löschen, dann bei Bedarf neu bilden – so bleibt eine
-- Korrektur der Check-in-Zeit oder ein Rückgängigmachen immer korrekt,
-- ohne doppelte oder verwaiste Buchungen).
-- ============================================================

alter table club add column late_penalty_mode text
  check (late_penalty_mode is null or late_penalty_mode in ('pauschal', 'intervall'));
alter table club add column late_penalty_cents integer
  check (late_penalty_cents is null or late_penalty_cents >= 0);
alter table club add column late_penalty_interval_minutes integer
  check (late_penalty_interval_minutes is null or late_penalty_interval_minutes > 0);
alter table club add column late_penalty_interval_cents integer
  check (late_penalty_interval_cents is null or late_penalty_interval_cents >= 0);
comment on column club.late_penalty_mode is
  'NULL = keine automatische Verspätungsstrafe. ''pauschal'' = fester Betrag (late_penalty_cents), ''intervall'' = late_penalty_interval_cents pro angefangene late_penalty_interval_minutes Minuten.';

-- Markiert eine automatisch erzeugte Verspätungsstrafe-Buchung als zu
-- genau diesem Check-in gehörend, damit check_in() sie gezielt
-- löschen/neu bilden kann, ohne andere strafe-Buchungen desselben
-- Termins/Mitglieds (Hausnummer, Strafenkatalog, Pumpenkönig) zu
-- berühren.
alter table transaction add column late_checkin_attendance_id uuid references attendance(id) on delete cascade;

create or replace function check_in(p_event_id uuid, p_member_id uuid, p_checked_in_at timestamptz)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_club_id uuid;
  v_starts_at timestamptz;
  v_caller_member_id uuid;
  v_caller_role text;
  v_attendance_id uuid;
  v_late_minutes integer;
  v_fee_cents integer := 0;
  v_mode text;
  v_flat_cents integer;
  v_interval_minutes integer;
  v_interval_cents integer;
begin
  if auth.uid() is null then
    raise exception 'Nicht eingeloggt';
  end if;

  select club_id, starts_at into v_club_id, v_starts_at from event where id = p_event_id;
  if v_club_id is null then
    raise exception 'Kegelabend nicht gefunden';
  end if;

  select id, role into v_caller_member_id, v_caller_role
    from member where user_id = auth.uid() and club_id = v_club_id;
  if v_caller_member_id is null then
    raise exception 'Kein Mitglied dieses Clubs';
  end if;

  if p_member_id <> v_caller_member_id and v_caller_role not in ('admin', 'kassierer') then
    raise exception 'Nur Admin/Kassierer dürfen für andere Mitglieder einchecken';
  end if;

  insert into attendance (event_id, member_id, checked_in_at)
  values (p_event_id, p_member_id, p_checked_in_at)
  on conflict (event_id, member_id) do update set checked_in_at = excluded.checked_in_at
  returning id into v_attendance_id;

  delete from transaction where late_checkin_attendance_id = v_attendance_id;

  if p_checked_in_at is not null and p_checked_in_at > v_starts_at then
    select late_penalty_mode, late_penalty_cents, late_penalty_interval_minutes, late_penalty_interval_cents
      into v_mode, v_flat_cents, v_interval_minutes, v_interval_cents
      from club where id = v_club_id;

    v_late_minutes := ceil(extract(epoch from (p_checked_in_at - v_starts_at)) / 60);

    if v_mode = 'pauschal' and v_flat_cents is not null and v_flat_cents > 0 then
      v_fee_cents := v_flat_cents;
    elsif v_mode = 'intervall' and v_interval_minutes is not null and v_interval_cents is not null and v_interval_cents > 0 then
      v_fee_cents := ceil(v_late_minutes::numeric / v_interval_minutes) * v_interval_cents;
    end if;

    if v_fee_cents > 0 then
      insert into transaction (club_id, member_id, event_id, type, amount_cents, note, late_checkin_attendance_id)
      values (
        v_club_id, p_member_id, p_event_id, 'strafe', v_fee_cents,
        'Verspätung ' || v_late_minutes || ' Min.', v_attendance_id
      );
    end if;
  end if;
end;
$$;

revoke all on function check_in(uuid, uuid, timestamptz) from public;
grant execute on function check_in(uuid, uuid, timestamptz) to authenticated;
