-- ============================================================
-- Migration: delete_event
-- Termine löschen. `game`, `attendance` und `penalty` sind bereits
-- "on delete cascade" an `event` gebunden (Migration 8/17), aber
-- `transaction.event_id` ist bewusst "on delete set null" (Migration 9,
-- damit ein gelöschtes Event historische Kassenbuchungen nicht
-- automatisch mitreißt, falls sie noch gebraucht werden) – ein reines
-- `delete from event` würde deshalb verwaiste, aber weiterhin gültige
-- Kegelgeld-/Strafe-Buchungen zurücklassen, die in der Kasse
-- fälschlich weiterzählen. Analog zu delete_game() (Migration 11)
-- löscht diese RPC deshalb zuerst explizit alle `transaction`-Zeilen
-- dieses Termins.
-- ============================================================

create or replace function delete_event(p_event_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_club_id uuid;
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
    raise exception 'Nur Admin/Kassierer dürfen Termine löschen';
  end if;

  delete from transaction where event_id = p_event_id;
  delete from event where id = p_event_id;
end;
$$;

revoke all on function delete_event(uuid) from public;
grant execute on function delete_event(uuid) to authenticated;
