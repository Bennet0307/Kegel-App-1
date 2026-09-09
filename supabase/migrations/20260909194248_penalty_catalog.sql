-- ============================================================
-- Migration: penalty_catalog
-- Freier Strafenkatalog pro Club (z.B. "Pumpe", "Klingen") mit
-- Name + Betrag. Erfassung pro Termin (event, nicht game): pro
-- Mitglied wird gezählt, wie oft welche Strafart an diesem
-- Kegelabend fällig wurde.
--
-- Name/Betrag werden bei jeder Buchung als Snapshot in `penalty`
-- kopiert, damit spätere Änderungen am Katalog (oder Löschen einer
-- Strafart) alte Buchungen nicht nachträglich verändern.
-- ============================================================

create table penalty_rule (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references club(id) on delete cascade,
  name text not null,
  amount_cents integer not null check (amount_cents >= 0),
  created_at timestamptz not null default now()
);

create table penalty (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references club(id) on delete cascade,
  event_id uuid not null references event(id) on delete cascade,
  member_id uuid not null references member(id) on delete cascade,
  penalty_rule_id uuid references penalty_rule(id) on delete set null,
  rule_name text not null,
  unit_amount_cents integer not null check (unit_amount_cents >= 0),
  count integer not null check (count > 0),
  created_at timestamptz not null default now(),
  unique (event_id, member_id, penalty_rule_id)
);

-- Jede Strafen-Buchung erzeugt automatisch die passende
-- Kassenbuch-Zeile; über penalty_id verknüpft, damit beim erneuten
-- Erfassen eines Termins (record_event_penalties) einfach alle
-- bisherigen penalty-Zeilen dieses Termins gelöscht werden können
-- und die zugehörigen transaction-Zeilen automatisch mitgelöscht
-- werden (on delete cascade).
alter table transaction add column penalty_id uuid references penalty(id) on delete cascade;

alter table penalty_rule enable row level security;
alter table penalty enable row level security;

create policy "penalty_rule_select_same_club"
  on penalty_rule for select
  using (club_id in (select auth_club_ids()));

create policy "penalty_rule_write_staff"
  on penalty_rule for all
  using (club_id in (select auth_staff_club_ids()))
  with check (club_id in (select auth_staff_club_ids()));

create policy "penalty_select_same_club"
  on penalty for select
  using (club_id in (select auth_club_ids()));

create policy "penalty_write_staff"
  on penalty for all
  using (club_id in (select auth_staff_club_ids()))
  with check (club_id in (select auth_staff_club_ids()));

-- Ergebniserfassung für einen Termin: ersetzt (löscht + bucht neu)
-- alle Strafenkatalog-Buchungen dieses Events in einem Schritt, egal
-- ob erstes Erfassen oder Korrektur. Bewusst kein Kegelgeld hier –
-- das bleibt an die Spiel-Teilnahme (record_game_scores/
-- record_freitext_game) gebunden, nicht an Strafenkatalog-Einträge.
create or replace function record_event_penalties(p_event_id uuid, p_penalties jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_club_id uuid;
  v_item jsonb;
  v_member_id uuid;
  v_rule_id uuid;
  v_count integer;
  v_rule_name text;
  v_unit_amount integer;
  v_penalty_id uuid;
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
    raise exception 'Nur Admin/Kassierer dürfen Strafen erfassen';
  end if;

  delete from penalty where event_id = p_event_id;

  for v_item in select * from jsonb_array_elements(p_penalties)
  loop
    v_member_id := (v_item ->> 'member_id')::uuid;
    v_rule_id := (v_item ->> 'penalty_rule_id')::uuid;
    v_count := (v_item ->> 'count')::integer;

    select name, amount_cents into v_rule_name, v_unit_amount
      from penalty_rule where id = v_rule_id and club_id = v_club_id;

    if v_rule_name is null then
      raise exception 'Strafart nicht gefunden';
    end if;

    insert into penalty (club_id, event_id, member_id, penalty_rule_id, rule_name, unit_amount_cents, count)
    values (v_club_id, p_event_id, v_member_id, v_rule_id, v_rule_name, v_unit_amount, v_count)
    returning id into v_penalty_id;

    if v_unit_amount * v_count > 0 then
      insert into transaction (club_id, member_id, event_id, type, amount_cents, note, penalty_id)
      values (v_club_id, v_member_id, p_event_id, 'strafe', v_unit_amount * v_count,
        v_rule_name || ' ×' || v_count, v_penalty_id);
    end if;
  end loop;
end;
$$;

revoke all on function record_event_penalties(uuid, jsonb) from public;
grant execute on function record_event_penalties(uuid, jsonb) to authenticated;
