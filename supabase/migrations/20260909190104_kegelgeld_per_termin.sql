-- ============================================================
-- Migration: kegelgeld_per_termin
-- Kegelgeld war bisher pro `game` fällig, nicht pro `event`
-- ("Termin"): wenn an einem Kegelabend mehrere Spiele erfasst
-- wurden (z.B. Kleine und Große Hausnummer am selben Abend), wurde
-- das Kegelgeld pro Mitglied mehrfach gebucht. Soll stattdessen
-- genau einmal pro Termin anfallen, unabhängig davon, wie viele
-- Spiele an dem Abend erfasst werden.
--
-- Eigener Typ 'kegelgeld' statt 'einzahlung' + Text-Note "Kegelgeld":
-- so kann die Eindeutigkeit gezielt nur für die automatische
-- Teilnahmegebühr auf event_id statt game_id begrenzt werden, ohne
-- normale manuelle Bareinzahlungen (weiterhin 'einzahlung') zu
-- beeinflussen, die durchaus mehrfach pro Termin vorkommen dürfen.
-- ============================================================

alter table transaction drop constraint transaction_type_check;
alter table transaction add constraint transaction_type_check
  check (type in ('einzahlung', 'ausgabe', 'strafe', 'gutschrift', 'kegelgeld'));

create unique index transaction_event_member_kegelgeld_unique
  on transaction (event_id, member_id)
  where type = 'kegelgeld' and event_id is not null;

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
      insert into transaction (club_id, member_id, event_id, game_id, type, amount_cents)
      values (p_club_id, (v_item ->> 'member_id')::uuid, p_event_id, p_game_id, 'kegelgeld', v_fee_cents)
      on conflict (event_id, member_id) where type = 'kegelgeld' and event_id is not null do nothing;
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
