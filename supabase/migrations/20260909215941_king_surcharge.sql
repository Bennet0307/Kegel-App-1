-- ============================================================
-- Migration: king_surcharge
-- "Pumpenkönig"-Zuschlag: eine Strafart im Katalog kann markiert
-- werden, dass zusätzlich ein Zuschlag für den "Abend-Verlierer"
-- dieser Strafart fällig wird (wer an diesem Kegelabend die meisten
-- Buchungen dieser einen Strafart hat, zahlt zusätzlich Betrag X).
--
-- Wird automatisch bei jedem Speichern von record_event_penalties neu
-- berechnet (kein separater "Abend abschließen"-Schritt), analog zum
-- bestehenden Replace-Muster. Gleichstand-Verhalten ist eine
-- Club-Einstellung (club.king_surcharge_tie_mode), da unterschiedliche
-- Clubs das unterschiedlich handhaben wollen.
-- ============================================================

alter table penalty_rule add column has_king_surcharge boolean not null default false;
alter table penalty_rule add column king_surcharge_cents integer not null default 0 check (king_surcharge_cents >= 0);

alter table club add column king_surcharge_tie_mode text not null default 'alle_zahlen'
  check (king_surcharge_tie_mode in ('alle_zahlen', 'keiner_zahlt', 'geteilt'));

-- Eigene Spalte statt Wiederverwendung von penalty_id: der Zuschlag ist
-- keine Zählbuchung (keine zugehörige `penalty`-Zeile), sondern eine
-- abgeleitete Summenbetrachtung über alle `penalty`-Zeilen eines
-- Termins+Strafart. Erlaubt gezieltes Löschen der alten
-- Zuschlag-Buchungen vor dem Neuberechnen, ohne die eigentlichen
-- Strafenkatalog-Buchungen (`penalty_id`) anzufassen.
alter table transaction add column king_surcharge_penalty_rule_id uuid references penalty_rule(id) on delete set null;

create or replace function record_event_penalties(p_event_id uuid, p_penalties jsonb)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_club_id uuid;
  v_tie_mode text;
  v_item jsonb;
  v_member_id uuid;
  v_rule_id uuid;
  v_count integer;
  v_rule_name text;
  v_unit_amount integer;
  v_penalty_id uuid;
  v_king_rule record;
  v_max_count integer;
  v_winner record;
  v_winner_count integer;
  v_share_cents integer;
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

  select king_surcharge_tie_mode into v_tie_mode from club where id = v_club_id;

  delete from penalty where event_id = p_event_id;
  delete from transaction where event_id = p_event_id and king_surcharge_penalty_rule_id is not null;

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

  -- Pumpenkönig-Zuschlag: pro Strafart mit has_king_surcharge neu
  -- berechnen, wer an diesem Termin die meisten Buchungen dieser
  -- Strafart hat.
  for v_king_rule in
    select id, name, king_surcharge_cents
    from penalty_rule
    where club_id = v_club_id and has_king_surcharge and king_surcharge_cents > 0
  loop
    select max(count) into v_max_count
      from penalty where event_id = p_event_id and penalty_rule_id = v_king_rule.id;

    if v_max_count is null or v_max_count <= 0 then
      continue;
    end if;

    select count(*) into v_winner_count
      from penalty where event_id = p_event_id and penalty_rule_id = v_king_rule.id and count = v_max_count;

    if v_winner_count > 1 and v_tie_mode = 'keiner_zahlt' then
      continue;
    end if;

    v_share_cents := case
      when v_winner_count > 1 and v_tie_mode = 'geteilt'
        then round(v_king_rule.king_surcharge_cents::numeric / v_winner_count)
      else v_king_rule.king_surcharge_cents
    end;

    if v_share_cents <= 0 then
      continue;
    end if;

    for v_winner in
      select member_id from penalty
      where event_id = p_event_id and penalty_rule_id = v_king_rule.id and count = v_max_count
    loop
      insert into transaction (
        club_id, member_id, event_id, type, amount_cents, note, king_surcharge_penalty_rule_id
      )
      values (
        v_club_id, v_winner.member_id, p_event_id, 'strafe', v_share_cents,
        'Pumpenkönig: ' || v_king_rule.name, v_king_rule.id
      );
    end loop;
  end loop;
end;
$$;

revoke all on function record_event_penalties(uuid, jsonb) from public;
grant execute on function record_event_penalties(uuid, jsonb) to authenticated;
