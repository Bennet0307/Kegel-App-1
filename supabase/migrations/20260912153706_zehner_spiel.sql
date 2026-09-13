-- ============================================================
-- Migration: zehner_spiel
-- Vierter Spieltyp "10er-Spiel": alle Mitglieder werfen reihum, die
-- Pins jedes einzelnen Wurfs werden auf eine gemeinsame laufende
-- Summe addiert. Jedes Mal, wenn diese Summe einen Zehnerwert (10,
-- 20, 30, …) erreicht oder überschreitet, wird eine nach Zehnerwert
-- gestaffelte Strafe fällig:
--   - genau getroffen (z.B. Stand 18, Wurf 2 -> genau 20): alle
--     Mitglieder AUSSER dem Werfer zahlen.
--   - drübergeworfen (z.B. Stand 18, Wurf 3 -> 21): NUR der Werfer
--     zahlt.
-- Da ein einzelner Wurf höchstens 9 Pins umwirft, kann pro Wurf
-- höchstens ein Zehnerwert ausgelöst werden. Erfassung ist bewusst
-- simpel gehalten: pro Zehnerwert wird nur Werfer + genau/drüber
-- eingetragen, nicht jeder einzelne Wurf aller Mitglieder.
-- ============================================================

alter table club add column zehner_max_pins integer not null default 300
  check (zehner_max_pins > 0);
alter table club add column zehner_step_cents integer not null default 10
  check (zehner_step_cents >= 0);
comment on column club.zehner_max_pins is
  'Standard-Maximalzahl an Pins fürs 10er-Spiel (Spiel endet, wenn die laufende Summe das erreicht/überschreitet).';
comment on column club.zehner_step_cents is
  'Standard-Schrittweite fürs 10er-Spiel: Strafe bei Zehnerwert N = (N/10) * zehner_step_cents.';

alter table game drop constraint game_type_check;
alter table game add constraint game_type_check
  check (type in ('kleine_hausnummer', 'grosse_hausnummer', 'freitext', 'zehner')) not valid;

alter table game add column zehner_max_pins integer;
alter table game add column zehner_step_cents integer;
comment on column game.zehner_max_pins is
  'Snapshot der beim 10er-Spiel verwendeten Maximalzahl/Schrittweite, nur bei type = zehner gesetzt.';

-- Ein Eintrag pro erreichtem Zehnerwert: wer geworfen hat und ob
-- genau getroffen oder drübergeworfen wurde. Reicht, um daraus die
-- komplette Strafenverteilung abzuleiten (siehe book_zehner_game).
create table zehner_milestone (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references club(id) on delete cascade,
  game_id uuid not null references game(id) on delete cascade,
  milestone integer not null check (milestone > 0 and milestone % 10 = 0),
  thrower_member_id uuid not null references member(id),
  hit_exact boolean not null,
  created_at timestamptz not null default now(),
  unique (game_id, milestone)
);

alter table zehner_milestone enable row level security;

create policy "zehner_milestone_select_same_club"
  on zehner_milestone for select
  using (club_id in (select auth_club_ids()));

create policy "zehner_milestone_write_staff"
  on zehner_milestone for all
  using (club_id in (select auth_staff_club_ids()))
  with check (club_id in (select auth_staff_club_ids()));

