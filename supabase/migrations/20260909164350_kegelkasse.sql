-- ============================================================
-- Migration: kegelkasse
-- Kassenbuch (`transaction`) + automatische Buchung von Kegelgeld
-- direkt bei der Ergebniserfassung.
-- ============================================================

alter table club add column kegelgeld_cents integer not null default 200
  check (kegelgeld_cents >= 0);
comment on column club.kegelgeld_cents is
  'Kegelgeld in Cent, das pro Teilnahme an einem erfassten Spiel automatisch in die Kasse eingezahlt wird.';

create table transaction (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references club(id) on delete cascade,
  member_id uuid references member(id) on delete cascade,
  event_id uuid references event(id) on delete set null,
  game_id uuid references game(id) on delete set null,
  type text not null check (type in ('einzahlung', 'ausgabe', 'strafe', 'gutschrift')),
  amount_cents integer not null check (amount_cents > 0),
  note text,
  created_at timestamptz not null default now()
);

-- Verhindert doppelte automatische Kegelgeld-Buchungen pro Mitglied
-- und Spiel (z.B. bei versehentlichem doppeltem Aufruf der RPC).
create unique index transaction_game_member_unique
  on transaction (game_id, member_id)
  where game_id is not null;

alter table transaction enable row level security;

-- Jeder sieht nur seine eigenen Buchungen (Kontostand ist
-- personenbezogen/sensibel, siehe DSGVO-Hinweise in CLAUDE.md).
create policy "transaction_select_own"
  on transaction for select
  using (member_id in (select auth_member_ids()));

-- Admin/Kassierer sehen alle Buchungen ihres Clubs (Kassenführung).
create policy "transaction_select_staff"
  on transaction for select
  using (club_id in (select auth_staff_club_ids()));

-- Manuelle Buchungen (z.B. Bareinzahlung, Ausgabe) dürfen nur
-- Admin/Kassierer anlegen.
create policy "transaction_write_staff"
  on transaction for all
  using (club_id in (select auth_staff_club_ids()))
  with check (club_id in (select auth_staff_club_ids()));

-- ============================================================
-- Ergebniserfassung + automatische Kegelkasse in einem Schritt:
-- legt ein game an, speichert die Scores und bucht pro Mitglied
-- mit Score automatisch das Kegelgeld als Einzahlung.
-- security definer, damit die automatische Buchung nicht an der
-- (bewusst engen) transaction-Policy scheitert.
-- ============================================================

create or replace function record_game_scores(p_event_id uuid, p_type text, p_scores jsonb)
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
      on conflict (game_id, member_id) where game_id is not null do nothing;
    end if;
  end loop;

  return v_game_id;
end;
$$;

revoke all on function record_game_scores(uuid, text, jsonb) from public;
grant execute on function record_game_scores(uuid, text, jsonb) to authenticated;
