-- ============================================================
-- Migration: event_series_timezone_fix
-- generate_series_events() castete die berechnete lokale Uhrzeit
-- direkt per `::timestamptz`, was die DB-Session-Zeitzone (UTC)
-- verwendet – dadurch landeten z.B. 19:30 Uhr als 19:30 UTC in der
-- Spalte, was im Browser (Europe/Berlin, UTC+1/+2) als 20:30 bzw.
-- 21:30 angezeigt wurde. Fix: explizit "AT TIME ZONE 'Europe/Berlin'"
-- statt eines bloßen Casts, damit DST (Sommer-/Winterzeit) korrekt
-- berücksichtigt wird. Die App hat sonst keine Zeitzonen-Verwaltung
-- (Club-Tabelle hat kein tz-Feld) – Europe/Berlin ist die einzige
-- bisher unterstützte Zeitzone, siehe CLAUDE.md (Region Frankfurt/EU).
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
