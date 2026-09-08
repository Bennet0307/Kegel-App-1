-- ============================================================
-- Migration: bootstrap_club_select
-- Löst ein weiteres Henne-Ei-Problem: Direkt nach dem Anlegen
-- eines Clubs (INSERT ... RETURNING) prüft Postgres die
-- SELECT-Policy für die zurückgegebene Zeile. Der anlegende User
-- ist zu diesem Zeitpunkt aber noch kein Mitglied des neuen Clubs
-- (das passiert erst im nächsten Request), wodurch die Zeile
-- nicht sichtbar ist und "new row violates row-level security
-- policy for table club" wirft.
-- Lösung analog zu bootstrap_policies: ein Club ohne Mitglieder
-- ("unclaimed") ist für jeden eingeloggten User sichtbar, bis der
-- erste Admin eingetragen wurde.
-- ============================================================

create policy "club_select_unclaimed"
  on club for select
  to authenticated
  using (
    not exists (select 1 from member m where m.club_id = club.id)
  );
