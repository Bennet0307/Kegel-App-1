-- ============================================================
-- Migration: event_archiving
-- Termine archivieren (Idee aus "Offene Punkte" umgesetzt): alte
-- Kegelabende aus der Standard-Terminliste ausblenden, ohne sie zu
-- löschen (historische Daten bleiben für Kasse/Statistik unverändert
-- vorhanden, die aggregieren unabhängig von einem Archiv-Status).
--
-- Zwei Mechanismen, beide rein clientseitig ausgewertet (kein
-- Cron-Job/Edge-Function nötig):
--   1) Manuell: event.archived_at gesetzt (Button "Archivieren" pro
--      Termin in events.tsx).
--   2) Automatisch: club.auto_archive_days gesetzt – ein Termin gilt
--      dann als archiviert, sobald starts_at länger als so viele Tage
--      zurückliegt, ganz ohne dass dafür archived_at geschrieben
--      werden müsste (spart eine geschriebene Spalte + Job; die Grenze
--      lässt sich jederzeit ändern, ohne bestehende Zeilen zu
--      migrieren).
-- ============================================================

alter table club add column auto_archive_days integer check (auto_archive_days is null or auto_archive_days > 0);
comment on column club.auto_archive_days is
  'Wenn gesetzt: Termine gelten automatisch als archiviert, sobald starts_at so viele Tage zurückliegt. NULL = automatisches Archivieren deaktiviert.';

alter table event add column archived_at timestamptz;
comment on column event.archived_at is
  'Manuell gesetzter Archivierungszeitpunkt. NULL = nicht manuell archiviert (kann trotzdem über club.auto_archive_days automatisch als archiviert gelten).';
