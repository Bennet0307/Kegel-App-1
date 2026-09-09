-- ============================================================
-- Migration: edit_delete_game_scores
-- Ergebnisse nachträglich bearbeiten/löschen. Bisher legte
-- record_game_scores bei jedem Aufruf ein neues `game` an; es gab
-- keine Möglichkeit, ein bereits erfasstes Ergebnis zu korrigieren
-- oder zu löschen (inkl. der zugehörigen automatischen Buchungen).
--
-- Die eigentliche Buchungslogik (Kegelgeld + Hausnummer-Strafe nach
-- Platzierung) wird in die neue Hilfsfunktion book_game_scores()
-- ausgelagert, damit record_game_scores (anlegen) und
-- update_game_scores (bearbeiten) nicht denselben nicht-trivialen
-- Rang-Algorithmus doppelt pflegen müssen.
-- ============================================================

create or replace function book_game_scores(
  p_club_id uuid,
  p_event_id uuid,
  p_game_id uuid,
  p_type text,
  p_scores jsonb,
  p_penalty_schedule_cents integer[]
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_fee_cents integer;
  v_item jsonb;
  v_schedule integer[];
  v_rank_row record;
  v_penalty_cents integer;
begin
  select kegelgeld_cents into v_fee_cents from club where id = p_club_id;

  for v_item in select * from jsonb_array_elements(p_scores)
  loop
    insert into score (club_id, game_id, member_id, pins)
    values (p_club_id, p_game_id, (v_item ->> 'member_id')::uuid, (v_item ->> 'pins')::integer);

    if v_fee_cents > 0 then
      insert into transaction (club_id, member_id, event_id, game_id, type, amount_cents, note)
      values (p_club_id, (v_item ->> 'member_id')::uuid, p_event_id, p_game_id, 'einzahlung', v_fee_cents, 'Kegelgeld')
      on conflict (game_id, member_id, type) where game_id is not null do nothing;
    end if;
  end loop;

  if p_type in ('kleine_hausnummer', 'grosse_hausnummer') then
    select coalesce(p_penalty_schedule_cents, hausnummer_penalty_schedule_cents)
      into v_schedule
      from club where id = p_club_id;

    update game set penalty_schedule_cents = v_schedule where id = p_game_id;

    for v_rank_row in (
      select member_id,
        rank() over (
          order by pins * (case when p_type = 'grosse_hausnummer' then 1 else -1 end) asc
        ) as rank_from_loser
      from score
      where game_id = p_game_id
    )
    loop
      v_penalty_cents := case
        when v_rank_row.rank_from_loser <= coalesce(array_length(v_schedule, 1), 0)
          then v_schedule[v_rank_row.rank_from_loser]
        else 0
      end;

      if v_penalty_cents > 0 then
        insert into transaction (club_id, member_id, event_id, game_id, type, amount_cents, note)
        values (p_club_id, v_rank_row.member_id, p_event_id, p_game_id, 'strafe', v_penalty_cents, 'Hausnummer-Strafe')
        on conflict (game_id, member_id, type) where game_id is not null do nothing;
      end if;
    end loop;
  end if;
end;
$$;

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

  insert into game (club_id, event_id, type)
  values (v_club_id, p_event_id, p_type)
  returning id into v_game_id;

  perform book_game_scores(v_club_id, p_event_id, v_game_id, p_type, p_scores, p_penalty_schedule_cents);

  return v_game_id;
end;
$$;

-- Bearbeiten: löscht die bisherigen Scores + Buchungen dieses Spiels
-- und bucht sie mit den neuen Werten frisch (Rang-abhängige Strafen
-- können sich durch die Korrektur für ALLE Mitglieder des Spiels
-- ändern, nicht nur für das bearbeitete).
create or replace function update_game_scores(
  p_game_id uuid,
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
  delete from score where game_id = p_game_id;

  update game set type = p_type, penalty_schedule_cents = null where id = p_game_id;

  perform book_game_scores(v_club_id, v_event_id, p_game_id, p_type, p_scores, p_penalty_schedule_cents);

  return p_game_id;
end;
$$;

revoke all on function update_game_scores(uuid, text, jsonb, integer[]) from public;
grant execute on function update_game_scores(uuid, text, jsonb, integer[]) to authenticated;

-- Löschen: entfernt ein Spiel inkl. aller zugehörigen Buchungen
-- (transaction.game_id ist "on delete set null", würde also sonst
-- verwaiste, aber weiterhin gültige Kegelgeld-/Strafe-Buchungen
-- zurücklassen).
create or replace function delete_game(p_game_id uuid)
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

  select club_id into v_club_id from game where id = p_game_id;
  if v_club_id is null then
    raise exception 'Spiel nicht gefunden';
  end if;

  if not exists (
    select 1 from member
    where user_id = auth.uid() and club_id = v_club_id and role in ('admin', 'kassierer')
  ) then
    raise exception 'Nur Admin/Kassierer dürfen Ergebnisse löschen';
  end if;

  delete from transaction where game_id = p_game_id;
  delete from game where id = p_game_id;
end;
$$;

revoke all on function delete_game(uuid) from public;
grant execute on function delete_game(uuid) to authenticated;
