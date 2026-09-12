-- ============================================================
-- Migration: event_series_last_weekday
-- "Jeden letzten Freitag im Monat" ist NICHT dasselbe wie "jeden
-- fünften Freitag im Monat" – nicht jeder Monat hat einen fünften
-- Freitag, und in einem Monat mit nur vier Freitagen wäre "letzter"
-- gleichbedeutend mit "vierter". Bisher wurde monthly_occurrence rein
-- als "n-tes Vorkommen" (1–5) interpretiert, wodurch eine "letzter
-- Freitag"-Serie in jedem 4-Freitag-Monat komplett ausgefallen wäre.
-- monthly_occurrence = -1 ist jetzt ein eigener Modus "letztes
-- Vorkommen im Monat", der in JEDEM Monat garantiert genau einen
-- Treffer hat.
-- ============================================================

alter table event_series drop constraint if exists event_series_monthly_occurrence_check;
alter table event_series add constraint event_series_monthly_occurrence_check
  check (monthly_occurrence between 1 and 5 or monthly_occurrence = -1);

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
        (v_candidate + v_series.time_of_day) at time zone 'Europe/Berlin', v_series.location,
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
      if v_series.monthly_occurrence = -1 then
        -- Letztes Vorkommen: vom Monatsletzten rückwärts zum
        -- passenden Wochentag laufen. Existiert in jedem Monat.
        v_candidate := (v_cursor + interval '1 month' - interval '1 day')::date;
        while extract(isodow from v_candidate)::int <> v_series.weekday loop
          v_candidate := v_candidate - 1;
        end loop;
      else
        v_candidate := v_cursor;
        while extract(isodow from v_candidate)::int <> v_series.weekday loop
          v_candidate := v_candidate + 1;
        end loop;
        v_candidate := v_candidate + (v_series.monthly_occurrence - 1) * 7;

        if extract(month from v_candidate) <> extract(month from v_cursor) then
          v_candidate := null; -- Monat hat kein n-tes Vorkommen dieses Wochentags
        end if;
      end if;

      if v_candidate is not null and v_candidate >= v_series.starts_on and v_candidate <= p_until then
        insert into event (club_id, type, title, starts_at, location, series_id, series_occurrence_date)
        values (
          v_series.club_id, 'kegelabend', v_series.title,
          (v_candidate + v_series.time_of_day) at time zone 'Europe/Berlin', v_series.location,
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