-- Bucht Kegelgeld (einmal pro Teilnehmer, "Teilnehmer" = jeder, der
-- laut den Meilenstein-Einträgen mindestens einmal geworfen hat) und
-- die Zehner-Strafen. Strafen werden dabei PRO MITGLIED AUFSUMMIERT
-- und als eine einzige 'strafe'-Buchung pro Mitglied gebucht (nicht
-- eine Buchung pro Zehnerwert) – zum einen für eine übersichtliche
-- Kassenbuch-Historie, zum anderen weil der bestehende Unique-Index
-- transaction_game_member_type_unique (game_id, member_id, type) pro
-- Spiel und Mitglied ohnehin nur eine 'strafe'-Zeile erlaubt.
create or replace function book_zehner_game(
  p_club_id uuid,
  p_event_id uuid,
  p_game_id uuid,
  p_step_cents integer,
  p_milestones jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_fee_cents integer;
  v_item jsonb;
begin
  select kegelgeld_cents into v_fee_cents from club where id = p_club_id;

  for v_item in select * from jsonb_array_elements(p_milestones)
  loop
    insert into zehner_milestone (club_id, game_id, milestone, thrower_member_id, hit_exact)
    values (
      p_club_id, p_game_id,
      (v_item ->> 'milestone')::integer,
      (v_item ->> 'thrower_member_id')::uuid,
      (v_item ->> 'hit_exact')::boolean
    );
  end loop;

  if v_fee_cents > 0 then
    insert into transaction (club_id, member_id, event_id, game_id, type, amount_cents)
    select p_club_id, m.member_id, p_event_id, p_game_id, 'kegelgeld', v_fee_cents
    from (select distinct thrower_member_id as member_id from zehner_milestone where game_id = p_game_id) m
    on conflict (event_id, member_id) where type = 'kegelgeld' and event_id is not null do nothing;
  end if;

  with participants as (
    select distinct thrower_member_id as member_id from zehner_milestone where game_id = p_game_id
  ),
  milestones as (
    select thrower_member_id, hit_exact, (milestone / 10) * p_step_cents as penalty_cents
    from zehner_milestone
    where game_id = p_game_id
  ),
  charges as (
    -- genau getroffen: alle Teilnehmer außer dem Werfer zahlen
    select p.member_id, ms.penalty_cents
    from milestones ms
    join participants p on p.member_id <> ms.thrower_member_id
    where ms.hit_exact and ms.penalty_cents > 0
    union all
    -- drübergeworfen: nur der Werfer zahlt
    select ms.thrower_member_id as member_id, ms.penalty_cents
    from milestones ms
    where not ms.hit_exact and ms.penalty_cents > 0
  )
  insert into transaction (club_id, member_id, event_id, game_id, type, amount_cents, note)
  select p_club_id, member_id, p_event_id, p_game_id, 'strafe', sum(penalty_cents), 'Strafen aus dem 10er-Spiel'
  from charges
  group by member_id
  having sum(penalty_cents) > 0;
end;
$$;

create or replace function record_zehner_game(
  p_event_id uuid,
  p_max_pins integer,
  p_step_cents integer,
  p_milestones jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_club_id uuid;
  v_game_id uuid;
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
    raise exception 'Nur Admin/Kassierer dürfen Ergebnisse erfassen';
  end if;

  insert into game (club_id, event_id, type, zehner_max_pins, zehner_step_cents)
  values (v_club_id, p_event_id, 'zehner', p_max_pins, p_step_cents)
  returning id into v_game_id;

  perform book_zehner_game(v_club_id, p_event_id, v_game_id, p_step_cents, p_milestones);

  return v_game_id;
end;
$$;

create or replace function update_zehner_game(
  p_game_id uuid,
  p_max_pins integer,
  p_step_cents integer,
  p_milestones jsonb
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_club_id uuid;
  v_event_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Nicht eingeloggt';
  end if;

  select club_id, event_id into v_club_id, v_event_id from game where id = p_game_id;
  if v_club_id is null then
    raise exception 'Spiel nicht gefunden';
  end if;

  if not exists (
    select 1 from member
    where user_id = auth.uid() and club_id = v_club_id and role in ('admin', 'kassierer')
  ) then
    raise exception 'Nur Admin/Kassierer dürfen Ergebnisse bearbeiten';
  end if;

  delete from transaction where game_id = p_game_id;
  delete from zehner_milestone where game_id = p_game_id;

  update game set zehner_max_pins = p_max_pins, zehner_step_cents = p_step_cents where id = p_game_id;

  perform book_zehner_game(v_club_id, v_event_id, p_game_id, p_step_cents, p_milestones);

  return p_game_id;
end;
$$;

revoke all on function record_zehner_game(uuid, integer, integer, jsonb) from public;
grant execute on function record_zehner_game(uuid, integer, integer, jsonb) to authenticated;

revoke all on function update_zehner_game(uuid, integer, integer, jsonb) from public;
grant execute on function update_zehner_game(uuid, integer, integer, jsonb) to authenticated;
