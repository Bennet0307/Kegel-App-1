-- ============================================================
-- Migration: check_in
-- Einchecken / Ankunftszeit erfassen (Idee aus "Offene Punkte"
-- umgesetzt, Grundfunktion ohne automatische Verspätungsstrafe – die
-- bleibt ein eigener, späterer Schritt). Neue Spalte
-- `attendance.checked_in_at`, getrennt von `status`, damit Zusage/
-- Absage und tatsächliches Erscheinen unabhängig bleiben (ein
-- Mitglied kann z.B. "zugesagt" haben und trotzdem nicht erscheinen,
-- oder spontan ohne vorherige Zusage einchecken).
--
-- Einchecken soll sowohl vom Mitglied selbst als auch von Admin/
-- Kassierer für andere möglich sein (z.B. am Tisch für Mitglieder
-- ohne Smartphone). Bisher gab es auf `attendance` aber gar keine
-- Staff-Schreibrechte, nur `attendance_write_own` – neue Policy
-- `attendance_write_staff` ergänzt das (analog zu anderen
-- Staff-Write-Policies über auth_staff_club_ids()).
-- ============================================================

alter table attendance add column checked_in_at timestamptz;
comment on column attendance.checked_in_at is
  'Tatsächliche Ankunftszeit am Kegelabend, unabhängig von status (Zu-/Absage). NULL = noch nicht eingecheckt.';

create policy "attendance_write_staff"
  on attendance for all
  using (event_id in (select id from event where club_id in (select auth_staff_club_ids())))
  with check (event_id in (select id from event where club_id in (select auth_staff_club_ids())));
