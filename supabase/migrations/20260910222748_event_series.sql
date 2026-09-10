-- ============================================================
-- Migration: event_series
-- Regeltermine / Serien-Kegelabende: wiederkehrende Termine
-- (wöchentlich alle N Wochen, oder monatlich am n-ten Wochentag,
-- z.B. "jeden ersten Freitag im Monat"). Einzelne Termine der Serie
-- können danach unabhängig verschoben oder abgesagt werden, ohne die
-- restliche Serie zu beeinflussen (Ausnahme-Muster wie in
-- Kalender-Apps).
-- ============================================================

create table event_series (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references club(id) on delete cascade,
  title text not null,
  location text,
  frequency text not null check (frequency in ('woechentlich', 'monatlich')),
  interval_weeks integer not null default 1 check (interval_weeks > 0),
  weekday integer not null check (weekday between 1 and 7), -- ISO: 1=Montag..7=Sonntag
  monthly_occurrence integer check (monthly_occurrence between 1 and 5),
  time_of_day time not null,
  starts_on date not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  check (frequency <> 'monatlich' or monthly_occurrence is not null)
);

-- Jeder generierte Termin trägt die Serie + sein ursprünglich
-- geplantes Datum (`series_occurrence_date`), getrennt von `starts_at`
-- (das kann später verschoben werden). Der Generator prüft nur gegen
-- `series_occurrence_date`, nie gegen `starts_at` – so wird eine
-- bereits verschobene/abgesagte Ausnahme nicht durch einen erneuten
-- Lauf des Generators dupliziert oder überschrieben.
alter table event add column series_id uuid references event_series(id) on delete set null;
alter table event add column series_occurrence_date date;
alter table event add column series_overridden boolean not null default false;
comment on column event.series_overridden is
  'true, wenn dieser einzelne Serientermin manuell verschoben oder abgesagt wurde (weicht von der Serie ab).';

create unique index event_series_occurrence_unique
  on event (series_id, series_occurrence_date)
  where series_id is not null;

alter table event_series enable row level security;

create policy "event_series_select_same_club"
  on event_series for select
  using (club_id in (select auth_club_ids()));

create policy "event_series_write_staff"
  on event_series for all
  using (club_id in (select auth_staff_club_ids()))
  with check (club_id in (select auth_staff_club_ids()));

-- ============================================================
-- Erzeugt fehlende Termine einer Serie bis zu einem Stichtag.
-- Idempotent: bereits existierende Vorkommen (per series_occurrence_date)
-- werden übersprungen, egal ob sie noch dem Standard-Slot entsprechen
-- oder als Ausnahme verschoben/abgesagt wurden.
-- ============================================================
create or replace function generate_series_events(p_series_id uuid, p_until date)
returns integer
language plpgsql
security definer
set search_path = public
as $$
declare
  v_series event_series;
  v_cursor date;
  v_candidate date;
  v_created integer := 0;
begin
  if auth.uid() is null then
    raise exception 'Nicht eingeloggt';
  end if;

  select * into v_series from event_series where id = p_series_id;
  if v_series.id is null then
    raise exception 'Serie nicht gefunden';
  end if;

  if not exists (
    select 1 from member
    where user_id = auth.uid() and club_id = v_series.club_id and role in ('admin', 'kassierer')
  ) then
    raise exception 'Nur Admin/Kassierer dürfen Serientermine erzeugen';
  end if;

  if not v_series.active then
    return 0;
  end if;

  if v_series.frequency = 'woechentlich' then
    v_candidate := v_series.starts_on;
    while extract(isodow from v_candidate)::int <> v_series.weekday loop
      v_candidate := v_candidate + 1;
    end loop;

    while v_candidate <= p_until loop
      insert into event (club_id, type, title, starts_at, location, series_id, series_occurrence_date)
      values (
        v_series.club_id, 'kegelabend', v_series.title,
        (v_candidate + v_series.time_of_day)::timestamptz, v_series.location,
        v_series.id, v_candidate
      )
      on conflict (series_id, series_occurrence_date) where series_id is not null do nothing;

      if found then
        v_created := v_created + 1;
      end if;

      v_candidate := v_candidate + (v_series.interval_weeks * 7);
    end loop;
  else
    v_cursor := date_trunc('month', v_series.starts_on)::date;

    while v_cursor <= p_until loop
      v_candidate := v_cursor;
      while extract(isodow from v_candidate)::int <> v_series.weekday loop
        v_candidate := v_candidate + 1;
      end loop;
      v_candidate := v_candidate + (v_series.monthly_occurrence - 1) * 7;

      if extract(month from v_candidate) <> extract(month from v_cursor) then
        v_candidate := null; -- Monat hat kein n-tes Vorkommen dieses Wochentags
      end if;

      if v_candidate is not null and v_candidate >= v_series.starts_on and v_candidate <= p_until then
        insert into event (club_id, type, title, starts_at, location, series_id, series_occurrence_date)
        values (
          v_series.club_id, 'kegelabend', v_series.title,
          (v_candidate + v_series.time_of_day)::timestamptz, v_series.location,
          v_series.id, v_candidate
        )
        on conflict (series_id, series_occurrence_date) where series_id is not null do nothing;

        if found then
          v_created := v_created + 1;
        end if;
      end if;

      v_cursor := v_cursor + interval '1 month';
    end loop;
  end if;

  return v_created;
end;
$$;

revoke all on function generate_series_events(uuid, date) from public;
grant execute on function generate_series_events(uuid, date) to authenticated;

-- ============================================================
-- Legt die Serie an und erzeugt direkt die ersten 6 Monate an
-- Terminen, damit nach dem Anlegen sofort etwas in der Terminliste
-- steht (statt auf den nächsten "Weitere Termine generieren"-Lauf
-- warten zu müssen).
-- ============================================================
create or replace function create_event_series(
  p_title text,
  p_location text,
  p_frequency text,
  p_interval_weeks integer,
  p_weekday integer,
  p_monthly_occurrence integer,
  p_time_of_day time,
  p_starts_on date
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_club_id uuid;
  v_series_id uuid;
begin
  if auth.uid() is null then
    raise exception 'Nicht eingeloggt';
  end if;

  select club_id into v_club_id from member
    where user_id = auth.uid() and role in ('admin', 'kassierer')
    limit 1;

  if v_club_id is null then
    raise exception 'Nur Admin/Kassierer dürfen Regeltermine anlegen';
  end if;

  insert into event_series (
    club_id, title, location, frequency, interval_weeks, weekday,
    monthly_occurrence, time_of_day, starts_on
  )
  values (
    v_club_id, p_title, p_location, p_frequency, coalesce(p_interval_weeks, 1), p_weekday,
    p_monthly_occurrence, p_time_of_day, p_starts_on
  )
  returning id into v_series_id;

  perform generate_series_events(v_series_id, p_starts_on + interval '6 months');

  return v_series_id;
end;
$$;

revoke all on function create_event_series(text, text, text, integer, integer, integer, time, date) from public;
grant execute on function create_event_series(text, text, text, integer, integer, integer, time, date) to authenticated;
