-- ============================================================
-- Migration: club_settings_staff_write
-- "club_update_admin" erlaubte bisher nur der Rolle admin, den Club
-- zu bearbeiten (u.a. kegelgeld_cents, hausnummer_penalty_*). Diese
-- Felder sind finanzielle Vereinseinstellungen, die sinnvollerweise
-- auch der Kassierer anpassen darf (er hat bereits Schreibrechte auf
-- game/score/transaction). Ersetzt durch auth_staff_club_ids()
-- (admin ODER kassierer), analog zu den anderen Staff-Policies.
-- ============================================================

drop policy "club_update_admin" on club;
create policy "club_update_staff"
  on club for update
  using (id in (select auth_staff_club_ids()));
