-- ============================================================
-- Migration: freitext_game
-- Dritter Spieltyp "Freitext": kein Ranking/Formel, sondern ein
-- freier Beschreibungstext fürs Spiel plus frei eingegebene Strafe
-- pro Mitglied (auch 0€ = teilgenommen, keine Strafe möglich).
-- `score.pins` wird für diesen Typ als Strafe in Cent zweckentfremdet
-- (statt Hausnummer-Ziffern) – vermeidet eine weitere Tabelle nur für
-- diesen simplen Fall.
-- ============================================================

alter table game drop constraint game_type_check;
alter table game add constraint game_type_check
  check (type in ('kleine_hausnummer', 'grosse_hausnummer', 'freitext')) not valid;

alter table game add column description text;
comment on column game.description is
  'Freitext-Beschreibung des Spiels, nur bei type = freitext gesetzt.';

-- Ergebniserfassung + automatische Kegelkasse fürs Freitext-Spiel:
-- kein Rang/keine Formel, Strafe wird direkt pro Mitglied übergeben.
create or replace function book_freitext_game(
  p_club_id uuid,
  p_event_id uuid,
  p_game_id uuid,
  p_penalties jsonb
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_fee_cents integer;
  v_item jsonb;
  v_member_id uuid;
  v_amount integer;
begin
  select kegelgeld_cents into v_fee_cents from club where id = p_club_id;

  for v_item in select * from jsonb_array_elements(p_penalties)
  loop
    v_member_id := (v_item ->> 'member_id')::uuid;
    v_amount := (v_item ->> 'amount_cents')::integer;

    insert into score (club_id, game_id, member_id, pins)
    values (p_club_id, p_game_id, v_member_id, v_amount);

    if v_fee_cents > 0 then
      insert into transaction (club_id, member_id, event_id, game_id, type, amount_cents)
      values (p_club_id, v_member_id, p_event_id, p_game_id, 'kegelgeld', v_fee_cents)
      on conflict (event_id, member_id) where type = 'kegelgeld' and event_id is not null do nothing;
    end if;

    if v_amount > 0 then
      insert into transaction (club_id, member_id, event_id, game_id, type, amount_cents, note)
      values (p_club_id, v_member_id, p_event_id, p_game_id, 'strafe', v_amount, 'Freitext-Strafe')
      on conflict (game_id, member_id, type) where game_id is not null do nothing;
    end if;
  end loop;
end;
$$;

create or replace function record_freitext_game(
  p_event_id uuid,
  p_description text,
  p_penalties jsonb
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

  insert into game (club_id, event_id, type, description)
  values (v_club_id, p_event_id, 'freitext', p_description)
  returning id into v_game_id;

  perform book_freitext_game(v_club_id, p_event_id, v_game_id, p_penalties);

  return v_game_id;
end;
$$;

create or replace function update_freitext_game(
  p_game_id uuid,
  p_description text,
  p_penalties jsonb
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

  update game set description = p_description where id = p_game_id;

  perform book_freitext_game(v_club_id, v_event_id, p_game_id, p_penalties);

  return p_game_id;
end;
$$;

revoke all on function record_freitext_game(uuid, text, jsonb) from public;
grant execute on function record_freitext_game(uuid, text, jsonb) to authenticated;

revoke all on function update_freitext_game(uuid, text, jsonb) from public;
grant execute on function update_freitext_game(uuid, text, jsonb) to authenticated;
