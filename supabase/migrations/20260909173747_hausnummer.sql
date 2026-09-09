-- ============================================================
-- Migration: hausnummer
-- Ersetzt die bisherigen (funktionslosen) Spieltypen
-- "punktekegeln"/"bundeskegeln" durch zwei echte Spiele:
--
-- Kleine/Große Hausnummer: jedes Mitglied wirft 3x (0-9 Kegel je
-- Wurf) und ordnet die Ergebnisse in ein Muster _ _ _ (Hunderter/
-- Zehner/Einer) ein. Bei "großer Hausnummer" gewinnt die größte,
-- bei "kleiner Hausnummer" die kleinste entstandene Zahl. Die
-- 3-stellige Zahl wird weiterhin einfach in `score.pins` gespeichert
-- (0-999) – kein Schema-Änderung an `score` nötig.
--
-- Die Anordnung der 3 Würfe auf die Positionen passiert am
-- Kegelabend selbst (das ist der strategische Teil des Spiels);
-- die App erfasst nachträglich nur das fertige Ergebnis pro
-- Mitglied, analog zu den bisherigen Spielen.
--
-- Zusätzlich: Strafgebühr gestaffelt nach Platzierung, absteigend
-- vom Verlierer (höchste bzw. niedrigste Hausnummer, je nach
-- Spielart) immer kleiner werdend. Frei definierbar: Standardwert
-- pro Club (`club.hausnummer_penalty_schedule_cents`), pro Termin
-- überschreibbar (Parameter an `record_game_scores`, Snapshot in
-- `game.penalty_schedule_cents`).
-- ============================================================

-- Bestehende Alt-Daten (falls vorhanden) bleiben unangetastet;
-- NOT VALID sorgt dafür, dass nur neue/geänderte Zeilen die neue
-- Regel einhalten müssen, ohne die Migration an alten Testzeilen
-- scheitern zu lassen.
alter table game drop constraint game_type_check;
alter table game add constraint game_type_check
  check (type in ('kleine_hausnummer', 'grosse_hausnummer')) not valid;

alter table game alter column type drop default;

alter table game add column penalty_schedule_cents integer[];
comment on column game.penalty_schedule_cents is
  'Snapshot der tatsächlich verwendeten Strafstaffel (Cent-Beträge, Index 1 = Verlierer). Nur bei Hausnummer-Spielen gesetzt.';

alter table club add column hausnummer_penalty_schedule_cents integer[] not null default '{50,30,20,10}';
comment on column club.hausnummer_penalty_schedule_cents is
  'Standard-Strafstaffel für Hausnummer-Spiele in Cent, Index 1 = Verlierer (höchste bzw. niedrigste Hausnummer), absteigend. Ränge ohne Eintrag zahlen nichts. Pro Termin überschreibbar.';

-- Idempotenz-Schutz bisher (game_id, member_id) erlaubte nur EINE
-- Buchung pro Mitglied und Spiel – Hausnummer-Spiele brauchen aber
-- zwei (Kegelgeld-Einzahlung UND Strafe). Ersetzt durch Unique auf
-- (game_id, member_id, type).
drop index transaction_game_member_unique;
create unique index transaction_game_member_type_unique
  on transaction (game_id, member_id, type)
  where game_id is not null;

-- Alte 3-Parameter-Signatur entfernen, sonst existiert sie als
-- eigene Überladung neben der neuen 4-Parameter-Version weiter und
-- würde bei 3-Argument-Aufrufen weiterhin verwendet.
drop function if exists record_game_scores(uuid, text, jsonb);

create or replace function record_game_scores(
  p_event_id uuid,
  p_type text,
  p_scores jsonb,
  p_penalty_schedule_cents integer[] default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_club_id uuid;
  v_game_id uuid;
  v_fee_cents integer;
  v_item jsonb;
  v_schedule integer[];
  v_rank_row record;
  v_penalty_cents integer;
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

  select kegelgeld_cents into v_fee_cents from club where id = v_club_id;

  insert into game (club_id, event_id, type)
  values (v_club_id, p_event_id, p_type)
  returning id into v_game_id;

  for v_item in select * from jsonb_array_elements(p_scores)
  loop
    insert into score (club_id, game_id, member_id, pins)
    values (v_club_id, v_game_id, (v_item ->> 'member_id')::uuid, (v_item ->> 'pins')::integer);

    if v_fee_cents > 0 then
      insert into transaction (club_id, member_id, event_id, game_id, type, amount_cents, note)
      values (v_club_id, (v_item ->> 'member_id')::uuid, p_event_id, v_game_id, 'einzahlung', v_fee_cents, 'Kegelgeld')
      on conflict (game_id, member_id, type) where game_id is not null do nothing;
    end if;
  end loop;

  if p_type in ('kleine_hausnummer', 'grosse_hausnummer') then
    select coalesce(p_penalty_schedule_cents, hausnummer_penalty_schedule_cents)
      into v_schedule
      from club where id = v_club_id;

    update game set penalty_schedule_cents = v_schedule where id = v_game_id;

    for v_rank_row in (
      select member_id,
        rank() over (
          order by pins * (case when p_type = 'grosse_hausnummer' then 1 else -1 end) asc
        ) as rank_from_loser
      from score
      where game_id = v_game_id
    )
    loop
      v_penalty_cents := case
        when v_rank_row.rank_from_loser <= coalesce(array_length(v_schedule, 1), 0)
          then v_schedule[v_rank_row.rank_from_loser]
        else 0
      end;

      if v_penalty_cents > 0 then
        insert into transaction (club_id, member_id, event_id, game_id, type, amount_cents, note)
        values (v_club_id, v_rank_row.member_id, p_event_id, v_game_id, 'strafe', v_penalty_cents, 'Hausnummer-Strafe')
        on conflict (game_id, member_id, type) where game_id is not null do nothing;
      end if;
    end loop;
  end if;

  return v_game_id;
end;
$$;

revoke all on function record_game_scores(uuid, text, jsonb, integer[]) from public;
grant execute on function record_game_scores(uuid, text, jsonb, integer[]) to authenticated;
