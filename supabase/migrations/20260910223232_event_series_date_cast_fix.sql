-- ============================================================
-- Migration: event_series_date_cast_fix
-- `date + interval` liefert in Postgres einen `timestamp`, keinen
-- `date` – der Aufruf von generate_series_events() in
-- create_event_series() schlug deshalb mit "function ... does not
-- exist" fehl (Signatur erwartet `date`). Fix: explizit auf `date`
-- zurückcasten.
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

  perform generate_series_events(v_series_id, (p_starts_on + interval '6 months')::date);

  return v_series_id;
end;
$$;

revoke all on function create_event_series(text, text, text, integer, integer, integer, time, date) from public;
grant execute on function create_event_series(text, text, text, integer, integer, integer, time, date) to authenticated;
