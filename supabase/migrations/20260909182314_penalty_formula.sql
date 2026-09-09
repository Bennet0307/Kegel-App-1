-- ============================================================
-- Migration: penalty_formula
-- Ersetzt die kommagetrennte Strafstaffel (integer[], anfällig für
-- die Dezimalkomma-/Listentrenner-Kollision) durch eine einfache
-- Formel: Maximalbetrag für den Verlierer, danach pro besserem Rang
-- eine feste (€) oder prozentuale Reduzierung, bis 0.
-- ============================================================

alter table club drop column hausnummer_penalty_schedule_cents;

alter table club add column hausnummer_penalty_max_cents integer not null default 50
  check (hausnummer_penalty_max_cents >= 0);
alter table club add column hausnummer_penalty_mode text not null default 'fest'
  check (hausnummer_penalty_mode in ('fest', 'prozent'));
alter table club add column hausnummer_penalty_step_cents integer not null default 10
  check (hausnummer_penalty_step_cents >= 0);
alter table club add column hausnummer_penalty_step_percent numeric not null default 20
  check (hausnummer_penalty_step_percent >= 0 and hausnummer_penalty_step_percent <= 100);

comment on column club.hausnummer_penalty_max_cents is
  'Strafe des Verlierers (schlechtester Rang) in Cent.';
comment on column club.hausnummer_penalty_mode is
  'Wie sich die Strafe pro besserem Rang reduziert: "fest" (Cent-Betrag) oder "prozent".';
comment on column club.hausnummer_penalty_step_cents is
  'Reduzierung pro besserem Rang in Cent, nur bei mode = fest.';
comment on column club.hausnummer_penalty_step_percent is
  'Reduzierung pro besserem Rang in Prozent, nur bei mode = prozent.';

alter table game drop column penalty_schedule_cents;

alter table game add column penalty_max_cents integer;
alter table game add column penalty_mode text;
alter table game add column penalty_step_cents integer;
alter table game add column penalty_step_percent numeric;
comment on column game.penalty_max_cents is
  'Snapshot der tatsächlich verwendeten Strafformel (nur bei Hausnummer-Spielen gesetzt).';

drop function book_game_scores(uuid, uuid, uuid, text, jsonb, integer[]);
drop function record_game_scores(uuid, text, jsonb, integer[]);
drop function update_game_scores(uuid, text, jsonb, integer[]);

create or replace function book_game_scores(
  p_club_id uuid,
  p_event_id uuid,
  p_game_id uuid,
  p_type text,
  p_scores jsonb,
  p_penalty_max_cents integer,
  p_penalty_mode text,
  p_penalty_step_cents integer,
  p_penalty_step_percent numeric
)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_fee_cents integer;
  v_item jsonb;
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
    update game
      set penalty_max_cents = p_penalty_max_cents,
          penalty_mode = p_penalty_mode,
          penalty_step_cents = p_penalty_step_cents,
          penalty_step_percent = p_penalty_step_percent
      where id = p_game_id;

    for v_rank_row in (
      select member_id,
        rank() over (
          order by pins * (case when p_type = 'grosse_hausnummer' then 1 else -1 end) asc
        ) as rank_from_loser
      from score
      where game_id = p_game_id
    )
    loop
      if p_penalty_mode = 'prozent' then
        v_penalty_cents := round(
          p_penalty_max_cents * power(1 - p_penalty_step_percent / 100.0, v_rank_row.rank_from_loser - 1)
        )::integer;
      else
        v_penalty_cents := greatest(
          p_penalty_max_cents - (v_rank_row.rank_from_loser - 1) * p_penalty_step_cents,
          0
        );
      end if;

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
  p_penalty_max_cents integer,
  p_penalty_mode text,
  p_penalty_step_cents integer,
  p_penalty_step_percent numeric
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

  perform book_game_scores(
    v_club_id, p_event_id, v_game_id, p_type, p_scores,
    p_penalty_max_cents, p_penalty_mode, p_penalty_step_cents, p_penalty_step_percent
  );

  return v_game_id;
end;
$$;

create or replace function update_game_scores(
  p_game_id uuid,
  p_type text,
  p_scores jsonb,
  p_penalty_max_cents integer,
  p_penalty_mode text,
  p_penalty_step_cents integer,
  p_penalty_step_percent numeric
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

  update game set type = p_type,
    penalty_max_cents = null, penalty_mode = null, penalty_step_cents = null, penalty_step_percent = null
    where id = p_game_id;

  perform book_game_scores(
    v_club_id, v_event_id, p_game_id, p_type, p_scores,
    p_penalty_max_cents, p_penalty_mode, p_penalty_step_cents, p_penalty_step_percent
  );

  return p_game_id;
end;
$$;

revoke all on function record_game_scores(uuid, text, jsonb, integer, text, integer, numeric) from public;
grant execute on function record_game_scores(uuid, text, jsonb, integer, text, integer, numeric) to authenticated;

revoke all on function update_game_scores(uuid, text, jsonb, integer, text, integer, numeric) from public;
grant execute on function update_game_scores(uuid, text, jsonb, integer, text, integer, numeric) to authenticated;
